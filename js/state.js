/* 전체 캐시 무효화 */
function _invalidateAll() {
  Object.keys(_cache).forEach(k => _cache[k] = null);
}

/* Default data */
const DEFAULT_SITES = [
  {id:'p4',name:'P4 복합동',active:true},
  {id:'p5g',name:'P5 복합동(골조)',active:true},
  {id:'p5f',name:'P5 복합동(마감)',active:true},
];
const DEFAULT_COS = {
  p4: [
    {name:'세방테크',   color:'#3b8bff', equip:143},
    {name:'세보엠이씨', color:'#f97316', equip:35},
    {name:'도원',       color:'#22c55e', equip:8},
    {name:'삼영전기',   color:'#ec4899', equip:5},
    {name:'신보',       color:'#8b5cf6', equip:11},
    {name:'HLB',        color:'#94a3b8', equip:40},
    {name:'욱림',       color:'#f97316', equip:12},
    {name:'삼화피앤씨', color:'#38bdf8', equip:20},
    {name:'KSC',        color:'#e879f9', equip:11},
    {name:'삼우',       color:'#fb923c', equip:8},
    {name:'광건',       color:'#4ade80', equip:15},
    {name:'범양',       color:'#14b8a6', equip:6},
    {name:'삼영제어',   color:'#eab308', equip:10},
  ],
  p5g:[{name:'세방테크',color:'#3b8bff',equip:20},{name:'도원',color:'#22c55e',equip:5}],
  p5f:[{name:'세방테크',color:'#3b8bff',equip:15},{name:'신보',color:'#8b5cf6',equip:8}],
};
const HIST = [
  {l:'10월',r:.603},{l:'11월',r:.782},{l:'12월',r:.825},
  {l:'1월',r:.512},{l:'2월',r:.513},{l:'3월',r:.514},
  {l:'4월',r:.563},{l:'5월',r:.365},{l:'6월',r:.356},
  {l:'7월',r:.211},{l:'8월',r:.583},{l:'9월',r:.722},
];

/* ═══════════════════════════════════════════════════════════
   데이터 접근자 (IDB 기반)
   - 메모리 캐시는 오늘 날짜 데이터 + 최근 100건만 유지
   - 전체 조회는 IDB에서 직접 (메모리 부담 없음)
   - Supabase 연동 시 서버사이드 쿼리 우선
═══════════════════════════════════════════════════════════ */

// ── 인메모리 캐시: 오늘 로그만 (홈/KPI용) ───────────────
const _cache = {
  logs: null,         // 전체 로그 배열 (호환용 — IDB 전환 전까지)
  logsByDate: null,   // Map<date, log[]>
  logsByCoSite: null, // Map<co|site, log[]>
  cos: null,
  sites: null,
  transit: null,      // 반입/반출 캐시
  transitBySite: null,// Map<siteId, record[]> 인덱스
  asReqs: null,       // AS 요청 캐시
  asBySite: null,     // Map<siteId, record[]> 인덱스
  members: null,      // 협력사 관리자 캐시
  // IDB 캐시 (오늘 날짜 데이터만)
  todayLogs: null,
  todayDate:  null,
  equipment: null,    // 현재 반입 장비 마스터 캐시
};

function _invalidate(key){
  _cache[key] = null;
  if(key==='logs'){ _cache.logsByDate=null; _cache.logsByCoSite=null; _cache.todayLogs=null; }
  if(key==='transit') _cache.transitBySite=null;
  if(key==='asReqs')  _cache.asBySite=null;
}

/* ── 메모리 가드 ─────────────────────────────────────────
   5분마다 실행: 현재 보이지 않는 페이지의 대용량 캐시 해제
   performance.memory 지원 시 heap 임계치(300MB) 초과하면 강제 전체 해제
──────────────────────────────────────────────────────── */
let _memGuardLastClean = 0;
function _runMemoryGuard(){
  const now = Date.now();
  // 같은 페이지에 없으면 logs 캐시(가장 큼) 해제
  if(curPg !== 'pg-ops'){
    _cache.logs = null;
    _cache.logsByDate = null;
    _cache.logsByCoSite = null;
    _cache.todayLogs = null;
  }
  if(curPg !== 'pg-transit') _cache.transitBySite = null;
  if(curPg !== 'pg-as')      _cache.asBySite = null;

  // 진행 중이 아닌 pendingGET 만료 정리
  if(_pendingGETs.size > 10) _pendingGETs.clear();

  // performance.memory 지원 브라우저(Chrome)에서 힙 과부하 감지
  try {
    const mem = performance?.memory;
    const heapMB = Math.round(mem.usedJSHeapSize / 1048576);
    if(heapMB > 300){
      console.warn('[MemGuard] 힙 초과 — 캐시 축소:', heapMB+'MB');
      // 전체 무효화 대신 단계적 축소 (사용 중인 페이지 캐시는 유지)
      if(_cache.logs   && _cache.logs.length   > 200) _cache.logs   = _cache.logs.slice(0, 200);
      if(_cache.transit&& _cache.transit.length> 100) _cache.transit= _cache.transit.slice(0, 100);
      if(_cache.asReqs && _cache.asReqs.length > 100) _cache.asReqs = _cache.asReqs.slice(0, 100);
      _cache.logsByDate = null; _cache.logsByCoSite = null; _cache.todayLogs = null;
      _cache.transitBySite = null; _cache.asBySite = null;
      _memGuardLastClean = now;
      if(heapMB > 400){ // 400MB 초과 시 전체 해제
        _invalidateAll();
        console.warn('[MemGuard] 400MB 초과 — 전체 캐시 해제');
      }
    }
  } catch (_e) {}
}

