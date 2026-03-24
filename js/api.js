const SB_BATCH = 500; // 한 번에 upsert할 최대 건수 (3000대 환경)

/* ── GET 요청 중복 차단: 동일 endpoint가 이미 진행 중이면 해당 Promise 재사용 ── */
const _pendingGETs = new Map();
/* ── 지수 백오프 딜레이 (ms) — 네트워크 실패 시 순서대로 사용 ── */
const _SB_RETRY_DELAYS = [5000, 15000, 30000];

async function sbReq(table, method='GET', data=null, query=''){
  const url = DB.g(K.SB_URL,'');
  const key  = DB.g(K.SB_KEY,'');
  if(!url || !key) throw new Error('NO_SB_URL');

  const endpoint = `${url}/rest/v1/${table}${query}`;

  // GET 요청 중복 차단 — 동일 URL이 비행 중이면 같은 Promise 반환
  if(method === 'GET'){
    if(_pendingGETs.has(endpoint)) return _pendingGETs.get(endpoint);
  }

  const _exec = async () => {
    // on_conflict 있을 때만 upsert(merge-duplicates) — 없으면 순수 INSERT(return=minimal)
    // GENERATED ALWAYS AS IDENTITY PK에 resolution=merge-duplicates 단독 사용 시 400 발생 방지
    const prefer = method==='POST'
      ? (query.includes('on_conflict') ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal')
      : method==='PATCH' ? 'return=minimal' : '';
    // 30초 fetch 타임아웃 — 무한 대기 방지
    const controller = new AbortController();
    const _tid = setTimeout(() => controller.abort(), 30000);
    const opts = {
      method,
      signal: controller.signal,
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { 'Prefer': prefer } : {})
      }
    };
    if(data) opts.body = JSON.stringify(data);
    try {
      const r = await fetch(endpoint, opts);
      clearTimeout(_tid);
      if(!r.ok){
        const err = await r.text();
        // PGRST 오류 코드 → 한글 메시지 변환
        let pgrst = null;
        try { pgrst = JSON.parse(err); } catch(_){}
        if(pgrst?.code){
          const _pgrMsg = {
            'PGRST204': '테이블에 해당 컬럼이 없습니다. Supabase 테이블에 누락된 컬럼을 추가해주세요.',
            'PGRST200': '테이블 또는 관계를 찾을 수 없습니다. 테이블명을 확인해주세요.',
            'PGRST116': '조회 결과가 없거나 여러 행이 반환됐습니다.',
            'PGRST301': '인증 오류입니다. API 키를 확인해주세요.',
            '42501':    '권한이 없습니다. Supabase RLS 정책을 확인해주세요.',
            // 23505: 중복 키 — members 재가입 등 정상 시나리오에서 발생 가능, toast 없이 throw만
            '23505':    null,
            '23503':    '참조 무결성 오류입니다.',
          };
          const kor = _pgrMsg[pgrst.code];
          if(kor !== undefined){ // null = 조용히 throw, string = toast + throw
            if(kor && typeof toast === 'function') toast(`서버 오류 [${pgrst.code}]: ${kor}`, 'err', 6000);
            throw new Error(`[${pgrst.code}] ${kor||pgrst.message||pgrst.code}`);
          }
        }
        throw new Error(`SB ${r.status}: ${err}`);
      }
      if(method==='DELETE'||method==='PATCH') return null;
      const ct = r.headers.get('content-type')||'';
      return ct.includes('json') ? r.json() : null;
    } catch(e) {
      clearTimeout(_tid);
      if(e.name === 'AbortError') throw new Error('REQUEST_TIMEOUT');
      throw e;
    }
  };

  const _execWithRetry = async () => {
    // PGRST205: 스키마 캐시 미갱신 → 3초 후 1회 자동 재시도
    try {
      return await _exec();
    } catch(e) {
      if(e?.message?.includes('PGRST205')){
        await new Promise(r => setTimeout(r, 3000));
        return await _exec();
      }
      // 네트워크 오류 시 지수 백오프 재시도
      // GET: 3회 / POST·PATCH (upsert는 멱등): 2회 (3s, 10s)
      const isNetErr = e?.message?.includes('Failed to fetch') || e?.message?.includes('REQUEST_TIMEOUT') || e?.name === 'TypeError';
      if(isNetErr){
        const delays = method === 'GET' ? _SB_RETRY_DELAYS : [3000, 10000];
        for(const delay of delays){
          await new Promise(r => setTimeout(r, delay));
          try { return await _exec(); } catch(_) {}
        }
      }
      throw e;
    }
  };

  if(method === 'GET'){
    const p = _execWithRetry().finally(() => _pendingGETs.delete(endpoint));
    _pendingGETs.set(endpoint, p);
    return p;
  }
  return _execWithRetry();
}