// ── LOGS: IDB 우선 접근자 ───────────────────────────────
// 오늘 로그 (빠른 홈화면용)
async function getTodayLogs() {
  const td = today();
  if (_cache.todayLogs && _cache.todayDate === td) return _cache.todayLogs;
  try {
    const rows = await IDB.getByIndex('logs', 'date', td);
    _cache.todayLogs = rows;
    _cache.todayDate = td;
    return rows;
  } catch (_e) { return []; }
}

// 날짜 범위 로그 조회 (이력 탭용)
async function getLogsByRange(from, to, siteId=null, limit=200) {
  const sbUrl = DB.g(K.SB_URL,'');
  if(sbUrl){
    // Supabase 서버사이드 쿼리 — select=* 대신 필요 컬럼만 지정 (payload 절감)
    const LOG_COLS = 'record_id,id,date,site_id,company,floor,location_detail,equip,recorder,team,project,status,start_time,end_time,used_hours,meter_start,meter_end,off_reason,created_at';
    let q = `?select=${LOG_COLS}&date=gte.${from}&date=lte.${to}&order=created_at.desc&limit=${limit}`;
    if(siteId) q += `&site_id=eq.${siteId}`;
    try {
      const rows = await sbReq('logs','GET',null,q);
      const sbRows = Array.isArray(rows) ? rows.map(_sbLogToLocal) : [];
      // IDB에서 미동기화 로컬 항목도 병합 (날짜 범위 내 synced=false인 것)
      try {
        const idbRange = IDBKeyRange.bound(from, to);
        let idbRows = await IDB.getRange('logs', 'date', idbRange);
        if(siteId) idbRows = idbRows.filter(l => l.siteId === siteId);
        const sbIds = new Set(sbRows.map(r => r.id));
        const localOnly = idbRows.filter(r => !sbIds.has(r.id));
        // SB 0건이어도 IDB 데이터 있으면 반환 (오프라인/신규 저장 직후 포함)
        if(localOnly.length || sbRows.length === 0){
          const merged = [...sbRows, ...localOnly].sort((a,b)=>(b.ts||0)-(a.ts||0));
          if(merged.length) return merged.slice(0, limit);
        }
      } catch (_e) {}
      return sbRows;
    } catch (_e) {}
  }
  // 폴백: IDB 로컬
  try {
    const range = IDBKeyRange.bound(from, to);
    let rows = await IDB.getRange('logs', 'date', range);
    if(siteId) rows = rows.filter(l => l.siteId === siteId);
    return rows.sort((a,b)=> (b.ts||0)-(a.ts||0)).slice(0, limit);
  } catch (_e) { return []; }
}

// 호환용 동기 getLogs — 캐시된 것만 반환 (점진적 전환용)
function getLogs(){
  if(!_cache.logs){
    _cache.logs = DB.g(K.LOGS,[]);
    _buildLogIndex(_cache.logs);
  }
  return _cache.logs;
}
function getLogsByDate(date){
  if(!_cache.logsByDate) getLogs();
  return _cache.logsByDate?.get(date) || [];
}

// 새 로그 저장 (IDB + 로컬스토리지 동시)
async function saveLog(entry) {
  entry.updatedAt = Date.now();
  try { await IDB.put('logs', entry); } catch(e){ console.warn('[IDB] put 실패:', e); }
  // 캐시 업데이트
  if(_cache.todayLogs && entry.date === today()) {
    _cache.todayLogs = _cache.todayLogs.filter(l=>l.id!==entry.id);
    _cache.todayLogs.unshift(entry);
  }
  if(_cache.logs){
    const idx = _cache.logs.findIndex(l=>l.id===entry.id);
    if(idx>=0) _cache.logs[idx]=entry; else _cache.logs.unshift(entry);
    // LRU: 메모리 캐시 최신 1000건 유지
    if(_cache.logs.length > 1000) _cache.logs = _cache.logs.slice(0, 1000);
    _buildLogIndex(_cache.logs);
    DB.s(K.LOGS, _cache.logs.slice(0,200)); // 최신 200건만 LS에 백업
  }
}
async function saveLogs(logs, _newEntry){
  // LRU: 메모리 캐시 최신 1000건 제한 (전체는 IDB에 보존)
  _cache.logs = logs.length > 1000 ? logs.slice(0, 1000) : logs;
  if(_newEntry && _cache.logsByDate) _addToIndex(_newEntry);
  else _buildLogIndex(_cache.logs);
  DB.s(K.LOGS, logs.slice(0,200)); // LS 먼저 저장 (캐시 무효화 경합 방지)
  try { await IDB.putAll('logs', logs); } catch (_e) {}
  _cache.todayLogs = null;
}