// 배치 upsert — SB_BATCH 단위로 분할 전송 (컬럼 불일치 시 최대 5회 반복 재시도)
async function sbBatchUpsert(table, rows, conflictCol=''){
  if(!rows.length) return;
  // conflictCol 명시 시 PostgREST on_conflict 쿼리 추가 → 정확한 upsert 보장
  const _q = conflictCol ? `?on_conflict=${encodeURIComponent(conflictCol)}` : '';
  for(let i=0; i<rows.length; i+=SB_BATCH){
    let batch = rows.slice(i, i+SB_BATCH);
    let lastErr = null;
    for(let attempt=0; attempt<5; attempt++){
      try {
        await sbReq(table,'POST', batch, _q);
        lastErr = null;
        break;
      } catch(e) {
        // 컬럼 불일치 에러 시 해당 컬럼 제거 후 재시도 (여러 컬럼 불일치 대응)
        // PGRST204 "Could not find" 또는 42703 "does not exist" 모두 처리
        const _isColErr = e.message && (
          (e.message.includes('column') && e.message.includes('does not exist')) ||
          (e.message.includes('PGRST204')) ||
          (e.message.includes('Could not find') && e.message.includes('column'))
        );
        if(_isColErr){
          console.warn('[SB] 컬럼 불일치 재시도:', e.message);
          const m = e.message.match(/'([^']+)' column/) || e.message.match(/column "([^"]+)"/);
          if(m){
            const badCol = m[1];
            batch = batch.map(r => { const c={...r}; delete c[badCol]; return c; });
            lastErr = e;
            continue;
          }
        }
        // 23502: 파티션 테이블 id 자동생성 미적용 → 클라이언트 생성 bigint 로 재시도
        const _is23502 = e.message && e.message.includes('23502');
        if(_is23502 && batch[0]?.id === undefined){
          console.warn('[SB] id 자동생성 실패(23502) — 클라이언트 생성 id 재시도');
          const _base = Date.now();
          batch = batch.map((r, idx) => ({id: _base * 1000 + idx, ...r}));
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    if(lastErr) throw lastErr;
  }
}

/* ── 크로스 디바이스 알림 푸시 ─────────────────────────────
   Supabase notifications 테이블에 INSERT.
   수신측은 _fetchFromSB에서 자신에게 해당하는 알림만 pull.
──────────────────────────────────────────────────────────── */
async function pushSBNotif(notif){
  try {
    await sbReq('notifications','POST',{
      target_role:    notif.target_role    || null,
      target_aj_type: notif.target_aj_type || null,
      target_user_id: notif.target_user_id || null,
      site_id:        notif.site_id        || null,
      type:           notif.type           || 'info',
      title:          notif.title          || '',
      body:           notif.body           || '',
      ref_id:         notif.ref_id         || null,
      sender_phone:   S?.phone             || null,
    });
  } catch(e){
    console.warn('[pushSBNotif]',e);
  }
}

/* GS(Google Sheets) 폴백 — 기존 방식 유지 */
async function gsReq(action,payload={}){
  const url=DB.g(K.GS_URL,'');
  if(!url) throw new Error('NO_URL');
  const r=await fetch(url,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

/* ── 동기화 메인 (Supabase 우선, GS 폴백) ─────────────────── */
/* ── Sync Lock + Queue ──────────────────────────────────
   - _syncLock : syncNow() 레벨에서 동시 실행 완전 차단
   - _syncQueue: Promise 체인으로 호출 순서 보장 (queueSync)
────────────────────────────────────────────────────── */
let _syncQueue = Promise.resolve();
function queueSync(){
  _syncQueue = _syncQueue.then(() => syncNow().catch(() => {}));
  return _syncQueue;
}

async function syncNow(){
  // syncNow 레벨 락 — UI 업데이트 중복도 방지
  if(_syncLock){ console.log('[syncNow] 이미 동기화 중 — 건너뜀'); return; }
  _syncLock = true;
  const dot=document.getElementById('sdot');
  const txt=document.getElementById('stxt');
  dot.className='sdot sync'; txt.textContent='동기화 중...';
  const sbUrl = DB.g(K.SB_URL,'');
  const gsUrl = DB.g(K.GS_URL,'');
  if(!sbUrl && !gsUrl){
    dot.className='sdot err';
    txt.textContent='미연동';
    _syncLock = false;
    return;
  }
  try{
    if(sbUrl){
      await _syncToSupabase();
    } else {
      await _syncToGS();
    }
    dot.className='sdot ok';
    txt.textContent=`동기화 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;
    DB.s('last_sync',new Date().toISOString());
    if(curPg==='pg-home') renderHome();
    if(curPg==='pg-admin') renderAdmin();
    toast('동기화 완료','ok');
  } catch(e){
    dot.className='sdot err';
    const errMsg = e.message||'';
    const hint = errMsg.includes('NO_SB_URL') ? '키 미설정'
               : errMsg.includes('401')       ? 'API 키 오류'
               : errMsg.includes('404')        ? '테이블 없음'
               : errMsg.includes('column')     ? '컬럼 불일치'
               : errMsg.includes('Failed to fetch') ? '네트워크 오류'
               : '오류';
    txt.textContent=`오류 · ${hint}`;
    console.error('[Sync 실패]', errMsg);
  } finally {
    _syncLock = false;
  }
}

/* ── Supabase 동기화 (병렬 배치 처리) ───────────────────────
   - IDB.getUnsynced()로 미동기화 건만 읽음 (전체 배열 메모리 로드 없음)
   - logs / transit / as / members 병렬 전송 → 동기화 시간 ~4× 단축
   - SB_BATCH(500)건 단위로 분할 전송
   - 성공 시 IDB markSynced → LS 백업 캐시 갱신
   - 락은 syncNow() 레벨에서 관리 (_syncLock)
────────────────────────────────────────────────────────── */
let _syncLock = false; // syncNow()와 공유 — 여기서 선언
async function _syncToSupabase(){
  try {
  const siteMap = Object.fromEntries(getSites().map(s=>[s.id,s.name]));
  const idbReady = !!(window._IDB_READY);

  // 미동기화 항목 병렬 수집 (오프라인 장기 후 mega-batch 방지 — 테이블당 1,000건 상한)
  const _UNSYNCED_CAP = 1000;
  const [unsyncLogs, unsyncTr, unsyncAS, unsyncM] = (await Promise.all([
    idbReady ? IDB.getUnsynced('logs').catch(()=>[]) : Promise.resolve(getLogs().filter(l=>!l.synced)),
    idbReady ? IDB.getUnsynced('transit').catch(()=>[]) : Promise.resolve(getTransit().filter(t=>!t.synced)),
    idbReady ? IDB.getUnsynced('as_requests').catch(()=>[]) : Promise.resolve(getAsReqs().filter(a=>!a.synced)),
    idbReady ? IDB.getUnsynced('members').catch(()=>[]) : Promise.resolve([]),
  ])).map(arr=>arr.slice(0, _UNSYNCED_CAP));

  // 병렬 업서트 (테이블 간 의존성 없음) — allSettled: 한 테이블 실패해도 나머지 계속 진행
  const _syncResults = await Promise.allSettled([
    // 1. LOGS — 신규(start): POST INSERT / 업데이트(end·idle): PATCH by record_id
    (async()=>{
      if(!unsyncLogs.length) return;
      const _toRow = l=>({
        record_id:   l.id||'',
        date:        l.date||'',
        site_id:     l.siteId||'',
        site_name:   siteMap[l.siteId]||l.siteId||'',
        company:     l.company||'',
        floor:       l.floor||'',
        equip:       l.equip||'',
        recorder:    l.name||l.recorder||'',
        status:      l.status||'',
        start_time:  l.startTime||'',
        end_time:    l.endTime||'',
        used_hours:  l.duration||l.usedH||0,
        meter_start: String(l.meterStart||''),
        meter_end:   String(l.meterEnd||''),
        off_reason:  l.offReason||'',
        created_at:  l.createdAt ? new Date(l.createdAt).toISOString() : new Date(l.ts||Date.now()).toISOString(),
      });
      // UNIQUE(record_id, date) 복합키 upsert — 파티션 테이블 대응
      const allRows = unsyncLogs.map(_toRow);
      await sbBatchUpsert('logs', allRows, 'record_id,date');
      await IDB.markSynced('logs', unsyncLogs.map(l=>l.id)).catch(()=>{});
      _cache.todayLogs = null;
    })(),

    // 2. TRANSIT
    (async()=>{
      if(!unsyncTr.length) return;
      const rows = unsyncTr.map(t=>({
        record_id:        t.id||'',
        date:             t.date||'',
        type:             t.type==='in'?'반입':t.type==='handover'?'인수인계':'반출',
        site_id:          t.siteId||'',
        site_name:        siteMap[t.siteId]||t.siteId||'',
        company:          t.company||'',
        equip_specs:      (t.specs||[]).map(s=>s.spec+(s.model?` (${s.model})`:'')+` ×${s.qty}`).join(', ')||t.equip||'',
        aj_equip:         t.ajEquip||'',
        reporter_name:    t.reporterName||t.recorder||'',
        reporter_phone:   t.reporterPhone||'',
        manager_name:     t.managerName||'',
        manager_phone:    t.managerPhone||'',
        manager_location: t.managerLocation||'',
        note:             t.note||'',
        status:           t.status || (t.cancelled?'취소':(t.done?'완료':'대기')),
        messages:         JSON.stringify(t.ajMsgs||[]),
        dispatch:         t.dispatch||'',
        created_at:       t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
        updated_at:       t.updatedAt ? new Date(t.updatedAt).toISOString() : new Date().toISOString(),
      }));
      await sbBatchUpsert('transit', rows, 'record_id');
      await IDB.markSynced('transit', unsyncTr.map(t=>t.id)).catch(()=>{});
      _cache.transit = null; _cache.transitBySite = null;
    })(),

    // 3. AS REQUESTS
    (async()=>{
      if(!unsyncAS.length) return;
      const rows = unsyncAS.map(a=>({
        record_id:     a.id||'',
        date:          a.date||'',
        site_id:       a.siteId||'',
        site_name:     siteMap[a.siteId]||a.siteId||'',
        company:       a.company||'',
        equip:         a.equip||'',
        location:      a.location||'',
        fault_type:    a.type||a.faultType||'기타',
        description:   a.desc||'',
        reporter_name: a.reporterName||a.reporter||'',
        reporter_phone:a.reporterPhone||'',
        status:        a.status||'대기',
        tech_name:     a.techName||'',
        tech_phone:    a.techPhone||'',
        resolved_at:   a.resolvedAt ? new Date(a.resolvedAt).toISOString() : null,
        resolve_note:  a.resolvedNote||'',
        material_at:   a.materialAt ? new Date(a.materialAt).toISOString() : null,
        requested_at:  a.requestedAt ? new Date(a.requestedAt).toISOString() : null,
        created_at:    a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
        updated_at:    a.updatedAt  ? new Date(a.updatedAt).toISOString()  : new Date(a.createdAt||Date.now()).toISOString(),
        ...(a.photoThumb ? { photo_data: a.photoThumb } : {}),
      }));
      await sbBatchUpsert('as_requests', rows, 'record_id');
      await IDB.markSynced('as_requests', unsyncAS.map(a=>a.id)).catch(()=>{});
      _cache.asReqs = null; _cache.asBySite = null;
    })(),

    // 4. MEMBERS
    (async()=>{
      if(!unsyncM.length) return;
      const rows = unsyncM.map(m=>({
        record_id: m.id||'',
        name:      m.name||'',
        company:   m.company||'',
        site_id:   m.siteId||'',
        site_name: siteMap[m.siteId]||m.siteId||'',
        phone:     m.phone||'',
        title:     m.title||'',
        joined_at: new Date(m.joinedAt||Date.now()).toISOString()
      }));
      await sbBatchUpsert('members', rows, 'record_id');
      await IDB.markSynced('members', unsyncM.map(m=>m.id)).catch(()=>{});
      _cache.members = null;
    })(),
  ]);
  // 부분 실패 테이블 로깅 (성공한 테이블은 이미 synced:true 처리됨)
  const _syncFailed = _syncResults.filter(r => r.status === 'rejected');
  if(_syncFailed.length){
    _syncFailed.forEach(f => console.warn('[sync] 테이블 동기화 실패:', f.reason?.message));
    if(_syncFailed.length === _syncResults.length) throw new Error('전체 테이블 동기화 실패');
  }

  // 5. EQUIPMENT MASTER (transit 업서트 완료 후 순차 처리)
  const allEquip = getEquipMaster();
  const unsyncEq = allEquip.filter(e => !e.synced);
  if(unsyncEq.length){
    const rows = unsyncEq.map(e=>({
      record_id:  e.id||'',
      equip_no:   e.equipNo||'',
      serial_no:  e.serialNo||'',
      site_id:    e.siteId||'',
      site_name:  siteMap[e.siteId]||e.siteId||'',
      company:    e.company||'',
      spec:       e.spec||'',
      model:      e.model||'',
      transit_id: e.transitId||'',
      location:   e.location||'',
      project:    e.project||'',
      status:     e.status||'active',
      in_date:    e.inDate||'',
      out_date:   e.outDate||null,
      created_at: new Date().toISOString()
    }));
    try {
      await sbBatchUpsert('equipment', rows, 'record_id');
      unsyncEq.forEach(e => e.synced = true);
      await saveEquipMaster(allEquip);
    } catch(err) {
      console.warn('[sync] equipment 동기화 실패:', err);
    }
  }

  // 6. AJ 멤버 push 제거 — status 등 서버 변경값 덮어쓰기 방지
  //    개별 저장(_syncAjMemberSb/_patchAjMemberSb)에서 SB에 직접 반영,
  //    pull은 아래 _pullConfigFromSB() 내 _pullAjMembersFromSB()에서 수행

  // ── 설정 데이터 pull (sites/companies/notices/settings/invite/idle/aj_members) ──
  await _pullConfigFromSB().catch(e => console.warn('[config pull] 실패:', e));

  // ── 다른 기기 변경사항 pull (충돌 방지) ─────────────────
  // 마지막 동기화 이후 서버에서 변경된 transit / AS 데이터를 내려받아 로컬 병합
  // updated_at 기준 비교: 서버 버전이 더 새로우면 로컬을 덮어씀
  await _pullRecentFromSupabase().catch(e => console.warn('[pull] 실패:', e));
  } catch(e) { throw e; }
}

/* ══════════════════════════════════════════════════════════
   단건 즉시 업로드 (서버우선연동) — transit / as_requests
   저장 직후 해당 레코드만 Supabase에 단독 upsert.
   성공 → synced:true 마킹 + sync pill 갱신
   실패 → synced:false 유지 (다음 _syncToSupabase 재시도)
══════════════════════════════════════════════════════════ */
function _syncPillOk(){
  const dot=document.getElementById('sdot');
  const txt=document.getElementById('stxt');
  const t=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  if(dot) dot.className='sdot ok';
  if(txt) txt.textContent=`동기화 ${t}`;
  DB.s('last_sync',new Date().toISOString());
}
async function _directPushTransit(rec){
  const sbUrl=DB.g(K.SB_URL,'');
  if(!sbUrl) return;
  const siteMap=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
  const now=new Date().toISOString();
  const row={
    record_id:        rec.id||'',
    date:             rec.date||'',
    type:             rec.type==='in'?'반입':rec.type==='handover'?'인수인계':'반출',
    site_id:          rec.siteId||'',
    site_name:        siteMap[rec.siteId]||rec.siteId||'',
    company:          rec.company||'',
    equip_specs:      (rec.specs||[]).map(s=>s.spec+(s.model?` (${s.model})`:'')+` ×${s.qty}`).join(', ')||rec.equip||'',
    aj_equip:         rec.ajEquip||'',
    reporter_name:    rec.reporterName||rec.recorder||'',
    reporter_phone:   rec.reporterPhone||'',
    manager_name:     rec.managerName||'',
    manager_phone:    rec.managerPhone||'',
    manager_location: rec.managerLocation||'',
    note:             rec.note||'',
    status:           rec.status||'예정',
    messages:         JSON.stringify(rec.ajMsgs||[]),
    dispatch:         rec.dispatch||'',
    plan_type:        rec.planType||'',
    plan_name:        rec.planName||'',

    created_at:       rec.createdAt ? new Date(rec.createdAt).toISOString() : now,
    updated_at:       now,
  };
  try{
    await sbBatchUpsert('transit',[row],'record_id');
    const arr=getTransit();
    const idx=arr.findIndex(r=>r.id===rec.id);
    if(idx>=0){ arr[idx].synced=true; arr[idx].updatedAt=Date.now(); await saveTransit(arr); }
    await IDB.markSynced('transit',[rec.id]).catch(()=>{});
    _syncPillOk();
  }catch(e){
    console.warn('[직접업로드] transit 실패 (로컬 저장됨):', e.message);
    throw e; // 호출자(submitTransit)가 로컬 저장 + 재시도 처리
  }
}
async function _directPushAS(req){
  const sbUrl=DB.g(K.SB_URL,'');
  if(!sbUrl) return;
  const siteMap=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
  const now=new Date().toISOString();
  const row={
    record_id:     req.id||'',
    date:          req.date||'',
    site_id:       req.siteId||'',
    site_name:     siteMap[req.siteId]||req.siteId||'',
    company:       req.company||'',
    equip:         req.equip||'',
    location:      req.location||'',
    fault_type:    req.type||req.faultType||'기타',
    description:   req.desc||'',
    reporter_name: req.reporterName||req.reporter||'',
    reporter_phone:req.reporterPhone||'',
    status:        req.status||'대기',
    tech_name:     req.techName||'',
    tech_phone:    req.techPhone||'',
    resolved_at:   req.resolvedAt?new Date(req.resolvedAt).toISOString():null,
    resolve_note:  req.resolvedNote||'',
    material_at:   req.materialAt?new Date(req.materialAt).toISOString():null,
    requested_at:  req.requestedAt?new Date(req.requestedAt).toISOString():null,
    comments:      JSON.stringify(req.comments||[]),
    worker_name:   req.workerName||'',
    worker_phone:  req.workerPhone||'',
    // 썸네일(~5KB base64) 저장 — 컬럼 없으면 sbBatchUpsert가 자동 제거
    ...(req.photoThumb ? { photo_data: req.photoThumb } : {}),
    created_at:    req.createdAt ? new Date(req.createdAt).toISOString() : now,
    updated_at:    now,
  };
  try{
    await sbBatchUpsert('as_requests',[row],'record_id');
    const arr=getAsReqs();
    const idx=arr.findIndex(r=>r.id===req.id);
    if(idx>=0){ arr[idx].synced=true; arr[idx].updatedAt=Date.now(); saveAsReqs(arr); }
    await IDB.markSynced('as_requests',[req.id]).catch(()=>{});
    _syncPillOk();
  }catch(e){
    console.warn('[직접업로드] as_requests 실패 (로컬 저장됨):', e.message);
    throw e; // 호출자(submitAS)가 로컬 저장 + 재시도 처리
  }
}

/* ══════════════════════════════════════════════════════════
   설정 데이터 서버 동기화 — Push / Pull
   (K.SITES, K.COS, K.NOTICE, K.SETTINGS, K.INVITE_SITE, K.IDLE)
══════════════════════════════════════════════════════════ */

/* ── Push 함수 6개 ─────────────────────────────────────── */
async function _pushSitesToSB(arr){
  const rows = (arr||getSites()).map(s=>({
    id:s.id, name:s.name, active:s.active!==false,
    projects:JSON.stringify(s.projects||[]), updated_at:new Date().toISOString()
  }));
  if(rows.length) await sbBatchUpsert('sites', rows);
}

async function _pushCosToSB(obj){
  obj = obj || DB.g(K.COS,{})||{};
  for(const [siteId, list] of Object.entries(obj)){
    await sbReq('companies','DELETE',null,`?site_id=eq.${encodeURIComponent(siteId)}`).catch(()=>{});
    if(list&&list.length){
      const rows = list.map(c=>({site_id:siteId, name:c.name, color:c.color||'#3b8bff', equip:c.equip||0}));
      await sbReq('companies','POST',rows,'').catch(()=>{});
    }
  }
}

async function _pushNoticesToSB(arr){
  arr = arr || getNotices();
  await sbReq('notices','DELETE',null,'?id=neq.__none__').catch(()=>{});
  if(arr.length){
    const rows = arr.map(n=>({
      id:n.id, site_id:n.siteId, text:n.text,
      created_by:n.createdBy, created_at:n.createdAt,
      active:n.active!==false, updated_at:new Date().toISOString()
    }));
    await sbBatchUpsert('notices', rows);
  }
}

async function _pushSettingsToSB(){
  const s  = DB.g(K.SETTINGS,{});
  const ca = DB.g('custom_alerts',[]);
  const row = {
    site_id:S?.siteId||'global',
    alert_time:s.alertTime||'15:00',
    custom_alerts:JSON.stringify(ca),
    updated_at:new Date().toISOString()
  };
  await sbReq('app_settings','POST',[row],'').catch(()=>{});
}

async function _pushInviteCodeToSB(siteId, code){
  const row = {site_id:siteId, code, set_month:new Date().toISOString().slice(0,7), updated_at:new Date().toISOString()};
  await sbReq('invite_codes','POST',[row],'').catch(()=>{});
}

async function _pushIdleLogToSB(entry){
  const siteMap = Object.fromEntries(getSites().map(s=>[s.id,s.name]));
  const row = {
    id:entry.id, date:entry.date,
    site_id:entry.siteId, site_name:siteMap[entry.siteId]||'',
    company:entry.company, equip:entry.equip,
    recorder:entry.name||entry.recorder||'',
    reason:entry.reason||'', note:entry.note||'',
    created_at:new Date().toISOString(), updated_at:new Date().toISOString()
  };
  await sbReq('idle_logs','POST',[row],'').catch(()=>{});
}

/* ── Pull 함수 6개 ─────────────────────────────────────── */
async function _pullSitesFromSB(){
  const rows = await sbReq('sites','GET',null,'?order=name').catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  const local = rows.map(r=>({
    id:r.id, name:r.name, active:r.active!==false,
    projects:(()=>{ try{ return JSON.parse(r.projects||'[]'); }catch(_e){ return []; } })()
  }));
  _cache.sites = null; DB.s(K.SITES, local);
}

async function _pullCosFromSB(){
  const rows = await sbReq('companies','GET',null,'?order=site_id,name').catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  const obj = {};
  for(const r of rows){
    if(!obj[r.site_id]) obj[r.site_id]=[];
    obj[r.site_id].push({name:r.name, color:r.color||'#3b8bff', equip:r.equip||0});
  }
  _cache.cos = null; DB.s(K.COS, obj);
}

async function _pullNoticesFromSB(){
  const rows = await sbReq('notices','GET',null,'?order=created_at.desc').catch(()=>null);
  if(!Array.isArray(rows)) return;
  DB.s(K.NOTICE, rows.map(r=>({
    id:r.id, siteId:r.site_id, text:r.text,
    createdBy:r.created_by, createdAt:r.created_at, active:r.active!==false
  })));
}

async function _pullSettingsFromSB(){
  const siteId = S?.siteId||'global';
  const rows = await sbReq('app_settings','GET',null,`?site_id=eq.${encodeURIComponent(siteId)}`).catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  const r = rows[0];
  const s = DB.g(K.SETTINGS,{}); s.alertTime = r.alert_time||'15:00';
  DB.s(K.SETTINGS, s);
  try{ DB.s('custom_alerts', JSON.parse(r.custom_alerts||'[]')); }catch(_e){}
}

async function _pullInviteCodesFromSB(){
  const rows = await sbReq('invite_codes','GET',null,'').catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  for(const r of rows) DB.s(K.INVITE_SITE + r.site_id, r.code);
}

async function _pullIdleLogsFromSB(){
  const since = new Date(Date.now()-90*24*60*60*1000).toISOString();
  const rows = await sbReq('idle_logs','GET',null,
    `?created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`
  ).catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  DB.s(K.IDLE, rows.map(r=>({
    id:r.id, type:'idle', siteId:r.site_id, date:r.date,
    company:r.company, equip:r.equip, name:r.recorder,
    reason:r.reason, note:r.note||'', status:'idle', synced:true
  })));
}

async function _pullAjMembersFromSB(){
  const rows = await sbReq('aj_members','GET',null,'?order=created_at').catch(()=>null);
  if(!Array.isArray(rows)||!rows.length) return;
  // 서버 데이터 우선, 로컬 전용 항목은 보존 (덮어쓰기 방지)
  const local = _getAjMembers();
  const serverEmpNos = new Set(rows.map(r=>r.emp_no));
  const localOnly = local.filter(m=>!serverEmpNos.has(m.emp_no));
  // 이전 로그인 캐시(K.AJ_MEMBER)도 복원 (이미 wiped된 경우 복구)
  const cached = DB.g(K.AJ_MEMBER, null);
  if(cached?.emp_no && !serverEmpNos.has(cached.emp_no) && !localOnly.some(m=>m.emp_no===cached.emp_no)){
    localOnly.push(cached);
  }
  _saveAjMembers([...rows, ...localOnly]);
}

/* ── 통합 Config Pull ──────────────────────────────────── */
async function _pullConfigFromSB(){
  await Promise.allSettled([
    _pullSitesFromSB(),
    _pullCosFromSB(),
    _pullNoticesFromSB(),
    _pullSettingsFromSB(),
    _pullInviteCodesFromSB(),
    _pullIdleLogsFromSB(),
    _pullAjMembersFromSB(),
  ]);
}

async function _pullRecentFromSupabase(){
  const lastSync = DB.g('last_sync', null);
  const localTrCount = getTransit().length;
  const fullPull = !lastSync || localTrCount === 0;
  const since = fullPull
    ? new Date(Date.now() - 90*24*60*60*1000).toISOString()
    : new Date(new Date(lastSync).getTime() - 60000).toISOString();

  // transit pull
  const trRows = await sbReq('transit','GET',null,
    `?updated_at=gte.${encodeURIComponent(since)}&order=updated_at.desc&limit=500`
  ).catch(()=>[]);
  if(Array.isArray(trRows) && trRows.length){
    const localTr = getTransit();
    let changed = false;
    for(const sr of trRows){
      const idx = localTr.findIndex(r => r.id === sr.record_id);
      const serverTs = new Date(sr.updated_at||sr.created_at||0).getTime();
      if(idx >= 0){
        const localTs = localTr[idx].updatedAt || localTr[idx].createdAt || 0;
        if(serverTs > localTs){
          // 서버가 더 최신 — 핵심 필드 갱신
          const rawSt = sr.status||'';
          const mappedSt = rawSt==='완료'
            ? (localTr[idx].type==='in'?'반입완료':'반출완료')
            : rawSt==='대기'?'예정': rawSt||localTr[idx].status;
          localTr[idx] = {...localTr[idx],
            status: mappedSt,
            ajEquip: sr.aj_equip || localTr[idx].ajEquip,
            ajMsgs: (() => { try{ return JSON.parse(sr.messages||'[]'); }catch(_e){ return localTr[idx].ajMsgs||[]; } })(),
            dispatch: sr.dispatch || localTr[idx].dispatch,
            updatedAt: serverTs, synced: true };
          changed = true;
        }
      } else if(fullPull){
        // 없는 레코드 추가
        const rawSt = sr.status||'';
        const rawType = sr.type==='반입'?'in':sr.type==='반출'?'out':sr.type;
        const mappedSt = rawSt==='완료'
          ? (rawType==='in'?'반입완료':'반출완료')
          : rawSt==='대기'?'예정': rawSt||'예정';
        localTr.push({
          id: sr.record_id, date: sr.date, type: rawType,
          siteId: sr.site_id, company: sr.company,
          ajEquip: sr.aj_equip||'',
          reporterName: sr.reporter_name||'', reporterPhone: sr.reporter_phone||'',
          managerName: sr.manager_name||'', managerPhone: sr.manager_phone||'',
          managerLocation: sr.manager_location||'', note: sr.note||'',
          status: mappedSt,
          ajMsgs: (() => { try{ return JSON.parse(sr.messages||'[]'); }catch(_e){ return []; } })(),
          dispatch: sr.dispatch||'',
          createdAt: sr.created_at ? new Date(sr.created_at).getTime() : Date.now(),
          updatedAt: serverTs, synced: true
        });
        changed = true;
      }
    }
    if(changed){ await saveTransit(localTr); _cache.transit=null; _cache.transitBySite=null; }
  }

  // AS pull (기존 로직 유지 + fullPull 추가)
  const asRows = await sbReq('as_requests','GET',null,
    `?updated_at=gte.${encodeURIComponent(since)}&order=updated_at.desc&limit=200`
  ).catch(()=>[]);
  if(Array.isArray(asRows) && asRows.length){
    const localAs = getAsReqs();
    let changed = false;
    for(const sr of asRows){
      const idx = localAs.findIndex(r => r.id === sr.record_id);
      const serverTs = new Date(sr.updated_at||sr.created_at||0).getTime();
      if(idx >= 0){
        const localTs = localAs[idx].updatedAt || localAs[idx].createdAt || 0;
        if(serverTs > localTs){
          localAs[idx] = {...localAs[idx],
            status: sr.status||localAs[idx].status,
            techName: sr.tech_name||localAs[idx].techName,
            resolvedNote: sr.resolve_note||localAs[idx].resolvedNote,
            resolvedAt: sr.resolved_at ? new Date(sr.resolved_at).getTime() : localAs[idx].resolvedAt,
            updatedAt: serverTs, synced: true };
          changed = true;
        }
      } else if(fullPull){
        localAs.push({
          id: sr.record_id, date: sr.date, siteId: sr.site_id, company: sr.company,
          equip: sr.equip||'', location: sr.location||'',
          type: sr.fault_type||'기타', desc: sr.description||'',
          reporterName: sr.reporter_name||'', reporterPhone: sr.reporter_phone||'',
          status: sr.status||'대기', techName: sr.tech_name||'',
          resolvedNote: sr.resolve_note||'',
          resolvedAt: sr.resolved_at ? new Date(sr.resolved_at).getTime() : null,
          createdAt: sr.created_at ? new Date(sr.created_at).getTime() : Date.now(),
          updatedAt: serverTs, synced: true
        });
        changed = true;
      }
    }
    if(changed){ await saveAsReqs(localAs); _cache.asReqs=null; _cache.asBySite=null; }
  }
}

/* ── Google Sheets 폴백 동기화 (기존 방식) ──────────────── */
async function _syncToGS(){
  const logs=getLogs();
  const unsync=logs.filter(l=>!l.synced);
  if(unsync.length){
    await gsReq('addLogs',{logs:unsync,sheet:'LOGS'});
    unsync.forEach(l=>l.synced=true);
    saveLogs(logs);
  }
  const transits = getTransit();
  const unsyncTr = transits.filter(t=>!t.synced);
  if(unsyncTr.length){
    const trRows = unsyncTr.map(t=>[
      t.date, t.type==='in'?'반입':t.type==='handover'?'인수인계':'반출',
      getSites().find(s=>s.id===t.siteId)?.name||t.siteId||'—',
      t.company||'—',
      (t.specs||[]).map(s=>s.spec+(s.model?' ('+s.model+')':'')+' ×'+s.qty).join(', ')||t.equip||'—',
      t.ajEquip||'—', t.reporterName||t.recorder||'—', t.reporterPhone||'—',
      t.managerName||'—', t.managerPhone||'—', t.managerLocation||'—',
      t.note||'—', t.cancelled?'취소':(t.done?'완료':'대기'),
      (t.ajMsgs||[]).map(m=>m.author+': '+m.text).join(' | '),
      t.id||''
    ]);
    await gsReq('appendRows',{sheet:'TRANSIT',rows:trRows});
    unsyncTr.forEach(t=>t.synced=true);
    saveTransit(transits);
  }
  const asReqs = getAsReqs();
  const unsyncAS = asReqs.filter(a=>!a.synced);
  if(unsyncAS.length){
    const asRows = unsyncAS.map(a=>[
      a.date||'—', getSites().find(s=>s.id===a.siteId)?.name||a.siteId||'—',
      a.company||'—', a.equip||'—', a.location||'—',
      a.type||a.faultType||'기타', a.desc||'—',
      a.reporterName||a.reporter||'—', a.reporterPhone||'—',
      a.status||'대기', a.techName||'—',
      a.resolvedAt?new Date(a.resolvedAt).toLocaleDateString('ko-KR'):'—',
      a.resolvedNote||'—', a.id||''
    ]);
    await gsReq('appendRows',{sheet:'AS',rows:asRows});
    unsyncAS.forEach(a=>a.synced=true);
    saveAsReqs(asReqs);
  }
  const members = getMembers();
  const unsyncM = members.filter(m=>!m.synced);
  if(unsyncM.length){
    const mRows = unsyncM.map(m=>[
      m.name||'—', m.company||'—',
      getSites().find(s=>s.id===m.siteId)?.name||m.siteId||'—',
      m.phone||'—', m.title||'—',
      new Date(m.joinedAt||Date.now()).toLocaleDateString('ko-KR'),
      m.id||''
    ]);
    await gsReq('appendRows',{sheet:'MEMBERS',rows:mRows});
    unsyncM.forEach(m=>m.synced=true);
    saveMembers(members);
  }
}

async function pushToGS(entry){
  const sbUrl = DB.g(K.SB_URL,'');
  if(sbUrl){
    // ── 서버 직접 저장 — 실패 시 throw (호출자가 catch 처리) ──
    // 스키마에 있는 컬럼만 전송 (location_detail/team/project/updated_at 제외)
    const siteMap=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
    const row={
      record_id:   entry.id||'',
      date:        entry.date||'',
      site_id:     entry.siteId||'',
      site_name:   siteMap[entry.siteId]||entry.siteId||'',
      company:     entry.company||'',
      floor:       entry.floor||'',
      equip:       entry.equip||'',
      recorder:    entry.name||entry.recorder||'',
      status:      entry.status||'',
      start_time:  entry.startTime||'',
      end_time:    entry.endTime||'',
      used_hours:  entry.duration||0,
      meter_start: String(entry.meterStart||''),
      meter_end:   String(entry.meterEnd||''),
      off_reason:  entry.reason||entry.offReason||'',
      created_at:  entry.createdAt?new Date(entry.createdAt).toISOString():new Date(entry.ts||Date.now()).toISOString(),
    };
    // UNIQUE(record_id, date) 복합키 upsert — 파티션 테이블 대응
    await sbBatchUpsert('logs',[row],'record_id,date');
    entry.synced=true;
  } else {
    // ── Google Sheets 폴백 — 실패 시 throw ──
    await gsReq('addLogs',{logs:[entry]});
    entry.synced=true;
  }
}

// ── Supabase Realtime (실시간 Push 동기화) ──────────────────
let _rtWs = null;
let _rtReconnTimer = null;
let _rtHbTimer = null;
// 테이블별 디바운스 타이머 — 짧은 시간 내 같은 테이블 이벤트 중복 방지
const _rtDebounceTimers = {};
function _rtDebounced(tbl, fn, ms=300){
  if(_rtDebounceTimers[tbl]) clearTimeout(_rtDebounceTimers[tbl]);
  _rtDebounceTimers[tbl] = setTimeout(()=>{ delete _rtDebounceTimers[tbl]; fn(); }, ms);
}

function _initRealtime(){
  const sbUrl = DB.g(K.SB_URL,'');
  const sbKey = DB.g(K.SB_KEY,'');
  if(!sbUrl || !sbKey) return;
  if(_rtWs && (_rtWs.readyState===WebSocket.CONNECTING || _rtWs.readyState===WebSocket.OPEN)) return;
  const wsUrl = sbUrl.replace(/^https?:\/\//i, m=>m==='https://'?'wss://':'ws://')
    + '/realtime/v1/websocket?apikey=' + encodeURIComponent(sbKey) + '&vsn=1.0.0';
  try {
    _rtWs = new WebSocket(wsUrl);
    _rtWs.onopen = ()=>{
      console.log('[Realtime] 연결됨 — 변경사항 즉시 수신 활성화');
      _rtWs.send(JSON.stringify({
        topic:'realtime:public', event:'phx_join',
        payload:{ config:{ postgres_changes:[
          {event:'*',schema:'public',table:'transit'},
          {event:'*',schema:'public',table:'as_requests'},
          {event:'*',schema:'public',table:'logs'},
          {event:'*',schema:'public',table:'equipment'},
          {event:'INSERT',schema:'public',table:'notifications'},
          {event:'INSERT',schema:'public',table:'members'},
        ]}},
        ref:'1'
      }));
      if(_rtHbTimer) clearInterval(_rtHbTimer);
      _rtHbTimer = setInterval(()=>{
        if(_rtWs?.readyState===WebSocket.OPEN)
          _rtWs.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:null}));
      }, 29000);
    };
    _rtWs.onmessage = (e)=>{
      try{
        const msg = JSON.parse(e.data);
        if(msg.event==='postgres_changes' && msg.payload?.data){
          const tbl = msg.payload.data.table;
          console.log('[Realtime] 변경 감지:', tbl);
          // 300ms 디바운스 — 같은 테이블 연속 이벤트 중복 fetch 방지
          _rtDebounced(tbl, ()=>{
            // notifications/members: 알림·가입신청만 조용히 fetch
            if(tbl==='notifications'||tbl==='members'){ _fetchFromSB().catch(()=>{}); return; }
            _fetchFromSB().catch(()=>{}).then(changed=>{
              if(!changed) return;
              if(tbl==='transit'||tbl==='equipment') { renderTransit?.(); }
              else if(tbl==='as_requests') { renderASPage?.(); updateASBadge?.(); }
              else if(tbl==='logs') { _renderHomeAsync?.(); }
            });
          });
        }
      }catch(_){}
    };
    _rtWs.onclose = ()=>{
      console.log('[Realtime] 연결 끊김 — 5초 후 재연결 시도');
      if(_rtHbTimer){ clearInterval(_rtHbTimer); _rtHbTimer=null; }
      if(_rtReconnTimer) clearTimeout(_rtReconnTimer);
      _rtReconnTimer = setTimeout(_initRealtime, 5000);
    };
    _rtWs.onerror = ()=>{};
  }catch(e){ console.warn('[Realtime] 초기화 실패:', e.message); }
}
function _cleanupRealtime(){
  if(_rtHbTimer){ clearInterval(_rtHbTimer); _rtHbTimer=null; }
  if(_rtReconnTimer){ clearTimeout(_rtReconnTimer); _rtReconnTimer=null; }
  if(_rtWs){ _rtWs.onclose=null; try{_rtWs.close();}catch(_){} _rtWs=null; }
}

let _retrySyncTimer = null;
let _retrySyncCount = 0;
// 지수 백오프: 15s → 30s → 60s → 120s → 300s (총 ~8분, 5회)
const _RETRY_DELAYS = [15000, 30000, 60000, 120000, 300000];
function _setRetryStatus(msg, cls){
  try{
    const dot=document.getElementById('sdot'), txt=document.getElementById('stxt');
    if(dot) dot.className='sdot '+(cls||'warn');
    if(txt) txt.textContent=msg||'';
  }catch(_){}
}
function scheduleRetrySync(){
  if(_retrySyncTimer) return; // 이미 예약 중
  if(_retrySyncCount >= _RETRY_DELAYS.length){
    console.warn('[Sync] 재시도 한도 초과 — 중단');
    _retrySyncCount = 0;
    _setRetryStatus('동기화 실패','err');
    setTimeout(()=>{ try{ toast('서버 동기화 실패 (5회). 네트워크를 확인해주세요','err',6000); }catch(_e){} },0);
    return;
  }
  const delay = _RETRY_DELAYS[_retrySyncCount];
  _retrySyncCount++;
  _setRetryStatus(`재시도 예정 (${_retrySyncCount}/${_RETRY_DELAYS.length})…`,'warn');
  _retrySyncTimer = setTimeout(async()=>{
    _retrySyncTimer = null;
    _setRetryStatus(`동기화 중 (${_retrySyncCount}/${_RETRY_DELAYS.length})…`,'sync');
    try{
      await syncNow();
      const [unsyncL, unsyncT, unsyncA] = await Promise.all([
        IDB.getUnsynced('logs').catch(()=>[]),
        IDB.getUnsynced('transit').catch(()=>[]),
        IDB.getUnsynced('as_requests').catch(()=>[]),
      ]);
      if(!unsyncL.length && !unsyncT.length && !unsyncA.length){
        _retrySyncCount = 0;
        _setRetryStatus('동기화 완료','ok');
        setTimeout(()=>{ try{ toast('서버 재동기화 완료 ✓','ok'); }catch(_e){} },0);
      } else {
        scheduleRetrySync(); // 미동기화 항목 남아있으면 재시도
      }
    }catch(_e){ scheduleRetrySync(); }
  }, delay);
}