// ── TRANSIT ────────────────────────────────────────────
function getTransit(){
  if(!_cache.transit){
    let _raw = DB.g(K.TRANSIT,[]);
    // 마이그레이션: specs 없는 레코드에서 equip 문자열 파싱하여 specs 생성
    _raw = _raw.map(r => {
      if ((!r.specs || !r.specs.length) && (r.equip || r.equip_specs)) {
        const parsed = _parseSpecString(r.equip || r.equip_specs || '');
        if (parsed.length) { r.specs = parsed; r._specsMigrated = true; }
      }
      return r;
    });
    _cache.transit = _raw;
    _buildTransitIndex(_cache.transit);
  }
  return _cache.transit;
}
function _buildTransitIndex(arr){
  const m = new Map();
  for(const r of arr){
    const k = r.siteId || 'unknown';
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  _cache.transitBySite = m;
}
function getTransitBySite(siteId){
  if(!_cache.transitBySite) getTransit();
  if(!siteId) return getTransit();
  return _cache.transitBySite.get(siteId) || [];
}
async function saveTransit(arr){
  const now = Date.now();
  arr = arr.map(r => r.updatedAt ? r : {...r, updatedAt: now});
  // 메모리 캐시는 최신 500건으로 제한 (전체는 IDB에 보존)
  _cache.transit = arr.length > 500 ? arr.slice(0, 500) : arr;
  _cache.transitBySite = null;
  DB.s(K.TRANSIT, arr.slice(0,100)); // LS 먼저 저장 (캐시 무효화 경합 방지)
  try { await IDB.putAll('transit', arr); } catch (_e) {}
}

// ── AS_REQS ────────────────────────────────────────────
function getAsReqs(){
  if(!_cache.asReqs){
    _cache.asReqs = DB.g(K.AS_REQS,[]);
    _buildAsIndex(_cache.asReqs);
  }
  return _cache.asReqs;
}
function _buildAsIndex(arr){
  const m = new Map();
  for(const a of arr){
    const k = a.siteId || 'unknown';
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(a);
  }
  _cache.asBySite = m;
}
function getAsBySite(siteId){
  if(!_cache.asBySite) getAsReqs();
  if(!siteId) return getAsReqs();
  return _cache.asBySite.get(siteId) || [];
}
async function saveAsReqs(arr){
  const now = Date.now();
  arr = arr.map(r => r.updatedAt ? r : {...r, updatedAt: now});
  // 메모리 캐시는 최신 300건으로 제한 (전체는 IDB에 보존)
  _cache.asReqs = arr.length > 300 ? arr.slice(0, 300) : arr;
  _cache.asBySite = null;
  DB.s(K.AS_REQS, arr.slice(0,100)); // LS 먼저 저장 (캐시 무효화 경합 방지)
  try { await IDB.putAll('as_requests', arr); } catch (_e) {}
}

// ── MEMBERS ────────────────────────────────────────────
function getMembers(){
  if(!_cache.members) _cache.members = DB.g(K.MEMBERS,[]);
  return _cache.members;
}
async function saveMembers(arr){
  _cache.members = arr;
  DB.s(K.MEMBERS, arr); // LS 먼저 저장 (캐시 무효화 경합 방지)
  try { await IDB.putAll('members', arr); } catch (_e) {}
}

// Supabase 응답 → 로컬 로그 형식 변환
function _sbLogToLocal(r) {
  return {
    id:             r.record_id || String(r.id),
    siteId:         r.site_id,
    date:           r.date,
    company:        r.company,
    floor:          r.floor,
    locationDetail: r.location_detail || '',
    equip:          r.equip,
    name:           r.recorder,
    team:           r.team || '',
    project:        r.project || '',
    status:         r.status,
    startTime:      r.start_time,
    endTime:        r.end_time,
    duration:       r.used_hours,
    meterStart:     r.meter_start,
    meterEnd:       r.meter_end,
    offReason:      r.off_reason,
    reason:         r.off_reason || '',
    ts:             r.created_at ? new Date(r.created_at).getTime() : 0,
    synced:         true,
  };
}

function _getSiteManager(siteId){
  if(!siteId) return null;
  const mbrs=getMembers();
  return mbrs.find(m=>m.siteId===siteId&&(m.title||'').includes('소장'))||
         mbrs.find(m=>m.siteId===siteId&&m.role==='sub')||null;
}
function _sbTransitToLocal(row){
  const specs=_parseSpecString(row.equip_specs||'');
  return {
    id:             row.record_id||String(row.id),
    date:           row.date,
    type:           row.type==='반입'?'in':row.type==='반출'?'out':row.type,
    siteId:         row.site_id,
    siteName:       row.site_name,
    company:        row.company,
    equip:          row.equip_specs||'',
    specs:          specs,
    ajEquip:        row.aj_equip,
    reporterName:   row.reporter_name,
    reporterPhone:  row.reporter_phone,
    managerName:    row.manager_name,
    managerPhone:   row.manager_phone,
    managerLocation:row.manager_location,
    note:           row.note,
    status:         row.status,
    dispatch:       row.dispatch||'',
    ajMsgs:         (()=>{try{return JSON.parse(row.messages||'[]');}catch(_e){return[];}})(),
    synced:         true,
    createdAt:      row.created_at?new Date(row.created_at).getTime():Date.now(),
    ts:             row.created_at?new Date(row.created_at).getTime():Date.now(),
  };
}
function _sbAsToLocal(row){
  let _comments=[];
  if(row.comments){ try{ const p=JSON.parse(row.comments); if(Array.isArray(p)) _comments=p; }catch(_){} }
  return {
    id:           row.record_id||String(row.id),
    date:         row.date,
    siteId:       row.site_id,
    siteName:     row.site_name,
    company:      row.company,
    equip:        row.equip,
    location:     row.location,
    type:         row.fault_type,
    faultType:    row.fault_type,
    desc:         row.description,
    reporterName: row.reporter_name,
    reporterPhone:row.reporter_phone,
    status:       row.status||'대기',
    techName:     row.tech_name||'',
    techPhone:    row.tech_phone||'',
    resolvedAt:   row.resolved_at?new Date(row.resolved_at).getTime():null,
    resolvedNote: row.resolve_note||'',
    requestedAt:  row.requested_at?new Date(row.requested_at).getTime():null,
    materialAt:   row.material_at?new Date(row.material_at).getTime():null,
    comments:     _comments,
    workerName:   row.worker_name||'',
    workerPhone:  row.worker_phone||'',
    photoThumb:   row.photo_data||null,
    updatedAt:    row.updated_at?new Date(row.updated_at).getTime():Date.now(),
    synced:       true,
    createdAt:    row.created_at?new Date(row.created_at).getTime():Date.now(),
    ts:           row.created_at?new Date(row.created_at).getTime():Date.now(),
  };
}
let _lastFetchTs=0;
let _lastNotifFetchTs = Number(DB.g('_lastNotifFetchTs','0'))||0;
function _buildNotifFilter(){
  if(!S) return null;
  const conds = [];
  if(S.role === 'aj'){
    conds.push('target_role.eq.aj');
    if(S.ajType) conds.push(`target_aj_type.eq.${encodeURIComponent(S.ajType)}`);
  } else if(S.role === 'sub'){
    conds.push('target_role.eq.sub');
  } else if(S.role === 'tech'){
    conds.push('target_role.eq.tech');
  }
  if(S.memberId) conds.push(`target_user_id.eq.${encodeURIComponent(S.memberId)}`);
  return conds.length ? `or=(${conds.join(',')})` : null;
}
async function _fetchFromSB(){
  const sbUrl=DB.g(K.SB_URL,'');
  if(!sbUrl||!S) return false;
  try{
    const siteId=S?.siteId==='all'?null:S?.siteId;
    const siteFilter=siteId?`&site_id=eq.${encodeURIComponent(siteId)}`:'';
    const since=new Date(); since.setDate(since.getDate()-30);
    const sinceStr=since.toISOString();
    // select=* 대신 필요한 컬럼만 지정 → payload 30~50% 절감
    const TR_COLS = 'record_id,id,date,type,site_id,site_name,company,equip_specs,aj_equip,reporter_name,reporter_phone,manager_name,manager_phone,manager_location,note,status,messages,dispatch,created_at,updated_at';
    const AS_COLS = 'record_id,id,date,site_id,site_name,company,equip,location,fault_type,description,reporter_name,reporter_phone,status,tech_name,tech_phone,resolved_at,resolve_note,requested_at,material_at,comments,worker_name,worker_phone,photo_data,created_at,updated_at';

    // 컬럼 오류 시 select=* fallback 헬퍼
    const _sbGetWithFallback = async (table, q, fallbackQ) => {
      try {
        return await sbReq(table, 'GET', null, q);
      } catch(e) {
        if(e?.message?.includes('column') || e?.message?.includes('PGRST')){
          console.warn(`[_fetchFromSB] ${table} 컬럼 오류 — select=* fallback:`, e.message);
          return sbReq(table, 'GET', null, fallbackQ);
        }
        throw e;
      }
    };

    // transit: 최근 30일 생성 OR 아직 예정 상태(지연 포함) — 날짜 필터로 누락 방지
    const trOrFilter = encodeURIComponent('예정');
    const [trRows, asRows] = await Promise.all([
      _sbGetWithFallback(
        'transit',
        `?select=${TR_COLS}${siteFilter}&or=(created_at.gte.${sinceStr},status.eq.${trOrFilter})&order=created_at.desc&limit=300`,
        `?select=*${siteFilter}&or=(created_at.gte.${sinceStr},status.eq.${trOrFilter})&order=created_at.desc&limit=300`
      ),
      _sbGetWithFallback(
        'as_requests',
        `?select=${AS_COLS}${siteFilter}&order=created_at.desc&limit=200`,
        `?select=*${siteFilter}&order=created_at.desc&limit=200`
      ),
    ]);
    let changed=false;
    if(Array.isArray(trRows)&&trRows.length){
      const local=getTransit();
      const localMap=new Map(local.map(t=>[t.id,t]));
      for(const row of trRows){
        const lid=row.record_id||String(row.id);
        const loc=localMap.get(lid);
        if(!loc){ local.unshift(_sbTransitToLocal(row)); changed=true; }
        else {
          // ── 서버 우선(Server-First) 머지 ──────────────────────
          const srvTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          const locTs = loc.updatedAt || loc.ts || 0;
          let itemChanged = false;
          // status: 항상 서버 우선
          if(row.status && loc.status!==row.status){ loc.status=row.status; itemChanged=true; }
          // dispatch, ajEquip, managerLocation: 서버 우선
          if(row.dispatch !== undefined && loc.dispatch!==row.dispatch){ loc.dispatch=row.dispatch||''; itemChanged=true; }
          if(row.aj_equip !== undefined && loc.ajEquip!==row.aj_equip){ loc.ajEquip=row.aj_equip||''; itemChanged=true; }
          if(row.manager_location !== undefined && loc.managerLocation!==row.manager_location){ loc.managerLocation=row.manager_location||''; itemChanged=true; }
          // equip_specs: 로컬 specs가 없을 때 서버에서 보충 (반입지연 등 표시 누락 방지)
          if(row.equip_specs && (!loc.specs || !loc.specs.length)){
            const _ps=_parseSpecString(row.equip_specs);
            if(_ps.length){ loc.specs=_ps; loc.equip=row.equip_specs; itemChanged=true; }
            else if(!loc.equip && row.equip_specs){ loc.equip=row.equip_specs; itemChanged=true; }
          }
          // messages(댓글): 서버가 더 많거나 서버가 최신이면 덮어쓰기
          if(row.messages){
            try{
              const srvMsgs=JSON.parse(row.messages);
              if(Array.isArray(srvMsgs)){
                const locMsgs=loc.ajMsgs||[];
                if(srvMsgs.length>locMsgs.length||(srvMsgs.length===locMsgs.length&&srvTs>=locTs)){
                  loc.ajMsgs=srvMsgs; itemChanged=true;
                }
              }
            }catch(_){}
          }
          if(srvTs>0&&srvTs>locTs) loc.updatedAt=srvTs;
          if(!loc.synced){ loc.synced=true; itemChanged=true; }
          if(itemChanged) changed=true;
        }
      }
      if(changed) await saveTransit(local);
    }
    let asChanged=false;
    if(Array.isArray(asRows)&&asRows.length){
      const localAs=getAsReqs();
      const localAsMap=new Map(localAs.map(a=>[a.id,a]));
      for(const row of asRows){
        const lid=row.record_id||String(row.id);
        const loc=localAsMap.get(lid);
        if(!loc){ localAs.unshift(_sbAsToLocal(row)); asChanged=true; }
        else {
          // ── 서버 우선(Server-First) 머지 ──────────────────────
          const srvTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          const locTs = loc.updatedAt || loc.ts || 0;
          let itemChanged=false;
          // status: 항상 서버 우선
          if(row.status && loc.status!==row.status){ loc.status=row.status; itemChanged=true; }
          // techName, techPhone: 서버 우선
          if(row.tech_name !== undefined && loc.techName!==row.tech_name){ loc.techName=row.tech_name||''; itemChanged=true; }
          if(row.tech_phone !== undefined && loc.techPhone!==row.tech_phone){ loc.techPhone=row.tech_phone||''; itemChanged=true; }
          // resolvedAt, resolvedNote, materialAt: 서버 우선
          if(row.resolved_at){ const t=new Date(row.resolved_at).getTime(); if(loc.resolvedAt!==t){ loc.resolvedAt=t; itemChanged=true; } }
          if(row.resolve_note !== undefined && loc.resolvedNote!==row.resolve_note){ loc.resolvedNote=row.resolve_note||''; itemChanged=true; }
          if(row.material_at){ const t=new Date(row.material_at).getTime(); if(loc.materialAt!==t){ loc.materialAt=t; itemChanged=true; } }
          // comments: 서버가 더 많거나 서버가 최신이면 덮어쓰기
          if(row.comments){
            try{
              const srvC=JSON.parse(row.comments);
              if(Array.isArray(srvC)){
                const locC=loc.comments||[];
                if(srvC.length>locC.length||(srvC.length===locC.length&&srvTs>=locTs)){
                  loc.comments=srvC; itemChanged=true;
                }
              }
            }catch(_){}
          }
          // workerName, workerPhone: 서버 우선
          if(row.worker_name !== undefined && loc.workerName!==row.worker_name){ loc.workerName=row.worker_name||''; itemChanged=true; }
          if(row.worker_phone !== undefined && loc.workerPhone!==row.worker_phone){ loc.workerPhone=row.worker_phone||''; itemChanged=true; }
          if(row.photo_data && !loc.photoThumb){ loc.photoThumb=row.photo_data; itemChanged=true; }
          if(srvTs>0&&srvTs>locTs) loc.updatedAt=srvTs;
          if(!loc.synced){ loc.synced=true; itemChanged=true; }
          if(itemChanged) asChanged=true;
        }
      }
      if(asChanged){ changed=true; await saveAsReqs(localAs); }
    }
    // ── AJ관리자: members 테이블 동기화 (신규 가입 신청 반영) ────────────
    if(S?.role === 'aj'){
      const mbRows = await sbReq('members','GET',null,
        `?order=joined_at.desc&limit=500${siteFilter}`).catch(()=>[]);
      if(Array.isArray(mbRows) && mbRows.length){
        const localMb = getMembers();
        const localMbMap = new Map(localMb.map(m=>[m.id, m]));
        let mbChanged = false;
        for(const row of mbRows){
          const lid = row.record_id;
          if(!lid) continue;
          if(!localMbMap.has(lid)){
            localMb.push({
              id:lid, name:row.name||'', company:row.company||'',
              siteId:row.site_id||'', siteName:row.site_name||'',
              phone:row.phone||'', title:row.title||'', team:row.team||'',
              role:row.role||'sub', status:row.status||'approved',
              google_email:row.google_email||'', kakao_id:row.kakao_id||'',
              joinedAt:row.joined_at?new Date(row.joined_at).getTime():Date.now(),
              synced:true
            });
            mbChanged = true;
          } else {
            const loc = localMbMap.get(lid);
            if(row.status && loc.status !== row.status){ loc.status = row.status; mbChanged = true; }
          }
        }
        if(mbChanged){ changed = true; saveMembers(localMb); }
      }
    }
    // ── 크로스 디바이스 알림 수신 ────────────────────────────
    const _nFilter = _buildNotifFilter();
    if(_nFilter && _lastNotifFetchTs > 0){
      const _nSince = new Date(_lastNotifFetchTs).toISOString();
      const _sExcl  = S?.phone ? `&sender_phone=neq.${encodeURIComponent(S.phone)}` : '';
      const _nRows  = await sbReq('notifications','GET',null,
        `?${_nFilter}&created_at=gt.${_nSince}${_sExcl}&order=created_at.asc&limit=30`).catch(()=>[]);
      if(Array.isArray(_nRows) && _nRows.length){
        const _nIcons = {as_new:'🔧',as_comment:'💬',as_complete:'✅',as_material:'🔩',signup_request:'👤',signup_approved:'🎉',transit_new:'📦',mention:'💬',missing_log:'⚠'};
        let _nMaxTs = _lastNotifFetchTs;
        for(const n of _nRows){
          addNotif({icon:_nIcons[n.type]||'📢', title:n.title, desc:n.body||''});
          // OS 알림 (앱이 열려있으면 즉시, SW 통해 표시)
          if(typeof _showOSNotif==='function')
            _showOSNotif(n.title, n.body||'', n.type).catch(()=>{});
          const _t = new Date(n.created_at).getTime();
          if(_t > _nMaxTs) _nMaxTs = _t;
        }
        _lastNotifFetchTs = _nMaxTs;
        DB.s('_lastNotifFetchTs', String(_lastNotifFetchTs));
        changed = true;
      }
    }
    // ─────────────────────────────────────────────────────────
    _lastFetchTs=Date.now();
    if(changed){
      if(curPg==='pg-transit') renderTransit();
      if(curPg==='pg-as'){ renderASPage(); updateASBadge(); }
      if(curPg==='pg-home') renderHome();
      if(curPg==='pg-acct') renderAcctSubList?.();
    }
    return changed;
  }catch(e){ console.warn('[_fetchFromSB]',e); return false; }
}

// ── localStorage 용량 모니터링 ─────────────────────────────
function _checkStorageHealth(){
  const kb = DB.sizeKB();
  if(kb > 1000) console.warn('[LS] 캐시 용량:', kb+'KB — 주 저장소는 IDB/Supabase');
  return { totalKB: kb };
}

// ── 사이트 / 업체 접근자 (설정값 — localStorage) ────────────
function getSites(){
  if(!_cache.sites) _cache.sites = DB.g(K.SITES, DEFAULT_SITES);
  return _cache.sites;
}
function saveSites(arr){ _cache.sites=null; DB.s(K.SITES,arr); _pushSitesToSB(arr).catch(()=>{}); }

function getCos(siteId){
  if(!_cache.cos){
    const stored = DB.g(K.COS,{})||{};
    _cache.cos = {};
    const allIds = new Set([...Object.keys(DEFAULT_COS),...Object.keys(stored)]);
    for(const id of allIds) _cache.cos[id] = stored[id] || DEFAULT_COS[id] || [];
  }
  return _cache.cos[siteId] || [];
}
function saveCos(obj){ _cache.cos=null; DB.s(K.COS,obj); _pushCosToSB(obj).catch(()=>{}); }

// ══════════════════════════════════════════════════════════
//  장비 마스터 (현재 반입 중인 장비 목록)
//  구조: { id, equipNo, siteId, siteName, company, floor,
//           specs, transitId, status, inDate, outDate }
// ══════════════════════════════════════════════════════════
function getEquipMaster() {
  if (!_cache.equipment) {
    _cache.equipment = DB.g(K.EQUIP, []);
  }
  return _cache.equipment;
}
async function saveEquipMaster(arr) {
  _cache.equipment = arr;
  try { await IDB.putAll('equipment', arr); } catch (_e) {}
  DB.s(K.EQUIP, arr);
}

// Supabase에서 equipment 전체 로드 (앱 시작 시 or 수동 새로고침)
async function loadEquipFromSupabase() {
  try {
    const SB_URL = DB.g(K.SB_URL,'');
    const SB_KEY = DB.g(K.SB_KEY,'');
    if (!SB_URL || !SB_KEY) return;
    const res = await fetch(SB_URL + '/rest/v1/equipment?select=*&order=created_at.desc&limit=2000', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    // Supabase rows → local format
    const arr = data.map(row => ({
      id:        row.record_id || row.id,
      equipNo:   row.equip_no || '',
      serialNo:  row.serial_no || '',
      siteId:    row.site_id  || '',
      siteName:  row.site_name|| '',
      company:   row.company  || '',
      spec:      row.spec     || '',
      model:     row.model    || '',
      project:   row.project  || '',
      transitId: row.transit_id || '',
      status:    row.status   || 'active',
      inDate:    row.in_date  || '',
      outDate:   row.out_date || null,
      synced:    true,
    }));
    await saveEquipMaster(arr);
    _cache.equipment = null; // 캐시 무효화
    return arr.length;
  } catch(e) {
    console.warn('[loadEquip] 실패:', e);
  }
}

// 특정 현장+업체의 현재 반입 장비 목록 (자동완성용)
function getEquipByCompany(siteId, company) {
  const all = getEquipMaster();
  return all.filter(e =>
    e.status === 'active' &&
    (!siteId  || siteId  === 'all' || e.siteId  === siteId) &&
    (!company || e.company === company)
  );
}

// 특정 현장의 전체 반입 장비 (자동완성 — 업체 미지정 시)
function getEquipBySite(siteId) {
  const all = getEquipMaster();
  return all.filter(e =>
    e.status === 'active' &&
    (!siteId || siteId === 'all' || e.siteId === siteId)
  );
}

// 반입 완료 시 장비 등록 (transit record → equipment master)
async function registerEquipFromTransit(transitRec) {
  if (!transitRec || transitRec.type !== 'in') return;
  const arr = getEquipMaster();
  let changed = false;

  // 1) specs[].equipNos 기반 등록 (제원별 장비번호)
  for (const sp of (transitRec.specs || [])) {
    for (const eNo of (sp.equipNos || [])) {
      if (!eNo) continue;
      const exists = arr.find(e => e.equipNo === eNo && e.siteId === transitRec.siteId);
      if (!exists) {
        arr.push({
          id: 'eq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5),
          equipNo:   eNo,
          siteId:    transitRec.siteId,
          siteName:  transitRec.siteName || '',
          company:   transitRec.company  || '',
          spec:      sp.spec || '',
          model:     sp.model || '',
          project:   transitRec.project  || '',
          location:  transitRec.managerLocation || transitRec.location || '',
          transitId: transitRec.id,
          status:    'active',
          inDate:    transitRec.date,
          outDate:   null,
          synced:    false,
        });
        changed = true;
      } else if (exists.status !== 'active') {
        exists.status  = 'active';
        exists.inDate  = transitRec.date;
        exists.outDate = null;
        changed = true;
      }
    }
  }

  // 2) 구버전 호환: ajEquip 필드 fallback
  if (!changed) {
    const equipNos = transitRec.ajEquip
      ? transitRec.ajEquip.split(/[,\s]+/).map(e => e.trim().toUpperCase()).filter(Boolean)
      : [];
    for (const eNo of equipNos) {
      const exists = arr.find(e => e.equipNo === eNo && e.siteId === transitRec.siteId);
      if (!exists) {
        arr.push({
          id: 'eq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5),
          equipNo:   eNo,
          siteId:    transitRec.siteId,
          siteName:  transitRec.siteName || '',
          company:   transitRec.company  || '',
          spec:      '',
          model:     '',
          project:   transitRec.project  || '',
          location:  transitRec.managerLocation || transitRec.location || '',
          transitId: transitRec.id,
          status:    'active',
          inDate:    transitRec.date,
          outDate:   null,
          synced:    false,
        });
        changed = true;
      } else if (exists.status !== 'active') {
        exists.status  = 'active';
        exists.inDate  = transitRec.date;
        exists.outDate = null;
        changed = true;
      }
    }
  }

  if (changed) await saveEquipMaster(arr);
  return changed;
}

// 반출 완료 시 장비 상태를 'out'으로 변경
async function deregisterEquipFromTransit(transitRec) {
  if (!transitRec || transitRec.type !== 'out') return;
  const arr = getEquipMaster();
  let changed = false;

  // 모든 반출 장비번호 수집: specs[].equipNos + equip 필드 (하위 호환)
  const allEquipNos = new Set();
  for (const sp of (transitRec.specs || [])) {
    for (const eNo of (sp.equipNos || [])) {
      if (eNo) allEquipNos.add(eNo.toUpperCase().trim());
    }
  }
  if (transitRec.equip) {
    transitRec.equip.split(/[,\s]+/).map(e => e.trim().toUpperCase()).filter(Boolean)
      .forEach(e => allEquipNos.add(e));
  }

  for (const eNo of allEquipNos) {
    const found = arr.filter(e => e.equipNo === eNo && e.siteId === transitRec.siteId && e.status === 'active');
    for (const e of found) {
      e.status  = 'out';
      e.outDate = transitRec.date;
      changed   = true;
    }
  }
  if (changed) await saveEquipMaster(arr);
  return changed;
}

// ══════════════════════════════════════════════════════════
//  장비 자동완성 드롭다운 공통 유틸
// ══════════════════════════════════════════════════════════
const _ACState = {}; // 입력필드별 상태

function setupEquipAutocomplete(inputId, opts = {}) {
  /* opts: { siteIdFn, companyFn, projectFn, specFn, onSelect, multi } */
  const inp = document.getElementById(inputId);
  if (!inp || inp._acSetup) return;
  inp._acSetup = true;

  let ddId = inputId + '-ac-dd';
  let dd   = document.getElementById(ddId);
  if (!dd) {
    dd = document.createElement('div');
    dd.id        = ddId;
    dd.className = 'equip-ac-dd';
    dd.style.position = 'fixed';
    dd.style.zIndex   = '9999';
    document.body.appendChild(dd);
  }
  const _updateDDPos = () => {
    const r = inp.getBoundingClientRect();
    dd.style.top   = (r.bottom + 2) + 'px';
    dd.style.left  = r.left + 'px';
    dd.style.width = r.width + 'px';
  };

  function closeDD() { dd.style.display = 'none'; dd.innerHTML = ''; }

  function showSuggestions(val) {
    const siteId  = opts.siteIdFn  ? opts.siteIdFn()  : (S?.siteId === 'all' ? null : S?.siteId);
    const company = opts.companyFn ? opts.companyFn() : null;
    const project = opts.projectFn ? opts.projectFn() : null;
    const spec    = opts.specFn    ? opts.specFn()    : null;
    let candidates = company
      ? getEquipByCompany(siteId, company)
      : getEquipBySite(siteId);
    // 프로젝트 필터 (장비에 project 정보가 있을 경우)
    if (project) candidates = candidates.filter(e => !e.project || e.project === project);
    // 제원 필터 (장비에 spec 정보가 있을 경우)
    if (spec) candidates = candidates.filter(e => !e.spec || e.spec === spec);

    const query = val.toUpperCase().trim();
    if (query) {
      candidates = candidates.filter(e =>
        e.equipNo.includes(query) ||
        e.company.toUpperCase().includes(query)
      );
    }

    // 다중입력(multi)일 때 — 마지막 토큰만 검색
    let lastToken = query;
    if (opts.multi) {
      const parts = inp.value.split(/[,\s]+/);
      lastToken = (parts[parts.length - 1] || '').toUpperCase().trim();
      if (!lastToken) { closeDD(); return; }
      candidates = candidates.filter(e =>
        e.equipNo.includes(lastToken) ||
        e.company.toUpperCase().includes(lastToken)
      );
    }

    if (!candidates.length) { closeDD(); return; }

    _updateDDPos();
    dd.innerHTML = candidates.slice(0, 10).map(e => {
      const badge = e.company ? `<span style="font-size:10px;color:var(--tx3);margin-left:6px">${e.company}</span>` : '';
      return `<div class="equip-ac-item" data-equip="${e.equipNo}">
        <span style="font-family:monospace;font-weight:700;color:var(--blue)">${e.equipNo}</span>${badge}
        ${e.floor ? `<span style="font-size:10px;color:var(--tx3);margin-left:4px">${e.floor}</span>` : ''}
      </div>`;
    }).join('');

    dd.querySelectorAll('.equip-ac-item').forEach(item => {
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        const sel = this.dataset.equip;
        if (opts.multi) {
          const parts = inp.value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
          parts[parts.length - 1] = sel;
          inp.value = parts.join(', ') + ', ';
        } else {
          inp.value = sel;
        }
        closeDD();
        if (opts.onSelect) opts.onSelect(sel);
        inp.focus();
      });
    });

    dd.style.display = 'block';
  }

  inp.addEventListener('input',  () => showSuggestions(inp.value));
  inp.addEventListener('focus',  () => { if (inp.value.length === 0) showSuggestions(''); });
  inp.addEventListener('blur',   () => setTimeout(closeDD, 150));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDD();
    if (e.key === 'ArrowDown') {
      const first = dd.querySelector('.equip-ac-item');
      if (first) { first.focus(); e.preventDefault(); }
    }
  });

  // 아이템 키보드 탐색
  dd.addEventListener('keydown', e => {
    const items = [...dd.querySelectorAll('.equip-ac-item')];
    const idx   = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx+1].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') {
      if (idx > 0) { items[idx-1].focus(); e.preventDefault(); }
      else { inp.focus(); e.preventDefault(); }
    }
    if (e.key === 'Enter' && idx >= 0) { items[idx].dispatchEvent(new MouseEvent('mousedown')); }
    if (e.key === 'Escape') { inp.focus(); closeDD(); }
  });
}

// 자동완성 스타일 (한 번만 삽입)
(function injectACStyle() {
  if (document.getElementById('equip-ac-style')) return;
  const s = document.createElement('style');
  s.id = 'equip-ac-style';
  s.textContent = `
    .equip-ac-dd {
      display: none;
      position: fixed;
      background: var(--bg2, #1e1e2e);
      border: 1px solid var(--br, rgba(255,255,255,.1));
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.55);
      z-index: 9999;
      max-height: 220px;
      overflow-y: auto;
      margin-top: 4px;
      backdrop-filter: none;
    }
    .equip-ac-item {
      padding: 9px 12px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border);
      outline: none;
    }
    .equip-ac-item:last-child { border-bottom: none; }
    .equip-ac-item:hover, .equip-ac-item:focus {
      background: rgba(59,130,246,.12);
    }
  `;
  document.head.appendChild(s);
})();

// ── 로그 인메모리 인덱스 (최신 200건 LS 캐시용) ─────────────
function _buildLogIndex(logs){
  const byDate = new Map(), byCo = new Map();
  for(const l of logs){
    if(!byDate.has(l.date)) byDate.set(l.date,[]);
    byDate.get(l.date).push(l);
    const k = l.company+'|'+l.siteId;
    if(!byCo.has(k)) byCo.set(k,[]);
    byCo.get(k).push(l);
  }
  _cache.logsByDate = byDate; _cache.logsByCoSite = byCo;
}
function _addToIndex(entry){
  if(!_cache.logsByDate || !_cache.logsByCoSite){ _buildLogIndex(_cache.logs||[]); return; }
  if(!_cache.logsByDate.has(entry.date)) _cache.logsByDate.set(entry.date,[]);
  _cache.logsByDate.get(entry.date).unshift(entry);
  const k = entry.company+'|'+entry.siteId;
  if(!_cache.logsByCoSite.has(k)) _cache.logsByCoSite.set(k,[]);
  _cache.logsByCoSite.get(k).unshift(entry);
}
function _updateIndex(upd){
  if(!_cache.logsByDate){ _buildLogIndex(_cache.logs||[]); return; }
  const bd = _cache.logsByDate.get(upd.date)||[];
  const di = bd.findIndex(l=>l.id===upd.id); if(di>=0) bd[di]=upd;
  const bk = upd.company+'|'+upd.siteId;
  const bc = (_cache.logsByCoSite.get(bk)||[]);
  const ci = bc.findIndex(l=>l.id===upd.id); if(ci>=0) bc[ci]=upd;
}
function getLogsByCo(company, siteId){
  if(!_cache.logsByCoSite) getLogs();
  return _cache.logsByCoSite.get(company+'|'+siteId) || [];
}


function saveCos(obj){
  _cache.cos = null; // invalidate
  DB.s(K.COS, obj);
  _pushCosToSB(obj).catch(()=>{});
}
function saveSites(arr){
  _cache.sites = null;
  DB.s(K.SITES, arr);
  _pushSitesToSB(arr).catch(()=>{});
}

/* 기존 seed 더미 데이터 일회성 정리 */
function _purgeSeedLogs(){
  if(DB.g('_seedPurged','')) return; // 이미 실행됨
  const _seedNames = new Set(['김기술','이현장','박담당','최팀장','정인원']);
  const logs = getLogs();
  const clean = logs.filter(l => !_seedNames.has(l.name) && !_seedNames.has(l.recorder));
  if(clean.length < logs.length){
    saveLogs(clean);
    console.log(`[purgeSeed] 더미 로그 ${logs.length - clean.length}건 삭제됨`);
  }
  DB.s('_seedPurged','1');
}
function seedIfEmpty(){
  if(DB.g(K.LOGS,null)!==null) return;
  const logs=[];
  const now=new Date();
  const sites=getSites();
  sites.forEach(site=>{
    const cos=getCos(site.id);
    for(let d=30;d>=0;d--){
      const dt=new Date(now); dt.setDate(dt.getDate()-d);
      if(dt.getDay()===0) continue;
      const ds=dt.toISOString().split('T')[0];
      cos.slice(0,Math.min(cos.length,5)).forEach(co=>{
        if(Math.random()<.15) return;
        const startH=6+Math.floor(Math.random()*3);
        const dur=+(2+Math.random()*4).toFixed(1);
        const mStart=+(800+Math.random()*400).toFixed(1);
        logs.push({
          id:`${site.id}-${ds}-${co.name}-${Math.random().toString(36).slice(2,7)}`,
          siteId:site.id, date:ds, company:co.name,
          floor:`${6+Math.floor(Math.random()*6)}층`,
          equip:'G'+String.fromCharCode(65+Math.floor(Math.random()*6))+(1e3+Math.floor(Math.random()*9e3)),
          name:['김기술','이현장','박담당','최팀장','정인원'][Math.floor(Math.random()*5)],
          status:'end',
          startTime:`${String(startH).padStart(2,'0')}:00`,
          endTime:`${String(startH+Math.ceil(dur)).padStart(2,'0')}:00`,
          meterStart:mStart, meterEnd:+(mStart+dur).toFixed(1),
          duration:dur, reason:'', ts:dt.getTime(), synced:true,
        });
      });
    }
  });
  saveLogs(logs);
}

