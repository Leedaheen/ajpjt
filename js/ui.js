/* ═══════════════════════════════════════════
   HOME — 아코디언 상태 (re-render 후에도 유지)
═══════════════════════════════════════════ */
const _homeAcc = { analysis: false, transit: false, as: false };
function _toggleHomeAcc(key){
  _homeAcc[key] = !_homeAcc[key];
  const body = document.getElementById('home-acc-body-'+key);
  const btn  = document.getElementById('home-acc-btn-'+key);
  if(!body) return;
  body.style.display = _homeAcc[key] ? 'block' : 'none';
  if(btn) btn.innerHTML = _homeAcc[key]
    ? '▲ 접기'
    : `▼ 더보기 <span style="opacity:.7">(+${btn.dataset.extra}건)</span>`;
}
function renderHome(){
  if(!S) return;
  _renderHomeAsync().catch(e=>console.warn('[renderHome]',e));
}

async function _renderHomeAsync(){
  const dash=document.getElementById('home-dash'); if(!dash) return;
  const siteId=S.siteId==='all'?null:S.siteId;
  const td=today();

  // ── 데이터 수집 ──
  let todayAll=await getTodayLogs();
  // IDB 비어있으면 서버에서 오늘 로그 fetch (캐시 삭제 후 복구 대응)
  if(!todayAll.length){
    try{ todayAll = await getLogsByRange(td, td, null, 500); }catch(_e){}
  }
  const todayLogs=siteId?todayAll.filter(l=>l.siteId===siteId):todayAll;
  const completedToday=todayLogs.filter(l=>l.status==='end');
  const rate=todayLogs.length>0?completedToday.length/todayLogs.length:null;
  const totalHrs=completedToday.reduce((s,l)=>s+(+l.duration||0),0);

  const OUTDOOR_FLOORS=['모듈동','1F외곽'];
  const isOut=l=>OUTDOOR_FLOORS.some(f=>(l.floor||'').includes(f)||(l.locationDetail||'').includes(f));
  const todayOut=todayLogs.filter(isOut); // 날씨경고에서 사용

  // ── 총 장비 수량 (마스터 → 폴백: 오늘 고유 장비번호)
  const _equipMaster = siteId
    ? getEquipBySite(siteId)
    : getSites().flatMap(s=>getEquipBySite(s.id));
  const totalEquipCount = _equipMaster.length || new Set(todayLogs.map(l=>l.equip).filter(Boolean)).size;

  // ── 위치별(층별) 가동률 집계
  const FLOOR_ORDER = ['모듈동','1F외곽','1F','2F','3F','4F','5F','6F','7F','8F','9F'];
  const _floorGroup = l => {
    const fl = (l.floor||'').trim();
    const ld = (l.locationDetail||'').trim();
    const txt = fl || ld;
    if(txt.includes('모듈동')) return '모듈동';
    if(txt.includes('외곽'))   return '1F외곽';
    const m = txt.match(/^(\d+)F/i) || (fl+' '+ld).match(/(\d+)F/i);
    if(m){ const n=+m[1]; if(n>=1&&n<=9) return n+'F'; }
    return txt||'기타';
  };
  const floorMap = {};
  for(const l of todayLogs){
    const g = _floorGroup(l);
    if(!floorMap[g]) floorMap[g]={total:0,done:0};
    floorMap[g].total++;
    if(l.status==='end') floorMap[g].done++;
  }
  const floorEntries = [
    ...FLOOR_ORDER.filter(f=>floorMap[f]).map(f=>[f,floorMap[f]]),
    ...Object.entries(floorMap).filter(([f])=>!FLOOR_ORDER.includes(f)),
  ];

  // 업체별 현황
  const sites=siteId?[{id:siteId}]:getSites();
  const coRows=[];
  for(const site of sites)
    for(const co of getCos(site.id)){
      const cl=todayLogs.filter(l=>l.siteId===site.id&&l.company===co.name);
      if(!cl.length) continue;
      coRows.push({...co,rate:cl.filter(l=>l.status==='end').length/cl.length,cnt:cl.length});
    }
  coRows.sort((a,b)=>(b.rate||0)-(a.rate||0));

  // 미입력 업체
  const allCos=[]; for(const s of sites) for(const co of getCos(s.id)) allCos.push({...co,siteId:s.id});
  const submittedCos=new Set(todayLogs.map(l=>l.company));
  const missingCos=allCos.filter(co=>!submittedCos.has(co.name));

  // 반입반출
  const allTr=getTransit().filter(r=>siteId?r.siteId===siteId:true);
  const todayTr=allTr.filter(r=>r.date===td);
  const tmrw=new Date(); tmrw.setDate(tmrw.getDate()+1);
  const tmrwStr=tmrw.toISOString().split('T')[0];
  const tmrwTr=allTr.filter(r=>r.date===tmrwStr);
  const pendingToday=todayTr.filter(r=>!['반입완료','반출완료','인계완료','취소'].includes(r.status));
  const doneToday=todayTr.filter(r=>['반입완료','반출완료','인계완료'].includes(r.status));
  const pendingTmrw=tmrwTr.filter(r=>!['반입완료','반출완료','인계완료','취소'].includes(r.status));

  // AS
  const allAS=getAsReqs().filter(r=>siteId?r.siteId===siteId:true);
  const openAS=allAS.filter(r=>r.status!=='처리완료');
  const waitAS=openAS.filter(r=>r.status==='대기'||!r.status||r.status==='신청');
  const supplyAS=openAS.filter(r=>r.status==='자재수급중');
  const doneAS=allAS.filter(r=>r.status==='처리완료');
  const doneRate=allAS.length>0?Math.round(doneAS.length/allAS.length*100):null;
  const todayAS=allAS.filter(r=>{const d=r.requestedAt?new Date(r.requestedAt).toISOString().split('T')[0]:(r.date||''); return d===td;});

  // ── 날씨 fetch (병렬) ──
  let wx=null;
  try{
    const lat=DB.g('site_lat','37.0505'), lng=DB.g('site_lng','127.0752');
    const wr=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,temperature_2m_max,wind_speed_10m_max,weathercode&timezone=Asia%2FSeoul&forecast_days=2`);
    const wd=await wr.json();
    if(wd.daily){
      const idx=wd.daily.time.indexOf(td);
      if(idx>=0) wx={rain:wd.daily.precipitation_sum[idx]||0,wind:wd.daily.wind_speed_10m_max[idx]||0,temp:wd.daily.temperature_2m_max[idx],code:wd.daily.weathercode[idx]||0};
    }
  }catch(_){}

  const wico=c=>c===0||c===1?'☀️':c<=3?'⛅':c<=67||c<=82?'🌧':c<=77?'❄️':'🌩';
  const wxTag=wx?`<span style="font-size:10px;background:rgba(96,165,250,.12);color:#60a5fa;padding:2px 6px;border-radius:6px;font-weight:700">${wico(wx.code)} ${wx.temp!=null?wx.temp+'°C ':''}`+(wx.rain>0?wx.rain+'mm ':'')+(wx.wind>0?wx.wind+'m/s':'')+`</span>`:'';
  const wxWarn=wx&&todayOut.length>0&&(wx.rain>5||wx.wind>14)?`<div style="font-size:10px;color:#fbbf24;margin-top:4px;padding:4px 8px;background:rgba(251,191,36,.1);border-radius:6px">⚠ ${wx.rain>5?'강수':'강풍'} — 실외(모듈동/1F외곽) 고소작업 주의</div>`:'';

  const rateColor=r=>r===null?'var(--tx3)':r>=0.8?'#4ade80':r>=0.6?'#fbbf24':'#f87171';
  const pctStr=r=>r===null?'—':Math.round(r*100)+'%';

  // ── PANEL 1: 가동률 인사이트 ──
  const p1coHtml=coRows.slice(0,3).map(co=>{
    const col=rCol(co.rate);
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <div style="width:20px;height:20px;border-radius:50%;background:${co.color||'#3b82f6'}18;color:${co.color||'#3b82f6'};font-size:7px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${(co.name||'').slice(0,2)}</div>
      <span style="font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2)">${co.name}</span>
      <span style="font-size:10px;font-weight:800;color:${col};flex-shrink:0">${fPct(co.rate)}</span>
      <div style="width:40px;height:3px;background:var(--br);border-radius:2px;flex-shrink:0"><div style="height:3px;border-radius:2px;background:${col};width:${Math.round(co.rate*100)}%"></div></div>
    </div>`;
  }).join('');
  const missingBadge='';

  // ── 위치별 가동률 테이블 (N × 2, 중앙 정렬)
  const floorTableHtml = floorEntries.length ? (() => {
    const row1 = floorEntries.map(([f,v])=>`<td style="text-align:center;padding:2px 6px;white-space:nowrap;border:none">
      <div style="font-size:9px;font-weight:700;color:#e2e8f0;letter-spacing:.2px">${f}</div>
      <div style="font-size:8px;color:var(--tx3);margin-top:1px">${v.total}대</div>
    </td>`).join('');
    const row2 = floorEntries.map(([f,v])=>{
      const r=v.total>0?v.done/v.total:null;
      return `<td style="text-align:center;padding:1px 6px;border:none">
        <div style="font-size:13px;font-weight:900;color:${rateColor(r)};line-height:1.1">${r!==null?Math.round(r*100)+'%':'—'}</div>
      </td>`;
    }).join('');
    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:5px 0 2px">
      <table style="border-collapse:collapse;margin:0 auto;background:transparent;table-layout:auto">
        <tbody><tr>${row1}</tr><tr>${row2}</tr></tbody>
      </table>
    </div>`;
  })() : '';

  const panel1=`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:12px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid var(--br)">
      <span style="font-size:12px;font-weight:800">⚡ 가동률</span>
      <span style="font-size:16px;font-weight:900;color:${rateColor(rate)}">${pctStr(rate)}</span>
      ${missingBadge}
      ${wxTag}
      <button onclick="goTab('pg-ops')" style="margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:7px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#22c55e;cursor:pointer;flex-shrink:0">가동현황 →</button>
    </div>
    <div style="padding:6px 12px 8px">
      ${floorTableHtml}
      ${wxWarn}
      ${p1coHtml?`<div style="margin-top:4px">${p1coHtml}</div>`:''}
      ${coRows.length>3?`<div style="font-size:10px;color:var(--tx3);text-align:center;margin-top:2px">외 ${coRows.length-3}개 업체</div>`:''}
      ${!coRows.length&&!missingCos.length?`<div style="font-size:11px;color:var(--tx3)">오늘 입력 없음</div>`:''}
    </div>
  </div>`;

  // ── PANEL 2: 반입/반출 ──
  const _trQty = r => (r.specs||[]).length
    ? (r.specs||[]).reduce((s,sp)=>s+(+sp.qty||1),0)
    : (r.ajEquip ? r.ajEquip.split(/[,\s]+/).filter(Boolean).length : 1);
  const _trEquipStr = r => {
    const nos = [];
    (r.specs||[]).forEach(sp=>(sp.equipNos||[]).forEach(n=>nos.push(n)));
    if(!nos.length && r.ajEquip) r.ajEquip.split(/[,\s]+/).filter(Boolean).forEach(n=>nos.push(n));
    if(!nos.length) return (r.equip||'—').slice(0,14);
    return nos.length>2 ? nos.slice(0,2).join(' ')+'…' : nos.join(' ');
  };
  const trRow=r=>{
    const isIn=r.type==='in', isHo=r.type==='handover';
    const clr=isIn?'#60a5fa':isHo?'#a78bfa':'#fb923c';
    const bg =isIn?'rgba(96,165,250,.15)':isHo?'rgba(167,139,250,.15)':'rgba(251,146,60,.15)';
    const lbl=isIn?'반입':isHo?'인수인계':'반출';
    const isDone=['반입완료','반출완료','인계완료'].includes(r.status);
    const qty=_trQty(r); const eqStr=_trEquipStr(r);
    return `<div style="display:flex;align-items:center;gap:5px;padding:4px 0;opacity:${isDone?'.55':'1'}">
      <span style="font-size:8px;font-weight:800;padding:1px 4px;border-radius:3px;background:${bg};color:${clr};flex-shrink:0">${lbl}</span>
      <div style="flex:1;overflow:hidden;min-width:0;white-space:nowrap;text-overflow:ellipsis">
        <span style="font-size:10px;color:var(--tx2);font-weight:700">${r.company||'—'}</span><span style="font-size:10px;color:var(--tx2)"> · ${qty}대</span>${eqStr&&eqStr!=='—'?`<span style="font-size:10px;color:var(--tx2)"> · </span><span style="font-size:10px;font-family:monospace;color:var(--tx2)">${eqStr}</span>`:''}
      </div>
      ${isDone?`<span style="font-size:8px;color:#22c55e;flex-shrink:0">✓</span>`:`<span style="font-size:8px;color:#fbbf24;font-weight:700;flex-shrink:0">D-DAY</span>`}
    </div>`;
  };
  const trTmrwHtml=pendingTmrw.slice(0,2).map(r=>{
    const isIn=r.type==='in'; const clr=isIn?'#60a5fa':'#fb923c';
    return `<div style="display:flex;align-items:center;gap:5px;padding:2px 0">
      <span style="font-size:8px;font-weight:800;padding:1px 4px;border-radius:3px;background:${isIn?'rgba(96,165,250,.1)':'rgba(251,146,60,.1)'};color:${clr};flex-shrink:0">${isIn?'반입':'반출'}</span>
      <span style="font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2)">${r.company||'—'}</span>
      <span style="font-size:8px;color:var(--tx3);flex-shrink:0">내일</span>
    </div>`;
  }).join('');
  const trAll=[...doneToday,...pendingToday];
  const TR_FOLD=3;
  const trVisHtml=trAll.slice(0,TR_FOLD).map(trRow).join('');
  const trHidHtml=trAll.length>TR_FOLD?trAll.slice(TR_FOLD).map(trRow).join(''):'';
  const trExtra=trAll.length-TR_FOLD;
  const trAccBtn=trHidHtml?`<button id="home-acc-btn-transit" data-extra="${trExtra}"
    onclick="_toggleHomeAcc('transit')"
    style="width:100%;margin-top:4px;padding:3px 0;font-size:10px;font-weight:700;color:var(--tx3);background:none;border:none;border-top:1px solid var(--br);cursor:pointer;text-align:center">
    ${_homeAcc.transit?'▲ 접기':`▼ 더보기 <span style="opacity:.7">(+${trExtra}건)</span>`}
  </button>`:'';

  const panel2=`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:12px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid var(--br)">
      <span style="font-size:12px;font-weight:800">🚛 반입 / 반출</span>
      ${pendingToday.length>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;background:rgba(96,165,250,.15);color:#60a5fa">오늘 ${pendingToday.length}건 대기</span>`:''}
      ${doneToday.length>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;background:rgba(34,197,94,.12);color:#22c55e">${doneToday.length}건 완료</span>`:''}
      <button onclick="goTab('pg-transit')" style="margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:7px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);color:#60a5fa;cursor:pointer;flex-shrink:0">내역 →</button>
    </div>
    <div style="padding:5px 12px 6px">
      ${trVisHtml||`<div style="font-size:10px;color:var(--tx3);padding:4px 0">오늘 예정 없음</div>`}
      ${trHidHtml?`<div id="home-acc-body-transit" style="display:${_homeAcc.transit?'block':'none'}">${trHidHtml}</div>`:''}
      ${trAccBtn}
      ${trTmrwHtml?`<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--br)"><div style="font-size:9px;color:var(--tx3);margin-bottom:2px">내일 예정 <span style="opacity:.7">(영업일 기준)</span></div>${trTmrwHtml}</div>`:''}
    </div>
  </div>`;

  // ── PANEL 3: AS 현황 ──
  const AS_FOLD = 3;
  const asWaitAll = [...waitAS].sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  const asRow = r => {
    const stCol = r.status==='자재수급중'?'#f59e0b':'#f87171';
    const stBg  = r.status==='자재수급중'?'rgba(245,158,11,.15)':'rgba(248,113,113,.15)';
    const sym   = (r.type||r.faultType||'기타').slice(0,5);
    const eqNo  = (r.equip||'—').slice(0,10);
    const loc   = (r.location||'—').slice(0,10);
    return `<div style="display:flex;align-items:center;gap:5px;padding:4px 0;border-bottom:1px solid var(--br)">
      <span style="font-size:8px;font-weight:800;padding:1px 4px;border-radius:3px;background:${stBg};color:${stCol};flex-shrink:0;white-space:nowrap">${r.status||'대기'}</span>
      <div style="flex:1;overflow:hidden;min-width:0;white-space:nowrap;text-overflow:ellipsis">
        <span style="font-size:10px;color:var(--tx2);font-weight:700">${r.company||'—'}</span><span style="font-size:10px;color:#f87171"> · ${sym}</span>${eqNo&&eqNo!=='—'?`<span style="font-size:10px;color:var(--tx2)"> · </span><span style="font-size:10px;font-family:monospace;color:var(--tx2)">${eqNo}</span>`:''}${loc&&loc!=='—'?`<span style="font-size:10px;color:var(--tx2)"> · </span><span style="font-size:10px;color:var(--tx2)">${loc}</span>`:''}${r.desc?`<span style="font-size:10px;color:var(--tx2)"> · </span><span style="font-size:10px;color:var(--tx2)">${esc(r.desc)}</span>`:''}
      </div>
    </div>`;
  };
  const asVisHtml = asWaitAll.slice(0,AS_FOLD).map(asRow).join('');
  const asHidHtml = asWaitAll.length>AS_FOLD ? asWaitAll.slice(AS_FOLD).map(asRow).join('') : '';
  const asExtra   = asWaitAll.length - AS_FOLD;
  const asAccBtn  = asHidHtml ? `<button id="home-acc-btn-as" data-extra="${asExtra}"
    onclick="_toggleHomeAcc('as')"
    style="width:100%;margin-top:4px;padding:3px 0;font-size:10px;font-weight:700;color:var(--tx3);background:none;border:none;border-top:1px solid var(--br);cursor:pointer;text-align:center">
    ${_homeAcc.as?'▲ 접기':`▼ 더보기 <span style="opacity:.7">(+${asExtra}건)</span>`}
  </button>` : '';

  const panel3=`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:12px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-bottom:1px solid var(--br)">
      <span style="font-size:12px;font-weight:800">🔧 AS 현황</span>
      ${openAS.length>0?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;background:rgba(248,113,113,.12);color:#f87171">${openAS.length}건 미처리</span>`:''}
      ${doneRate!==null?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;background:rgba(34,197,94,.1);color:#22c55e">처리율 ${doneRate}%</span>`:''}
      <button onclick="goTab('pg-as')" style="margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:7px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);color:#f87171;cursor:pointer;flex-shrink:0">AS →</button>
    </div>
    <div style="padding:5px 12px 8px">
      <div style="display:flex;gap:6px;margin-bottom:5px">
        <div style="flex:1;padding:5px 6px;background:rgba(248,113,113,.07);border-radius:7px;text-align:center">
          <div style="font-size:9px;color:var(--tx3)">대기</div>
          <div style="font-size:15px;font-weight:900;color:#f87171">${waitAS.length}</div>
        </div>
        <div style="flex:1;padding:5px 6px;background:rgba(245,158,11,.07);border-radius:7px;text-align:center">
          <div style="font-size:9px;color:var(--tx3)">수급중</div>
          <div style="font-size:15px;font-weight:900;color:#f59e0b">${supplyAS.length}</div>
        </div>
        <div style="flex:1;padding:5px 6px;background:rgba(34,197,94,.07);border-radius:7px;text-align:center">
          <div style="font-size:9px;color:var(--tx3)">완료</div>
          <div style="font-size:15px;font-weight:900;color:#4ade80">${doneAS.length}</div>
        </div>
        <div style="flex:1;padding:5px 6px;background:rgba(96,165,250,.07);border-radius:7px;text-align:center">
          <div style="font-size:9px;color:var(--tx3)">금일신청</div>
          <div style="font-size:15px;font-weight:900;color:#60a5fa">${todayAS.length}</div>
        </div>
      </div>
      ${asVisHtml||`<div style="font-size:10px;color:var(--tx3);padding:3px 0">대기 중인 AS 없음 ✓</div>`}
      ${asHidHtml?`<div id="home-acc-body-as" style="display:${_homeAcc.as?'block':'none'}">${asHidHtml}</div>`:''}
      ${asAccBtn}
    </div>
  </div>`;

  // ── PANEL 0: 홈 운영 분석 ──
  const homeAnaQBtns = [
    {t:'missing',    l:'📊 장비 사용 현황'},
    {t:'weekly',     l:'📋 주간 운영 리포트'},
    {t:'top-equip',  l:'🏆 이달 많이 쓴 장비'},
    {t:'as-heavy',   l:'🔧 AS 잦은 장비'},
    {t:'location',   l:'📍 위치별 배포율'},
    {t:'overload',   l:'⚡ 과부하 장비'},
    {t:'shortage',   l:'🚨 장비 부족 분석'},
    {t:'pattern',    l:'👥 고객사 패턴'},
    {t:'inefficient',l:'💤 비효율 장비'},
    {t:'transit',    l:'🚛 반입/반출 데이터'},
  ].map(q=>`<button class="ai-qbtn" onclick="_askAIHome('${q.t}')">${q.l}</button>`).join('');

  const panel0=`<div class="ai-panel" style="margin-bottom:0">
    <div class="ai-hd">
      <div class="ai-tag">데이터 분석</div>
      <div style="font-size:12px;font-weight:700;margin-left:2px">운영 분석 리포트</div>
      <button onclick="goTab('pg-ops');setTimeout(()=>setOpsTab('ana',document.getElementById('opst-ana')),150)" style="margin-left:auto;font-size:10px;font-weight:700;padding:3px 8px;border-radius:7px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);color:#60a5fa;cursor:pointer;flex-shrink:0">분석탭 →</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px">${homeAnaQBtns}</div>
    <div id="home-analysis-result"></div>
  </div>`;

  dash.innerHTML=panel0+panel1+panel2+panel3;
  // 기본 분석: 미입력 업체
  _askAIHome('missing');
}


/* ═══════════════════════════════════════════
   INPUT FORM
═══════════════════════════════════════════ */
let inputMode='start';
function setInputMode(m){
  inputMode=m;
  document.getElementById('it-start').className='it'+(m==='start'?' on-start':'');
  document.getElementById('it-end'  ).className='it'+(m==='end'?  ' on-end':'');
  document.getElementById('it-idle' ).className='it'+(m==='idle'? ' on-end':'');
  document.getElementById('start-fields').style.display=m==='start'?'block':'none';
  document.getElementById('end-fields'  ).style.display=m==='end'?  'block':'none';
  document.getElementById('idle-fields' ).style.display=m==='idle'? 'block':'none';
  document.getElementById('btn-start').style.display=m==='start'?'flex':'none';
  document.getElementById('btn-end'  ).style.display=m==='end'?  'flex':'none';
  document.getElementById('btn-idle' ).style.display=m==='idle'? 'flex':'none';
  if(m==='end') populateOpenSessions();
  if(m==='idle'){
    document.getElementById('f-idle-date').value=today();
    const idleToday=document.getElementById('f-idle-today'); if(idleToday) idleToday.textContent=today();
    document.getElementById('f-idle-site-disp').textContent=S?.siteName||'—';
    document.getElementById('f-idle-co-disp').textContent=S?.company||'—';
  }
}

function initInputForm(){
  if(!S) return;
  const fd=document.getElementById('f-date'); if(!fd) return; // 아직 폼 미삽입
  fd.value=today();
  const fst=document.getElementById('f-starttime'); if(fst) fst.value=nowHM();
  const fet=document.getElementById('f-endtime');   if(fet) fet.value=nowHM();
  document.getElementById('g-ico').textContent=S.role==='tech'?'기술':S.role==='sub'?'담당':'AJ';
  const _titleSuffix = (S.role==='sub'&&S.title)?` <span style="font-size:10px;font-weight:500;color:var(--tx3);margin-left:4px">${S.title}</span>`:'';
  document.getElementById('g-name').innerHTML = S.name + _titleSuffix;
  const _teamSuffix=S.team?` (${S.team}팀)`:'';
  document.getElementById('g-sub').textContent=`${S.company}${_teamSuffix} · ${S.siteName}`;
  document.getElementById('f-site-disp').textContent=S.siteName;
  document.getElementById('f-co-disp').textContent=S.company;
  // reset
  const _fsel2=document.getElementById('f-floor-select'); if(_fsel2) _fsel2.value='';
  const _fdet2=document.getElementById('f-location-detail'); if(_fdet2) _fdet2.value='';
  // QR 자동입력 유지 — 스캔 후 15초 이내 fetchFromSB 재호출에도 값 보존
  const _qrActive = window._pendingQrEquip && (Date.now()-(window._pendingQrEquipTs||0))<15000;
  document.getElementById('f-equip').value = _qrActive ? window._pendingQrEquip : '';
  document.getElementById('f-meter-start').value='';
  document.getElementById('f-meter-end').value='';
  const isAJ2 = S?.role === 'aj';
  const _setRO = (id, ro) => { const el=document.getElementById(id); if(el){ el.readOnly=ro; el.style.opacity=ro?'.55':'1'; el.style.pointerEvents=ro?'none':''; } };
  _setRO('f-date',     true);      // 날짜는 모든 역할 수정 불가 (자동 오늘 날짜)
  _setRO('f-starttime',true);      // 신청 시작시간도 자동 입력 후 수정 불가
  _setRO('f-endtime',  !isAJ2);
  // 팀명 자동 입력 (tech: 세션 팀명으로 pre-fill 후 수정 가능, AJ: 직접 입력)
  const _fTeamEl = document.getElementById('f-team');
  if(_fTeamEl){
    _fTeamEl.value = S.team || '';
    _fTeamEl.readOnly = false; // 모든 역할 수정 가능
    _fTeamEl.style.opacity = ''; _fTeamEl.style.pointerEvents = '';
  }
  // 프로젝트 칩 채우기
  const _opsProjects = getSites().find(s=>s.id===S?.siteId)?.projects||[];
  const _opsProjEl = document.getElementById('ops-project-chips');
  const _opsProjRow = document.getElementById('fg-ops-project');
  if(_opsProjEl && _opsProjRow){
    _opsProjRow.style.display = _opsProjects.length ? '' : 'none';
    _opsProjEl.innerHTML = _opsProjects.map(p=>`<div class="chip" onclick="selectOne(this,'ops-project-chips')">${p}</div>`).join('');
  }
  setInputMode('start');
  updatePendingBanner();
}

function updatePendingBanner(){
  if(!S) return;
  getTodayLogs().then(all=>{
    const open=all.filter(l=>l.status==='start'&&l.company===S.company&&l.siteId===S.siteId);
    const banner=document.getElementById('pending-banner');
    if(!banner) return;
    banner.classList.toggle('on',open.length>0);
    if(open.length>0) document.getElementById('pending-count').textContent=open.length;
  }).catch(()=>{});
}

function populateOpenSessions(){
  _populateOpenSessionsAsync().catch(()=>{});
}
async function _populateOpenSessionsAsync(){
  const td=today();
  const siteId = S?.siteId==='all' ? null : S?.siteId;
  const isAJ = S?.role==='aj';
  const isTech = S?.role==='tech';
  let open = await IDB.getByIndex('logs','date',td).catch(()=>getLogsByDate(td));
  open = open.filter(l=>{
    if(l.status!=='start') return false;
    if(siteId && l.siteId!==siteId) return false;
    // H7: sub·tech 역할은 자신의 회사 세션만 표시
    if(!isAJ && S?.company && l.company!==S.company) return false;
    return true;
  });
  const sel=document.getElementById('f-open-session');
  if(!sel) return;
  sel.innerHTML = open.length
    ? '<option value="">종료할 장비 선택</option>'+open.map(l=>`<option value="${l.id}">${l.equip} · ${l.company} · ${l.floor||''} · ${l.startTime||''}~</option>`).join('')
    : '<option value="">미종료 세션 없음</option>';
}

function selectOne(el,groupId){
  document.querySelectorAll(`#${groupId} .chip`).forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
}

// ── 장비마스터 미등록 장비번호 확인 팝업 ────────────────────
function _confirmUnknownEquip(nos){
  return new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10001;display:flex;align-items:center;justify-content:center';
    ov.innerHTML=`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:18px;padding:24px 20px;max-width:300px;width:88%;text-align:center">
      <div style="font-size:18px;font-weight:900;color:#fbbf24;margin-bottom:10px">⚠️ 보유 장비 아님</div>
      <div style="font-size:12px;font-family:monospace;color:#60a5fa;margin-bottom:6px">${nos.join(', ')}</div>
      <div style="font-size:11px;color:var(--tx2);line-height:1.6;margin-bottom:20px">해당 현장의 장비마스터에 등록되지 않은 장비번호입니다.<br>계속 진행하시겠습니까?</div>
      <div style="display:flex;gap:10px">
        <button id="_cueq_no" style="flex:1;padding:10px;border-radius:10px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:#f87171;font-size:14px;font-weight:700;cursor:pointer">취소</button>
        <button id="_cueq_yes" style="flex:1;padding:10px;border-radius:10px;background:rgba(251,191,36,.15);border:2px solid rgba(251,191,36,.5);color:#fbbf24;font-size:14px;font-weight:900;cursor:pointer">계속</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done=v=>{ov.remove();resolve(v);};
    ov.querySelector('#_cueq_yes').onclick=()=>done(true);
    ov.querySelector('#_cueq_no').onclick=()=>done(false);
    ov.onclick=e=>{if(e.target===ov)done(false);};
  });
}

async function submitStart(){
  if(!S) return;
  const date=document.getElementById('f-date').value;
  const equip=document.getElementById('f-equip').value.toUpperCase().trim();
  const floors = document.getElementById('f-floor-select')?.value || '';
  const locationDetail = document.getElementById('f-location-detail')?.value.trim() || '';
  const project = document.querySelector('#ops-project-chips .chip.on')?.textContent || '';
  const opsProjects = getSites().find(s=>s.id===S?.siteId)?.projects||[];
  const meterStartVal = document.getElementById('f-meter-start').value.trim();
  if(!equip){ toast('장비번호를 입력하세요','err'); return; }
  if(!locationDetail){ toast('상세위치를 입력하세요','err'); document.getElementById('f-location-detail')?.focus(); return; }
  if(!meterStartVal){ toast('계기판 시작 시간을 입력하세요','err'); document.getElementById('f-meter-start')?.focus(); return; }
  if(opsProjects.length && !project){ toast('프로젝트를 선택하세요','err'); return; }
  // H5: 동일 장비 중복 사용신청 방지 — 이미 진행 중인 세션 확인
  const _todaySiteId = S.siteId==='all' ? (document.getElementById('f-site-sel')?.value||getSites()[0]?.id||'') : S.siteId;
  const _openDup = getLogs().find(l => l.equip===equip && l.siteId===_todaySiteId && l.status==='start' && l.date===date);
  if(_openDup){
    const _goAnyway = await new Promise(res=>{
      const _msg = `[${equip}] 이미 사용 중인 장비입니다.\n(${_openDup.company} · ${_openDup.startTime||''} 시작)\n\n계속 등록하시겠습니까?`;
      res(confirm(_msg));
    });
    if(!_goAnyway) return;
  }
  // 장비마스터 유효성 검사 — 보유 장비 아니면 확인 팝업
  const _opsSiteId = _todaySiteId;
  const _opsKnownNos = getEquipBySite(_opsSiteId).map(e=>e.equipNo);
  if(_opsKnownNos.length && !_opsKnownNos.includes(equip)){
    const _go = await _confirmUnknownEquip([equip]);
    if(!_go) return;
  }
  const btn=document.getElementById('btn-start');
  btn.classList.add('loading'); btn.disabled=true;
  const team = document.getElementById('f-team')?.value.trim() || S.team || '';
  const entry={
    id:`${S.siteId}-${date}-${S.company}-${equip}-${(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,12):Date.now().toString(36)+Math.random().toString(36).slice(2,7))}`,
    siteId:S.siteId, date, company:S.company,
    floor:floors, locationDetail, equip, name:S.name, project, team,
    meterStart:+document.getElementById('f-meter-start').value||null,
    meterEnd:null, duration:null,
    startTime:document.getElementById('f-starttime').value,
    endTime:null, status:'start',
    reason:'', ts:Date.now(), synced:false,
  };
  try {
    spinner(true,'사용 신청 저장 중...');
    // ① 서버 우선 저장 (실패 시 throw)
    await pushToGS(entry);
    // ② IDB 로컬 저장 (synced=true 포함)
    await saveLog(entry);
    // 장비별 층수 데이터 수집 (새 층수로 덮어쓰기)
    if(equip && floors){ const _fm=DB.g('equip_floors',{}); _fm[equip]={floor:floors,detail:locationDetail}; DB.s('equip_floors',_fm); }
    // 장비마스터 위치(층수) 자동 업데이트 — 해당 장비 기록이 있을 때만
    if(equip && (floors || locationDetail)){
      const _em = getEquipMaster();
      const _ei = _em.findIndex(e=>e.equipNo===equip && e.siteId===_opsSiteId && e.status==='active');
      if(_ei>=0){
        const _newLoc = locationDetail || floors;
        if(_newLoc && (_em[_ei].location!==_newLoc || _em[_ei].floor!==floors)){
          _em[_ei].location = _newLoc;
          if(floors) _em[_ei].floor = floors;
          _em[_ei].synced = false;
          await saveEquipMaster(_em);
        }
      }
    }
    toast('사용 신청 완료 ✓', 'ok');
    updatePendingBanner(); updateLogBadge();
    // ③ 이력 목록 즉시 갱신
    if(document.getElementById('log-body')){ clearTimeout(_logLoadTimer); _doRenderLog(); }
    document.getElementById('f-equip').value='';
    document.getElementById('f-meter-start').value='';
    document.getElementById('f-starttime').value=nowHM();
    const _fsel=document.getElementById('f-floor-select'); if(_fsel) _fsel.value='';
    const _fdet=document.getElementById('f-location-detail'); if(_fdet) _fdet.value='';
    document.querySelectorAll('#ops-project-chips .chip.on').forEach(c=>c.classList.remove('on'));
  } catch(e) {
    // 서버 저장 실패 → 로컬 저장 후 재시도 예약
    console.warn('[submitStart]', e.message);
    entry.synced=false;
    try{ await saveLog(entry); }catch(_){}
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false); btn.classList.remove('loading'); btn.disabled=false;
  }
}

async function submitEnd(){
  const sessionId=document.getElementById('f-open-session').value;
  if(!sessionId){ toast('종료할 장비를 선택하세요','err'); return; }
  // IDB에서 해당 세션 조회
  let entry = null;
  try { entry = (await IDB.getByIndex('logs','status','start')).find(l=>l.id===sessionId); } catch(_e){}
  if(!entry){
    // 폴백: 메모리 캐시
    const logs=getLogs(); const idx=logs.findIndex(l=>l.id===sessionId);
    if(idx>=0) entry=logs[idx];
  }
  if(!entry){ toast('세션을 찾을 수 없습니다','err'); return; }
  const meterEndVal = document.getElementById('f-meter-end').value.trim();
  if(!meterEndVal){ toast('계기판 종료 시간을 입력하세요','err'); document.getElementById('f-meter-end')?.focus(); return; }
  // C5: 미터기 역행 방지 — 종료값이 시작값보다 작으면 입력 오류
  if(entry.meterStart!=null && +meterEndVal < entry.meterStart){
    toast(`계기판 종료값(${meterEndVal})이 시작값(${entry.meterStart})보다 작습니다`,'err'); return;
  }
  const btn=document.getElementById('btn-end');
  const endTime=document.getElementById('f-endtime').value;
  // C4: 종료시간 > 시작시간 검증 (meter 값이 없을 때만 시간 기준 체크)
  if(entry.startTime && endTime && endTime < entry.startTime){
    toast(`종료시간(${endTime})이 시작시간(${entry.startTime})보다 빠릅니다`, 'err'); return;
  }
  btn.classList.add('loading'); btn.disabled=true;
  const meterEnd=+meterEndVal||null;
  // 실제 타임스탬프 기반 사용시간 계산 (ts=신청시각, endTs=종료시각)
  const endTs = Date.now();
  let dur=null;
  if(entry.ts){
    dur = +((endTs - entry.ts) / 3600000).toFixed(2);
  } else if(meterEnd&&entry.meterStart){
    dur=+(meterEnd-entry.meterStart).toFixed(2);
  } else if(entry.startTime&&endTime){
    const [sh,sm]=entry.startTime.split(':').map(Number);
    const [eh,em]=endTime.split(':').map(Number);
    dur=+((eh*60+em-sh*60-sm)/60).toFixed(2);
  }
  entry.status='end'; entry.endTime=endTime; entry.endTs=endTs; entry.meterEnd=meterEnd;
  entry.duration=dur; entry.reason=document.querySelector('#reason-chips .chip.on')?.textContent||'';
  entry.synced=false;
  try {
    spinner(true,'사용 종료 저장 중...');
    await pushToGS(entry);         // ① 서버(Supabase) 우선 저장 (실패 시 throw)
    await saveLog(entry);          // ② IDB 저장 (synced=true 포함)
    toast(`사용 종료 완료 ✓${dur?' ('+fH(dur)+')':''}`, 'ok');
    updatePendingBanner(); updateLogBadge();
    // ③ 이력 목록 즉시 갱신
    if(document.getElementById('log-body')){ clearTimeout(_logLoadTimer); _doRenderLog(); }
    _fetchFromSB().catch(()=>{});   // 다른 기기 변경사항 병행 동기화
    document.getElementById('f-meter-end').value='';
    populateOpenSessions();
  } catch(e) {
    console.warn('[submitEnd]', e.message);
    entry.synced=false;
    try{ await saveLog(entry); }catch(_){}
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false); btn.classList.remove('loading'); btn.disabled=false;
  }
}

/* ═══════════════════════════════════════════
   미가동 입력
═══════════════════════════════════════════ */
async function submitIdle(){
  if(!S) return;
  const date=document.getElementById('f-idle-date').value||today();
  const equip=document.getElementById('f-idle-equip').value.trim();
  const reason=document.querySelector('#idle-reason-chips .chip.on')?.textContent||'';
  const note=document.getElementById('f-idle-note').value.trim();
  if(!equip){ toast('장비번호를 입력하세요','err'); return; }
  if(!reason){ toast('미가동 사유를 선택하세요','err'); return; }
  const btn=document.getElementById('btn-idle');
  btn.classList.add('loading'); btn.disabled=true;
  // 여러 장비 처리 (쉼표 구분 or "전체")
  const equipList = equip==='전체' ? ['전체'] : equip.split(',').map(e=>e.trim()).filter(Boolean);
  const entries = equipList.map(eq=>({
    id:`idle-${S.siteId}-${date}-${S.company}-${eq}-${(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,12):Date.now().toString(36)+Math.random().toString(36).slice(2,7))}`,
    type:'idle', siteId:S.siteId, date, company:S.company,
    equip:eq, name:S.name, reason, note, status:'idle', ts:Date.now(), synced:false,
  }));
  try {
    spinner(true,'미가동 등록 저장 중...');
    for(const e of entries){
      await pushToGS(e);            // ① 서버 우선 저장 (실패 시 throw)
      await saveLog(e);             // ② IDB 저장 (synced=true 포함)
      _pushIdleLogToSB(e).catch(()=>{}); // idle_logs 테이블 별도 저장 (fire-and-forget)
    }
    toast(`미가동 등록 완료 ✓ (${equipList.length}건)`, 'ok');
    document.getElementById('f-idle-equip').value='';
    document.getElementById('f-idle-note').value='';
    document.querySelectorAll('#idle-reason-chips .chip.on').forEach(c=>c.classList.remove('on'));
  } catch(e) {
    console.warn('[submitIdle]', e.message);
    for(const e2 of entries){ e2.synced=false; try{ await saveLog(e2); }catch(_){} }
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false); btn.classList.remove('loading'); btn.disabled=false;
  }
}

/* ═══════════════════════════════════════════
   초대코드 유틸
═══════════════════════════════════════════ */
function autoRotateInvite(){
  const thisMonth=new Date().toISOString().slice(0,7);
  const lastSet=DB.g('invite_set_month','');
  if(lastSet>=thisMonth) return;
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const genCode=()=>{ let c=''; for(let i=0;i<8;i++) c+=chars[Math.floor(Math.random()*chars.length)]; return c; };
  // 현장별 개별 코드 생성
  const sites = getSites();
  for(const s of sites){
    const code = genCode();
    DB.s(K.INVITE_SITE + s.id, code);
    _pushInviteCodeToSB(s.id, code).catch(()=>{});
  }
  // 전체 기본 코드도 갱신
  DB.s(K.INVITE, genCode());
  DB.s('invite_set_month', thisMonth);
  addNotif({icon:'', title:'초대코드 자동 변경', desc:`${thisMonth} 현장별 초대코드가 갱신되었습니다`});
}
function copyInviteCodeSite(siteId){
  const el = document.getElementById('invite-code-'+siteId);
  const code = el?.textContent||'';
  navigator.clipboard?.writeText(code).then(()=>toast('복사됨','ok'))
    .catch(()=>{ try{ const r=document.createRange(); r.selectNode(el); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); document.execCommand('copy'); toast('복사됨','ok'); }catch(_e){} });
}
function shareInviteCodeSite(siteId, siteName){
  const el = document.getElementById('invite-code-'+siteId);
  const code = el?.textContent?.trim()||'';
  const txt = `[${siteName}] AJ네트웍스 가동현황 앱 초대코드: ${code}`;
  const fallback = ()=>{
    if(navigator.clipboard){
      navigator.clipboard.writeText(txt).then(()=>toast('공유 텍스트 복사됨','ok')).catch(()=>{});
    } else {
      try{ const t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); toast('공유 텍스트 복사됨','ok'); }catch(_e){}
    }
  };
  if(navigator.share && (typeof navigator.canShare!=='function' || navigator.canShare({text:txt}))){
    navigator.share({title:'초대코드', text:txt}).catch(fallback);
  } else {
    fallback();
  }
}
function saveInviteCodeSite(siteId, codeOverride){
  const inp = document.getElementById('new-code-'+siteId) || document.getElementById('acct-new-code-'+siteId);
  const code = (codeOverride !== undefined ? codeOverride : inp?.value || '').trim();
  if(!code || code.length < 6){ toast('6자 이상 입력하세요','err'); return; }
  DB.s(K.INVITE_SITE + siteId, code);
  _pushInviteCodeToSB(siteId, code).catch(()=>{});
  // 양쪽 표시 엘리먼트 업데이트
  const dispEl = document.getElementById('invite-code-'+siteId) || document.getElementById('acct-invite-'+siteId);
  if(dispEl) dispEl.textContent = code;
  if(inp) inp.value = '';
  toast('초대코드가 변경되었습니다','ok');
}
// 기존 함수명 호환성 유지
function copyInviteCode(){
  const sites = getSites();
  if(sites.length) copyInviteCodeSite(sites[0].id);
}
function saveInviteCode(){
  const inp = document.getElementById('new-invite-code');
  if(!inp) return;
  const code = inp.value.trim();
  if(!code||code.length<6){ toast('6자 이상 입력하세요','err'); return; }
  DB.s(K.INVITE, code); inp.value=''; toast('코드 변경됨','ok');
}

/* ═══════════════════════════════════════════
   가동현황 탭 (입력/이력/분석 통합)
═══════════════════════════════════════════ */
function setOpsTab(tab, el){
  curOpsTab = tab;
  document.querySelectorAll('.ops-tab').forEach(t=>t.classList.remove('on'));
  if(el) el.classList.add('on');
  else document.getElementById('opst-'+tab)?.classList.add('on');
  document.getElementById('ops-input-panel').style.display = tab==='input'?'block':'none';
  document.getElementById('ops-log-panel').style.display   = tab==='log'  ?'block':'none';
  document.getElementById('ops-ana-panel').style.display   = tab==='ana'  ?'block':'none';
  if(tab==='input'){ initInputForm(); _fetchFromSB().catch(()=>{}); }
  if(tab==='log'){
    renderOpsLog();
    _fetchFromSB().then(()=>{ if(curOpsTab==='log') _doRenderLog(); }).catch(()=>{ if(curOpsTab==='log') _doRenderLog(); });
  }
  if(tab==='ana')  { renderAnalysis(); _fetchFromSB().catch(()=>{}); }
}

function initOpsPanel(tab){
  // 입력 패널에 기존 입력폼 HTML 삽입 (최초 1회)
  const ip = document.getElementById('ops-input-panel');
  if(ip && !ip.querySelector('.input-tabs')){
    ip.innerHTML = _getInputFormHTML();
    _initInputFormBindings();
  }
  // 이력 패널에 검색/필터 영역 삽입 (최초 1회)
  const lp = document.getElementById('ops-log-panel');
  if(lp && !lp.querySelector('.log-sticky')){
    lp.innerHTML = _getLogPanelHTML();
  }
  setOpsTab(tab || curOpsTab);
}

function renderOpsLog(){
  const lp = document.getElementById('ops-log-panel');
  if(!lp) return;
  if(!lp.querySelector('.log-sticky')) lp.innerHTML = _getLogPanelHTML();
  renderLog();
}

function _getLogPanelHTML(){
  return `<div class="log-sticky">
    <div class="fchips floor-filter-row" id="floor-filter-chips" style="margin-bottom:6px">
      <div class="floor-fc on" data-floor="" onclick="toggleFloorF('')">전체층</div>
      <div class="floor-fc" data-floor="모듈동" onclick="toggleFloorF('모듈동')">모듈동</div>
      <div class="floor-fc" data-floor="1F 외곽" onclick="toggleFloorF('1F 외곽')">1F 외곽</div>
      <div class="floor-fc" data-floor="1F" onclick="toggleFloorF('1F')">1F</div>
      <div class="floor-fc" data-floor="2F" onclick="toggleFloorF('2F')">2F</div>
      <div class="floor-fc" data-floor="3F" onclick="toggleFloorF('3F')">3F</div>
      <div class="floor-fc" data-floor="4F" onclick="toggleFloorF('4F')">4F</div>
      <div class="floor-fc" data-floor="5F" onclick="toggleFloorF('5F')">5F</div>
      <div class="floor-fc" data-floor="6F" onclick="toggleFloorF('6F')">6F</div>
      <div class="floor-fc" data-floor="7F" onclick="toggleFloorF('7F')">7F</div>
      <div class="floor-fc" data-floor="8F" onclick="toggleFloorF('8F')">8F</div>
      <div class="floor-fc" data-floor="기타" onclick="toggleFloorF('기타')">기타</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 72px;gap:6px;margin-bottom:6px;align-items:stretch">
      <div style="display:flex;gap:4px;align-items:center;min-width:0">
        <input type="date" class="fg-input" id="log-date-from" style="flex:1;height:30px;padding:0 6px;font-size:11px;min-width:0;box-sizing:border-box" onchange="renderLog()">
        <span style="color:var(--tx3);font-size:11px;flex-shrink:0">~</span>
        <input type="date" class="fg-input" id="log-date-to" style="flex:1;height:30px;padding:0 6px;font-size:11px;min-width:0;box-sizing:border-box" onchange="renderLog()">
      </div>
      <select id="log-status-sel" class="fg-select" style="height:30px;padding:0 4px;font-size:11px;box-sizing:border-box" onchange="setLFSel(this.value)">
        <option value="all">전체 상태</option>
        <option value="open">사용중</option>
        <option value="done">종료</option>
        <option value="today">오늘</option>
      </select>
    </div>
    <div style="display:flex;gap:6px;align-items:stretch">
      <input class="log-search" id="log-q" placeholder="업체·장비번호·사용자 검색..." oninput="onLogSearch()" style="flex:1;min-width:0;margin-bottom:0">
      <button class="btn-ghost" style="flex-shrink:0;width:72px;padding:0;font-size:10px;white-space:nowrap" onclick="clearAllFilters()">초기화</button>
    </div>
  </div>
  <div class="log-body" id="log-body"></div>`;
}

function _getInputFormHTML(){
  return `<div class="greeting" id="greeting">
    <div class="g-ico" id="g-ico" style="font-size:13px;font-weight:900">기술</div>
    <div>
      <div class="g-name" id="g-name">—</div>
      <div class="g-sub" id="g-sub">—</div>
    </div>
  </div>
  <div class="input-tabs" style="grid-template-columns:1fr 1fr 1fr">
    <div class="it on-start" id="it-start" onclick="setInputMode('start')">사용 신청</div>
    <div class="it" id="it-end"  onclick="setInputMode('end')">사용 종료</div>
    <div class="it" id="it-idle" onclick="setInputMode('idle')">미가동</div>
  </div>
  <div class="pending-banner" id="pending-banner">
    <span>⏳</span>
    <span><b id="pending-count">0</b>건의 미종료 장비가 있습니다. 사용 종료를 입력해주세요.</span>
  </div>
  <div id="start-fields">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
      <div class="fg" style="margin:0"><label class="fg-lbl">날짜</label><input type="date" class="fg-input" id="f-date"></div>
      <div class="fg" style="margin:0"><label class="fg-lbl">현장</label><div class="fg-display" id="f-site-disp">—</div></div>
      <div class="fg" style="margin:0"><label class="fg-lbl">소속 업체</label><div class="fg-display" id="f-co-disp">—</div></div>
    </div>
    <div class="fg" id="fg-ops-project" style="display:none">
      <label class="fg-lbl">프로젝트 <span class="req">*</span></label>
      <div class="chips" id="ops-project-chips"></div>
    </div>
    <div class="fg" id="fg-floor">
      <label class="fg-lbl">작업 층수 <span class="req">*</span></label>
      <div style="display:flex;gap:6px">
        <div class="site-select-wrap" style="flex:1">
          <select class="fg-select" id="f-floor-select" style="width:100%">
            <option value="">선택</option>
            <option value="모듈동">모듈동</option>
            <option value="1F 외곽">1F 외곽</option>
            <option value="1F">1F</option>
            <option value="2F">2F</option>
            <option value="3F">3F</option>
            <option value="4F">4F</option>
            <option value="5F">5F</option>
            <option value="6F">6F</option>
            <option value="7F">7F</option>
            <option value="8F">8F</option>
            <option value="기타">기타</option>
          </select>
        </div>
        <input type="text" class="fg-input" id="f-location-detail" placeholder="상세 위치 *" style="flex:1;margin:0">
      </div>
    </div>
    <div class="fg">
      <label class="fg-lbl">장비번호 <span class="req">*</span> <span style="font-size:9px;font-weight:600;color:#f59e0b;margin-left:4px">📷 QR 스캔 전용</span></label>
      <input type="text" class="fg-input" id="f-equip" placeholder="QR 스캔 후 자동입력" readonly
        style="text-transform:uppercase;background:var(--bg2);color:#60a5fa;font-weight:700;cursor:default;opacity:.9" autocomplete="off">
    </div>
    <div class="fg"><label class="fg-lbl">팀명</label><input type="text" class="fg-input" id="f-team" placeholder="소속 팀명 (예: 홍길동팀)" maxlength="30"></div>
    <div class="fg"><label class="fg-lbl">신청 시작시간</label><input type="time" class="fg-input" id="f-starttime"></div>
    <div class="fg"><label class="fg-lbl">계기판 시작 시간 (h) <span class="req">*</span></label><input type="number" class="fg-input" id="f-meter-start" placeholder="예: 1234.5" step="0.1" min="0"></div>
  </div>
  <div id="end-fields" style="display:none">
    <div class="fg">
      <label class="fg-lbl">미종료 장비 선택 <span class="req">*</span></label>
      <div class="site-select-wrap"><select class="fg-select" id="f-open-session"><option value="">선택하세요</option></select></div>
    </div>
    <div class="fg"><label class="fg-lbl">사용 종료시간</label><input type="time" class="fg-input" id="f-endtime"></div>
    <div class="fg"><label class="fg-lbl">계기판 종료 시간 (h) <span class="req">*</span></label><input type="number" class="fg-input" id="f-meter-end" placeholder="예: 1238.0" step="0.1" min="0"></div>
    </div>
  </div>
  <div id="idle-fields" style="display:none">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
      <div class="fg" style="margin:0"><label class="fg-lbl">입력날짜 (수정불가)</label><div class="fg-display" id="f-idle-today">—</div></div>
      <div class="fg" style="margin:0"><label class="fg-lbl">현장</label><div class="fg-display" id="f-idle-site-disp">—</div></div>
      <div class="fg" style="margin:0"><label class="fg-lbl">업체</label><div class="fg-display" id="f-idle-co-disp">—</div></div>
    </div>
    <div class="fg"><label class="fg-lbl">미가동 날짜</label><input type="date" class="fg-input" id="f-idle-date"></div>
    <div class="fg">
      <label class="fg-lbl">장비번호 <span class="req">*</span></label>
      <input type="text" class="fg-input" id="f-idle-equip" placeholder="예: GK228, GK229 또는 전체">
    </div>
    <div class="fg">
      <label class="fg-lbl">미가동 사유 <span class="req">*</span></label>
      <div class="chips" id="idle-reason-chips">
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">휴무</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">작동불량</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">AS대기</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">반입점검</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">안전점검</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">우천/악천후</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">공정없음</div>
        <div class="chip" onclick="selectOne(this,'idle-reason-chips')">기타</div>
      </div>
    </div>
    <div class="fg"><label class="fg-lbl">비고</label><input type="text" class="fg-input" id="f-idle-note" placeholder="추가 설명"></div>
  </div>
  <div class="btn-row">
    <button class="sbtn start" id="btn-start" onclick="submitStart()">
      <div class="spin"></div><span class="btxt">사용 신청</span>
    </button>
    <button class="sbtn end" id="btn-end" onclick="submitEnd()" style="display:none">
      <div class="spin"></div><span class="btxt">사용 종료</span>
    </button>
    <button class="sbtn" id="btn-idle" onclick="submitIdle()" style="display:none;background:linear-gradient(135deg,#6b7280,#4b5563)">
      <div class="spin"></div><span class="btxt">미가동 등록</span>
    </button>
  </div>`;
}

function _initInputFormBindings(){
  // 날짜 기본값
  const fd = document.getElementById('f-date');
  if(fd && !fd.value) fd.value = today();
  initInputForm();
  // f-equip: QR 전용 — 자동완성 비활성화 (readonly input)
  // 미가동 장비번호 자동완성
  setupEquipAutocomplete('f-idle-equip', {
    siteIdFn:  () => S?.siteId === 'all'
      ? (document.getElementById('f-site-sel')?.value || null)
      : S?.siteId,
    companyFn: () => S?.company || null,
    multi: true,
  });
}

/* ─── AS 전용 탭 렌더 ─── */

/* ══════════════════════════════════════════════════
   이미지 압축 유틸 (Canvas API)
   - _compressImage : 지정 최대 크기 + 품질로 JPEG base64 반환
   - _asPhotoCache  : reqId → 원본(풀사이즈) base64 (메모리)
   - _pendingAsPhoto: 신청 전 임시 보관 { full, thumb }
══════════════════════════════════════════════════ */
const _asPhotoCache = new Map();
let   _pendingAsPhoto = null;
let _pendingTrPlan  = null; // {type:'image'|'pdf', data:base64, name:string, thumb:string}

function _compressImage(file, maxW, maxH, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > maxW || h > maxH){
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function _onAsPhotoSelected(input){
  const file = input.files[0];
  if(!file) return;
  // M6: 파일 크기 제한 (15MB)
  const MAX_BYTES = 15 * 1024 * 1024;
  if(file.size > MAX_BYTES){
    toast(`파일 크기가 너무 큽니다 (최대 15MB, 현재 ${(file.size/1024/1024).toFixed(1)}MB)`, 'err', 5000);
    input.value = '';
    return;
  }
  try {
    const [full, thumb] = await Promise.all([
      _compressImage(file, 800, 800, 0.65),  // 원본 (~100-200KB)
      _compressImage(file, 100, 100, 0.5),   // 썸네일 (~3-5KB)
    ]);
    _pendingAsPhoto = { full, thumb };
    // C3: 사진 선택 후 페이지 이탈 시 경고
    window._asPhotoPendingUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', window._asPhotoPendingUnload);
    // 미리보기 표시
    const preview = document.getElementById('as-photo-preview');
    const thumbEl = document.getElementById('as-photo-thumb-preview');
    const labelEl = document.getElementById('as-photo-label');
    if(preview && thumbEl){ thumbEl.src = thumb; preview.style.display = 'flex'; }
    if(labelEl) labelEl.style.display = 'none';
  } catch(e) {
    console.warn('[photo] 압축 실패:', e);
    toast('사진 처리 중 오류가 발생했습니다','err');
  }
}
function _clearAsPhotoPendingUnload(){
  if(window._asPhotoPendingUnload){
    window.removeEventListener('beforeunload', window._asPhotoPendingUnload);
    window._asPhotoPendingUnload = null;
  }
}

function _clearAsPhoto(){
  _pendingAsPhoto = null;
  _clearAsPhotoPendingUnload();
  const preview = document.getElementById('as-photo-preview');
  const labelEl = document.getElementById('as-photo-label');
  const input   = document.getElementById('as-photo-input');
  if(preview) preview.style.display = 'none';
  if(labelEl) labelEl.style.display = 'inline-flex';
  if(input)   input.value = '';
}

// ── 사용계획서 첨부 (반입 신청 폼) ────────────────────────────
async function _onTrPlanSelected(input){
  const file = input.files && input.files[0];
  if(!file) return;
  const MAX_PDF = 8 * 1024 * 1024; // 8MB
  const isPdf = file.type === 'application/pdf';
  if(isPdf && file.size > MAX_PDF){ toast('PDF 파일은 8MB 이하만 첨부 가능합니다','err'); input.value=''; return; }
  try{
    let data, thumb;
    if(isPdf){
      data = await new Promise((res,rej)=>{
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      thumb = null;
    } else {
      [data, thumb] = await Promise.all([
        _compressImage(file, 1500, 1500, 0.72),
        _compressImage(file, 120, 120, 0.55),
      ]);
    }
    _pendingTrPlan = { type: isPdf ? 'pdf' : 'image', data, thumb, name: file.name };
    // 미리보기
    const preview = document.getElementById('tr-plan-preview');
    const thumbEl = document.getElementById('tr-plan-thumb');
    const pdfBadge = document.getElementById('tr-plan-pdf-badge');
    const fname   = document.getElementById('tr-plan-fname');
    if(isPdf){
      if(thumbEl) thumbEl.style.display = 'none';
      if(pdfBadge) pdfBadge.style.display = 'flex';
    } else {
      if(thumbEl){ thumbEl.src = thumb || data; thumbEl.style.display = ''; }
      if(pdfBadge) pdfBadge.style.display = 'none';
    }
    if(preview) preview.style.display = '';
    if(fname) fname.textContent = file.name;
    toast('파일 첨부됨', 'ok');
  }catch(e){ toast('파일 처리 오류: '+e.message,'err'); }
}
function _clearTrPlan(){
  _pendingTrPlan = null;
  const input   = document.getElementById('tr-plan-input');
  const preview = document.getElementById('tr-plan-preview');
  const fname   = document.getElementById('tr-plan-fname');
  if(input)   input.value='';
  if(preview) preview.style.display='none';
  if(fname)   fname.textContent='';
}
function _showTrPlanPopup(recId){
  const rec = getTransit().find(r=>r.id===recId);
  if(!rec || !rec.planData){ toast('첨부파일이 없습니다','warn'); return; }
  const isPdf = rec.planType === 'pdf';
  document.getElementById('tr-plan-popup')?.remove();
  const pop = document.createElement('div');
  pop.id = 'tr-plan-popup';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const fileName = rec.planName || (isPdf ? 'plan.pdf' : 'plan.jpg');
  const contentHtml = isPdf
    ? `<iframe src="${rec.planData}" style="width:100%;flex:1;border:none;border-radius:8px;background:#fff;min-height:0"></iframe>`
    : `<img src="${rec.planData}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;flex:1;min-height:0">`;
  pop.innerHTML = `
    <div style="width:100%;max-width:600px;height:90vh;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <span style="font-size:13px;font-weight:800;color:#fff">📄 반입신청서</span>
        <div style="display:flex;gap:8px;align-items:center">
          <a href="${rec.planData}" download="${fileName}"
            style="padding:6px 14px;background:rgba(99,102,241,.3);border:1px solid rgba(99,102,241,.5);border-radius:8px;color:#a5b4fc;font-size:12px;font-weight:700;text-decoration:none">💾 저장하기</a>
          <button onclick="document.getElementById('tr-plan-popup').remove()" style="background:none;border:none;font-size:22px;color:#fff;cursor:pointer;line-height:1">✕</button>
        </div>
      </div>
      ${contentHtml}
      <div style="font-size:10px;color:rgba(255,255,255,.5);text-align:center;flex-shrink:0">${fileName}</div>
    </div>`;
  pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
  document.body.appendChild(pop);
}

function _showPhotoPopup(reqId){
  const full  = _asPhotoCache.get(reqId);
  const req   = getAsReqs().find(r => r.id === reqId);
  const src   = full || req?.photoFull || req?.photoThumb;
  if(!src){ toast('사진을 불러올 수 없습니다','warn'); return; }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:16px';
  overlay.onclick = () => document.body.removeChild(overlay);
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:10px;object-fit:contain;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  const hint = document.createElement('div');
  hint.style.cssText = 'color:rgba(255,255,255,.5);font-size:11px;margin-top:12px';
  hint.textContent = '화면을 탭하면 닫힙니다';
  overlay.append(img, hint);
  document.body.appendChild(overlay);
}

/* ═══ AS 검색 상태 ═══ */
let _asSearchQ = '';
let _asFilter  = '대기'; // all / 대기 / 자재수급중 / 처리완료 / 취소
let _asTypeFilter = 'all'; // all / 작동불량 / 충전불량 / 누유의심 / 파손 / 자재요청 / 오류코드 / 기타
let _asLocFilter  = 'all'; // all / 모듈동 / 1F외곽 / 1F~9F / 기타
let _asSort = 'desc'; // desc=최신순 / asc=오래된순

function _attachASListSentinel(canFullAS){
  const sentinel = document.getElementById('as-list-sentinel');
  const list     = document.getElementById('as-card-list');
  if(!sentinel || !list) return;
  const doLoad = ()=>{
    const all   = window._asAllCards || [];
    const idx   = window._asCardIdx  || 0;
    const chunk = all.slice(idx, idx+20);
    if(!chunk.length){ sentinel.remove(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = chunk.map(r=>_asCard(r, canFullAS)).join('');
    while(tmp.firstChild) list.appendChild(tmp.firstChild);
    window._asCardIdx = idx + chunk.length;
    const remaining = all.length - window._asCardIdx;
    if(remaining <= 0) sentinel.remove();
    else sentinel.textContent = `▾ ${remaining}건 더 보기`;
  };
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting){ io.disconnect(); doLoad(); }
    }, {root: document.getElementById('as-content'), threshold: 0.1});
    io.observe(sentinel);
  } else {
    sentinel.style.color = 'var(--blue)';
    sentinel.style.fontWeight = '700';
    sentinel.onclick = doLoad;
  }
}

function renderASPage(){
  const el = document.getElementById('as-content');
  if(!el) return;
  const role = S?.role;
  const isAJ = role==='aj';
  const isEngineer = isAJ && S?.ajType==='정비기사';
  const canFullAS = isAJ; // 관리자 + 정비기사 모두 전체 권한
  const isTech = role==='tech';
  const isSub  = role==='sub';
  const isGuest = role==='guest';

  const siteId = S?.siteId==='all' ? null : S?.siteId;
  let reqs = getAsReqs().filter(r=>siteId?r.siteId===siteId:true);

  // 검색 필터
  if(_asSearchQ){
    const q = _asSearchQ.toLowerCase();
    reqs = reqs.filter(r=>
      (r.equip||'').toLowerCase().includes(q)||(r.equip||'').toLowerCase().split(/[,\s]+/).some(e=>e===q) ||
      (r.company||'').toLowerCase().includes(q) ||
      (r.desc||'').toLowerCase().includes(q) ||
      (r.reporterName||'').toLowerCase().includes(q) ||
      (r.type||r.faultType||'').toLowerCase().includes(q) ||
      (r.location||'').toLowerCase().includes(q)
    );
  }
  if(_asFilter !== 'all') reqs = reqs.filter(r=>r.status===_asFilter);
  else reqs = reqs.filter(r=>r.status!=='취소'); // 전체보기에서도 취소는 기본 제외
  if(_asTypeFilter !== 'all') reqs = reqs.filter(r=>(r.type||r.faultType||'')===_asTypeFilter);
  if(_asLocFilter !== 'all') reqs = reqs.filter(r=>(r.location||'').startsWith(_asLocFilter));
  // 정렬
  reqs = reqs.slice().sort((a,b)=>{
    const ta = a.requestedAt||a.ts||0, tb = b.requestedAt||b.ts||0;
    return _asSort==='asc' ? ta-tb : tb-ta;
  });

  const pending  = reqs.filter(r=>r.status==='대기');
  const supply   = reqs.filter(r=>r.status==='자재수급중');
  const done     = reqs.filter(r=>r.status==='처리완료');

  const statusCount = {
    '대기': getAsReqs().filter(r=>(siteId?r.siteId===siteId:true)&&r.status==='대기').length,
    '자재수급중': getAsReqs().filter(r=>(siteId?r.siteId===siteId:true)&&r.status==='자재수급중').length,
    '처리완료': getAsReqs().filter(r=>(siteId?r.siteId===siteId:true)&&r.status==='처리완료').length,
  };
  // 처리완료 평균 소요일 계산
  const _doneForAvg = getAsReqs().filter(r=>(siteId?r.siteId===siteId:true)&&r.status==='처리완료'&&r.resolvedAt&&(r.requestedAt||r.ts));
  const avgDays = _doneForAvg.length
    ? (_doneForAvg.reduce((s,r)=>s+Math.max(0,(new Date(r.resolvedAt).getTime()-new Date(r.requestedAt||r.ts).getTime())/86400000),0)/_doneForAvg.length).toFixed(1)
    : null;

  // sticky 검색/필터 영역 — input이 이미 있으면 재렌더 생략 (포커스 유지)
  const stickyEl = document.getElementById('as-sticky-header');
  if(stickyEl && !stickyEl.querySelector('input')) {
    stickyEl.innerHTML=`
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <input class="log-search" placeholder="장비번호·업체명·내용 검색..." value="${_asSearchQ}"
      oninput="_asSearchQ=this.value; renderASPage()" style="flex:1;margin:0">
    ${!isGuest?`<button onclick="openASSheet()" style="font-size:11px;font-weight:800;padding:7px 12px;border-radius:8px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;cursor:pointer;white-space:nowrap">AS신청</button>`:''}
  </div>`;
  }

  // AS 순번맵 — 렌더 이전에 계산해야 카드에서 정확히 참조됨
  const _allAsSortedPre = getAsReqs().slice().sort((a,b)=>(a.requestedAt||a.ts||0)-(b.requestedAt||b.ts||0));
  window._asSeqMap = new Map(_allAsSortedPre.map((r,i)=>[r.id,i+1]));

  el.innerHTML=`<div style="padding:10px 14px 80px">

  <!-- KPI 요약 -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:10px">
    <div class="kpi" style="text-align:center;padding:8px;cursor:pointer" onclick="_setAsFilter('대기',this)">
      <div style="font-size:20px;font-weight:900;color:#f87171">${statusCount['대기']}</div>
      <div style="font-size:9px;color:var(--tx2)">대기</div>
    </div>
    <div class="kpi" style="text-align:center;padding:8px;cursor:pointer" onclick="_setAsFilter('자재수급중',this)">
      <div style="font-size:20px;font-weight:900;color:#f59e0b">${statusCount['자재수급중']}</div>
      <div style="font-size:9px;color:var(--tx2)">자재수급중</div>
    </div>
    <div class="kpi" style="text-align:center;padding:8px;cursor:pointer" onclick="_setAsFilter('처리완료',this)">
      <div style="font-size:20px;font-weight:900;color:#4ade80">${statusCount['처리완료']}</div>
      <div style="font-size:9px;color:var(--tx2)">처리완료</div>
    </div>
    <div class="kpi" style="text-align:center;padding:8px">
      <div style="font-size:20px;font-weight:900;color:#a78bfa">${avgDays!==null?avgDays:'—'}</div>
      <div style="font-size:9px;color:var(--tx2)">평균소요일</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:12px">
    <div class="site-select-wrap" style="flex:1">
      <select class="fg-select" style="width:100%;font-size:11px" onchange="_asFilter=this.value;renderASPage()">
        <option value="all"${_asFilter==='all'?' selected':''}>전체 상태</option>
        <option value="대기"${_asFilter==='대기'?' selected':''}>대기</option>
        <option value="자재수급중"${_asFilter==='자재수급중'?' selected':''}>자재수급중</option>
        <option value="처리완료"${_asFilter==='처리완료'?' selected':''}>처리완료</option>
        <option value="취소"${_asFilter==='취소'?' selected':''}>취소</option>
      </select>
    </div>
    <div class="site-select-wrap" style="flex:1">
      <select class="fg-select" style="width:100%;font-size:11px" onchange="_asTypeFilter=this.value;renderASPage()">
        <option value="all"${_asTypeFilter==='all'?' selected':''}>전체 유형</option>
        <option value="작동불량"${_asTypeFilter==='작동불량'?' selected':''}>작동불량</option>
        <option value="충전불량"${_asTypeFilter==='충전불량'?' selected':''}>충전불량</option>
        <option value="누유의심"${_asTypeFilter==='누유의심'?' selected':''}>누유의심</option>
        <option value="파손"${_asTypeFilter==='파손'?' selected':''}>파손</option>
        <option value="자재요청"${_asTypeFilter==='자재요청'?' selected':''}>자재요청</option>
        <option value="오류코드"${_asTypeFilter==='오류코드'?' selected':''}>오류코드</option>
        <option value="기타"${_asTypeFilter==='기타'?' selected':''}>기타</option>
      </select>
    </div>
    <div class="site-select-wrap" style="flex:1">
      <select class="fg-select" style="width:100%;font-size:11px" onchange="_asLocFilter=this.value;renderASPage()">
        <option value="all"${_asLocFilter==='all'?' selected':''}>전체 위치</option>
        <option value="모듈동"${_asLocFilter==='모듈동'?' selected':''}>모듈동</option>
        <option value="1F외곽"${_asLocFilter==='1F외곽'?' selected':''}>1F외곽</option>
        <option value="1F"${_asLocFilter==='1F'?' selected':''}>1F</option>
        <option value="2F"${_asLocFilter==='2F'?' selected':''}>2F</option>
        <option value="3F"${_asLocFilter==='3F'?' selected':''}>3F</option>
        <option value="4F"${_asLocFilter==='4F'?' selected':''}>4F</option>
        <option value="5F"${_asLocFilter==='5F'?' selected':''}>5F</option>
        <option value="6F"${_asLocFilter==='6F'?' selected':''}>6F</option>
        <option value="7F"${_asLocFilter==='7F'?' selected':''}>7F</option>
        <option value="8F"${_asLocFilter==='8F'?' selected':''}>8F</option>
        <option value="9F"${_asLocFilter==='9F'?' selected':''}>9F</option>
        <option value="기타"${_asLocFilter==='기타'?' selected':''}>기타</option>
      </select>
    </div>
    <button onclick="_asSort=_asSort==='desc'?'asc':'desc';renderASPage()" style="flex-shrink:0;padding:0 10px;font-size:11px;font-weight:700;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx2);cursor:pointer;white-space:nowrap">${_asSort==='desc'?'최신순↓':'오래된순↑'}</button>
  </div>


  <!-- 카드 목록 -->
  ${reqs.length===0?'<div class="empty"><div class="empty-txt">해당하는 AS 요청 없음</div></div>':`
  <div id="as-card-list">${reqs.slice(0,20).map(r=>_asCard(r, canFullAS)).join('')}</div>
  ${reqs.length>20?`<div id="as-list-sentinel" style="height:20px;text-align:center;padding:8px;color:var(--tx3);font-size:11px;cursor:pointer">▾ ${reqs.length-20}건 더 보기</div>`:''}`}
  </div>`;
  // AS 카드 지연 로딩 초기화
  window._asAllCards = reqs;
  window._asCardIdx  = Math.min(20, reqs.length);
  _attachASListSentinel(canFullAS);
}

// ── 업체별 고유 아바타 색상 ────────────────────────────────────
function _companyColor(name) {
  const PALETTE = [
    ['#60a5fa','#2563eb'], // blue
    ['#34d399','#059669'], // green
    ['#a78bfa','#7c3aed'], // purple
    ['#fb923c','#ea580c'], // orange
    ['#f472b6','#db2777'], // pink
    ['#38bdf8','#0284c7'], // sky
    ['#facc15','#ca8a04'], // yellow
    ['#4ade80','#16a34a'], // lime
    ['#e879f9','#a21caf'], // fuchsia
    ['#2dd4bf','#0f766e'], // teal
  ];
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = (h * 31 + (name||'').charCodeAt(i)) & 0xffffff;
  const [c1, c2] = PALETTE[Math.abs(h) % PALETTE.length];
  return `linear-gradient(135deg,${c1},${c2})`;
}

// ── AS 댓글 헬퍼 ──────────────────────────────────────────────
function _asCommentBubbles(r){
  // 마이그레이션: comments 없으면 resolvedNote → comments[0]
  let comments = [];
  if(Array.isArray(r.comments) && r.comments.length){
    comments = r.comments;
  } else if(r.resolvedNote && r.techName){
    comments = [{text:r.resolvedNote, author:r.techName, company:'AJ네트웍스', role:'aj', ts:r.resolvedAt||0}];
  }
  if(!comments.length) return '';
  const bubbles = comments.map(c=>{
    const isAJ = c.role==='aj' || c.company==='AJ네트웍스' || !c.role;
    const avBg = isAJ ? 'linear-gradient(135deg,#DE1F23,#9f1214)' : _companyColor(c.company||c.author||'');
    const namCol = isAJ ? '#DE1F23' : '#60a5fa';
    const msgBg = isAJ ? 'rgba(222,31,35,.06)' : 'rgba(96,165,250,.07)';
    const msgBdr = isAJ ? 'rgba(222,31,35,.15)' : 'rgba(96,165,250,.15)';
    const avLabel = (c.company||(isAJ?'AJ':c.author)||'AJ').slice(0,2);
    const fmtTs = c.ts ? new Date(c.ts).toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'})+' '+new Date(c.ts).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : '';
    return `<div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">
      <div style="width:26px;height:26px;border-radius:50%;background:${avBg};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:white;flex-shrink:0">${avLabel}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:5px;margin-bottom:2px">
          <span style="font-size:11px;font-weight:800;color:${namCol}">${esc(c.author||'AJ')}</span>
          ${fmtTs?`<span style="font-size:9px;color:var(--tx3)">${fmtTs}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--tx);line-height:1.5;background:${msgBg};padding:5px 8px;border-radius:0 8px 8px 8px;border:1px solid ${msgBdr}">${esc(c.text).replace(/@([^\s@#<]+)/g,'<span style="color:#60a5fa;font-weight:700">@$1</span>')}</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-top:6px;padding:8px 10px;background:rgba(255,255,255,.02);border:1px solid var(--br);border-radius:10px;margin-bottom:6px">${bubbles}</div>`;
}

function _addASComment(id){
  const cmtEl = document.getElementById(`astech-cmt-${id}`);
  const text = cmtEl?.value.trim();
  if(!text){ toast('댓글을 입력하세요','err'); return; }
  const nameEl = document.getElementById(`astech-name-${id}`);
  const techName = nameEl?.value.trim() || '';
  const reqs = getAsReqs();
  const idx = reqs.findIndex(r=>r.id===id);
  if(idx<0) return;
  const r = reqs[idx];
  // 마이그레이션
  if(!Array.isArray(r.comments)){
    r.comments = r.resolvedNote && r.techName
      ? [{text:r.resolvedNote, author:r.techName, company:'AJ네트웍스', role:'aj', ts:r.resolvedAt||Date.now()}]
      : [];
  }
  r.comments.push({text, author:S?.name||techName||'AJ', company:S?.company||'AJ네트웍스', role:S?.role||'aj', ts:Date.now()});
  if(techName) r.techName = techName;
  r.synced = false;
  reqs[idx] = r;
  saveAsReqs(reqs);
  // 즉시 서버 동기화 (AJ 정비기사에게 알람)
  _directPushAS(r).catch(e=>{ console.warn('[ASComment push]',e); scheduleRetrySync(); });
  addNotif({icon:'💬', title:`AS 댓글 [${r.equip||''}]`, desc:`${S?.name||''}(${S?.company||''}) — ${text.slice(0,40)}`});
  // 댓글 알림: 신청인에게 (내가 AJ인 경우) 또는 AJ에게 (내가 sub인 경우)
  if(S?.role === 'aj'){
    pushSBNotif({
      target_user_id: r.submitterMemberId || null,
      target_role: r.submitterMemberId ? null : 'sub',
      site_id: r.siteId || null,
      type: 'as_comment',
      title: `💬 AS 댓글 [${r.equip||''}]`,
      body: `${S?.name||''}(${S?.company||''}) — ${text.slice(0,50)}`,
      ref_id: r.id,
    }).catch(()=>{});
  } else {
    pushSBNotif({
      target_aj_type: '정비기사',
      type: 'as_comment',
      title: `💬 AS 댓글 [${r.equip||''}]`,
      body: `${S?.name||''}(${S?.company||''}) — ${text.slice(0,50)}`,
      ref_id: r.id,
      site_id: r.siteId || null,
    }).catch(()=>{});
  }
  // @멘션 감지 → 태그된 사람에게 알림
  const _mentions = [...new Set((text.match(/@([^\s@#]+)/g)||[]).map(m=>m.slice(1)))];
  if(_mentions.length){
    const _allSub = typeof getMembers==='function' ? getMembers() : [];
    const _allAj  = typeof _getAjMembers==='function' ? _getAjMembers() : [];
    _mentions.forEach(mName=>{
      const _subT = _allSub.find(m=>m.name===mName);
      const _ajT  = _allAj.find(m=>m.name===mName);
      const _tid  = (_subT?.record_id||_subT?.id) || (_ajT?.record_id||_ajT?.emp_no) || null;
      if(_tid) pushSBNotif({target_user_id:_tid, type:'mention',
        title:`💬 @${mName} 님이 태그되었습니다`,
        body:`${S?.name||''}(${S?.company||''}) — ${text.slice(0,60)}`,
        ref_id:r.id, site_id:r.siteId||null}).catch(()=>{});
    });
  }
  renderASPage();
  toast('댓글 등록됨','ok');
  // 서버에서 새 데이터가 있을 때만 재렌더 (깜빡임 방지)
  _fetchFromSB().catch(()=>{}).then(changed=>{ if(changed){ renderASPage(); updateASBadge(); } });
}

function _setAsTypeFilter(f, el){
  _asTypeFilter = f;
  renderASPage();
}

function _setAsFilter(f, el){
  _asFilter = f;
  renderASPage();
}

function _fmtAsDate(ts){
  if(!ts) return '';
  const d=new Date(ts);
  const yy=String(d.getFullYear()).slice(2);
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  const hh=String(d.getHours()).padStart(2,'0');
  const min=String(d.getMinutes()).padStart(2,'0');
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}
function _asCard(r, canAct){
  const seqNo = window._asSeqMap?.get(r.id) || 0;
  const idx = seqNo - 1; // 하위 호환 (idx 사용하는 코드가 있을 경우)
  const isAJ = S?.role==='aj';
  const isEngineer = isAJ && S?.ajType==='정비기사';
  // 상태 색상
  const isCancelled = r.status==='취소';
  const stCol = r.status==='처리완료'?'#4ade80':r.status==='자재수급중'?'#f59e0b':isCancelled?'#94a3b8':'#f87171';
  const stBg  = r.status==='처리완료'?'rgba(74,222,128,.15)':r.status==='자재수급중'?'rgba(245,158,11,.15)':isCancelled?'rgba(148,163,184,.15)':'rgba(248,113,113,.15)';
  // 취소 가능 여부: AJ(정비기사 포함) 또는 AS 글쓴이(sub)
  const isMyAS = S?.memberId && r.submitterMemberId === S.memberId;
  const canCancel = (canAct || isMyAS) && !isCancelled && r.status !== '처리완료';

  // 처리완료 정보 블록
  let resolvedBlock = '';
  if(r.techName || r.resolvedAt || r.status==='처리완료'){
    const parts = [];
    if(r.techName) parts.push(`담당기사: <b style="color:var(--tx)">${esc(r.techName)}</b>`);
    if(r.resolvedAt){
      const rDate = new Date(r.resolvedAt);
      const rFull = rDate.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})
                  + ' ' + rDate.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
      parts.push(`처리완료: ${rFull}`);
      // requestedAt 우선, 없으면 ts(신청시각), 그 다음 createdAt
      const base = r.requestedAt || r.ts || r.createdAt;
      if(base){
        const diffMs = Number(r.resolvedAt) - Number(base);
        if(diffMs > 0){
          const diffH = Math.floor(diffMs / 3600000);
          const diffD = Math.floor(diffH / 24);
          const elapsed = diffD > 0 ? `${diffD}일 ${diffH%24}h` : `${diffH}h ${Math.round((diffMs%3600000)/60000)}m`;
          parts.push(`소요시간 ${elapsed}`);
        }
      }
    }
    if(parts.length){
      const materialTag = r.materialAt ? `<span style="font-size:9px;color:#f59e0b;margin-left:6px;background:rgba(245,158,11,.12);padding:1px 6px;border-radius:4px;border:1px solid rgba(245,158,11,.25)">(자재수급-처리)</span>` : '';
      resolvedBlock = `<div style="font-size:10px;color:#4ade80;margin-bottom:6px;padding:5px 8px;background:rgba(74,222,128,.08);border-radius:6px;border-left:2px solid rgba(74,222,128,.5)"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">✓ ${parts.join('<span style="color:var(--tx3);margin:0 4px">·</span>')}${materialTag}</div></div>`;
    }
  }

  // 서버 미동기화 배너
  const asSyncFailBanner = (!r.synced) ? `
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:5px 8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);border-radius:6px">
    <span style="font-size:10px;color:#f87171;flex:1">⚠ 서버 미등록 — 네트워크 오류</span>
    <button onclick="_retryASPush('${r.id}')" style="font-size:10px;font-weight:700;padding:3px 8px;background:rgba(248,113,113,.2);border:1px solid rgba(248,113,113,.4);border-radius:5px;color:#f87171;cursor:pointer">재등록</button>
  </div>` : '';

  return `<div class="lcard" style="margin-bottom:10px${isCancelled?';opacity:0.45':''}">
    <!-- 헤더: 업체 + 상태 + 날짜 -->
    <div class="lc-top">
      <div class="lc-co">
        <div class="lc-dot" style="background:${stCol}"></div>
        <div class="lc-name" style="font-weight:800">${esc(r.company||'—')}</div>
        <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:10px;margin-left:4px;color:${stCol};background:${stBg}">${esc(r.status)}</span>
        <span style="padding:1px 6px;border-radius:4px;background:rgba(248,113,113,.12);color:#f87171;font-size:9px;font-weight:700;margin-left:4px">${esc(r.type||r.faultType||'기타')}</span>
        ${r.status==='처리완료'&&r.techName?`<span style="font-size:9px;color:#4ade80;margin-left:4px;font-weight:700">· ${esc(r.techName)}</span>`:''}
      </div>
      <div class="lc-time" style="text-align:right">
        <div style="font-size:10px;color:var(--tx2)">${_fmtAsDate(r.requestedAt||r.createdAt)}</div>
        ${seqNo?`<div style="font-size:10px;color:var(--tx2);margin-top:1px">No.${seqNo}</div>`:''}
      </div>
    </div>

    <!-- 장비번호·신청자·접수내용 + 썸네일 (썸네일이 세 행에 걸쳐 우측 배치) -->
    <div style="display:flex;gap:8px;align-items:stretch;margin:4px 0 6px">
      <div style="flex:1;min-width:0">
        <!-- 장비번호·위치 -->
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:4px;font-size:12px">
          <span style="font-family:monospace;font-weight:800;color:#93c5fd">${esc(r.equip)||'—'}</span>
          ${r.location?`<span style="color:var(--tx2)">·</span><span style="color:var(--tx)">${esc(r.location)}</span>`:''}
        </div>
        <!-- 신청자 · 작업자 -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px;font-size:11px">
          <span style="color:var(--tx3);font-weight:600">신청자 :</span>
          ${(r.reporterName||r.reporter)
            ? (r.reporterPhone
              ? `<a href="tel:${r.reporterPhone}" style="color:#60a5fa;text-decoration:none;font-weight:700">${esc(r.reporterName||r.reporter)}</a>`
              : `<b style="color:var(--tx3)">${esc(r.reporterName||r.reporter)}</b>`)
            : '<span style="color:var(--tx3)">—</span>'}
          <span style="color:var(--br3);margin:0 2px">·</span>
          <span style="color:var(--tx3);font-weight:600">작업자 :</span>
          ${r.workerName
            ? (r.workerPhone
              ? `<a href="tel:${r.workerPhone}" style="color:#60a5fa;text-decoration:none;font-weight:700">${esc(r.workerName)}</a>`
              : `<b style="color:var(--tx3)">${esc(r.workerName)}</b>`)
            : '<span style="color:var(--tx3)">(입력 없음)</span>'}
        </div>
        <!-- 접수내용 -->
        <div style="font-size:11px;color:var(--tx);line-height:1.4;padding:4px 6px;background:var(--bg2);border-radius:4px;border-left:2px solid var(--br)">${esc(r.desc||'—')}</div>
      </div>
      <!-- 썸네일: 장비번호~접수내용에 걸쳐 우측 배치 -->
      ${r.photoThumb ? `<div onclick="_showPhotoPopup('${r.id}')" style="flex-shrink:0;cursor:pointer;position:relative;align-self:stretch;display:flex;align-items:center" title="사진 보기">
        <img src="${r.photoThumb}" style="width:54px;height:100%;min-height:54px;object-fit:cover;border-radius:6px;border:1.5px solid rgba(96,165,250,.4);display:block">
        <div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.55);border-radius:3px;padding:1px 3px;font-size:8px;color:#fff">🔍</div>
      </div>` : ''}
    </div>

    <!-- 처리 정보 + 댓글 버블 -->
    ${asSyncFailBanner}
    ${r.materialAt && r.status==='자재수급중'?`<div style="font-size:10px;color:#f59e0b;margin-bottom:4px">⏳ 자재수급중 전환: ${new Date(r.materialAt).toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'})} ${new Date(r.materialAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>`:''}
    ${resolvedBlock}
    ${_asCommentBubbles(r)}

    <!-- 댓글 입력 — AJ + 협력사 담당자 / 처리완료 건은 입력창 숨김 -->
    ${(canAct||S?.role==='sub')?`
    <div style="margin-top:8px;border-top:1px solid var(--br);padding-top:8px">
      ${r.status!=='처리완료'?`<div style="display:flex;gap:6px;margin-bottom:${canAct?'8':'0'}px;align-items:center">
        <div style="width:26px;height:26px;border-radius:50%;background:${S?.role==='aj'?'linear-gradient(135deg,#DE1F23,#9f1214)':'linear-gradient(135deg,#60a5fa,#2563eb)'};color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${(S?.company||S?.name||'').slice(0,2)||'AJ'}</div>
        <input type="text" placeholder="댓글 입력 (Enter 또는 등록 버튼)" id="astech-cmt-${r.id}"
          onkeydown="if(event.keyCode===13){_addASComment('${r.id}');}"
          style="flex:1;padding:5px 8px;font-size:11px;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx)">
        <button onclick="_addASComment('${r.id}')" style="padding:5px 12px;font-size:11px;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.35);border-radius:var(--rs);color:#4ade80;cursor:pointer;font-weight:700;flex-shrink:0">등록</button>
      </div>`:''}
      <!-- 접수취소 버튼 — AS 글쓴이 또는 AJ -->
      ${canCancel?`<div style="margin-bottom:${canAct?'6px':'0'}">
        <button class="btn-ghost" style="width:100%;font-size:10px;padding:5px;color:#94a3b8;border-color:rgba(148,163,184,.4)"
          onclick="_showASCancelPopup('${r.id}')">접수취소</button>
      </div>`:''}
      <!-- AJ 처리 버튼 — AJ만 표시 -->
      ${canAct&&r.status!=='처리완료'?`<div style="display:flex;gap:6px">
        <button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#f59e0b;border-color:rgba(245,158,11,.4)"
          onclick="updateASStatus('${r.id}','자재수급중')">자재수급중</button>
        <button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#4ade80;border-color:rgba(74,222,128,.4)"
          onclick="_showASCompletePopup('${r.id}')">처리완료</button>
      </div>`:''}
    </div>`:''}
  </div>`;
}

function _showASCompletePopup(id){
  if(S?.role !== 'aj'){ toast('AJ 멤버만 처리완료로 변경할 수 있습니다','err'); return; }
  const existing = document.getElementById('_as-complete-pop');
  if(existing) existing.remove();
  const pop = document.createElement('div');
  pop.id = '_as-complete-pop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;display:flex;align-items:flex-end;justify-content:center;padding-bottom:env(safe-area-inset-bottom,0px)';
  pop.innerHTML = `
    <div style="width:100%;max-width:500px;background:var(--bg1);border-radius:16px 16px 0 0;padding:20px 16px 24px;box-sizing:border-box">
      <div style="font-size:14px;font-weight:800;margin-bottom:4px;color:var(--tx)">✅ 처리완료</div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:14px">처리 내용을 입력하면 댓글로 자동 등록됩니다 (선택)</div>
      <textarea id="_as-note-input" rows="4" placeholder="처리 내용 입력 (댓글로 자동 등록)&#10;예) 배터리 교체 완료, 모터 교체 후 정상 작동 확인 등"
        style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13px;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx);resize:none;font-family:inherit;line-height:1.5"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="document.getElementById('_as-complete-pop').remove()"
          style="flex:1;padding:11px;font-size:13px;font-weight:700;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx2);cursor:pointer">취소</button>
        <button id="_as-complete-confirm"
          style="flex:2;padding:11px;font-size:13px;font-weight:800;background:rgba(74,222,128,.18);border:1px solid rgba(74,222,128,.4);border-radius:var(--rs);color:#4ade80;cursor:pointer">처리완료 확정</button>
      </div>
    </div>`;
  pop.querySelector('#_as-complete-confirm').addEventListener('click', ()=>{
    const note = pop.querySelector('#_as-note-input').value.trim();
    pop.remove();
    updateASStatus(id, '처리완료', note);
  });
  pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
  document.body.appendChild(pop);
  setTimeout(()=>pop.querySelector('#_as-note-input')?.focus(), 100);
}

function _showASCancelPopup(id){
  const existing = document.getElementById('_as-cancel-pop');
  if(existing) existing.remove();
  const pop = document.createElement('div');
  pop.id = '_as-cancel-pop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;display:flex;align-items:flex-end;justify-content:center;padding-bottom:env(safe-area-inset-bottom,0px)';
  pop.innerHTML = `
    <div style="width:100%;max-width:500px;background:var(--bg1);border-radius:16px 16px 0 0;padding:20px 16px 24px;box-sizing:border-box">
      <div style="font-size:14px;font-weight:800;margin-bottom:4px;color:var(--tx)">❌ 접수취소</div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:14px">취소 사유를 입력하면 댓글로 자동 등록됩니다</div>
      <textarea id="_as-cancel-reason" rows="3" placeholder="취소 사유 입력 (필수)"
        style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13px;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx);resize:none;font-family:inherit;line-height:1.5"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="document.getElementById('_as-cancel-pop').remove()"
          style="flex:1;padding:11px;font-size:13px;font-weight:700;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx2);cursor:pointer">닫기</button>
        <button id="_as-cancel-confirm"
          style="flex:2;padding:11px;font-size:13px;font-weight:800;background:rgba(148,163,184,.15);border:1px solid rgba(148,163,184,.4);border-radius:var(--rs);color:#94a3b8;cursor:pointer">접수취소 확정</button>
      </div>
    </div>`;
  pop.querySelector('#_as-cancel-confirm').addEventListener('click', ()=>{
    const reason = pop.querySelector('#_as-cancel-reason').value.trim();
    if(!reason){ pop.querySelector('#_as-cancel-reason').style.borderColor='#f87171'; return; }
    pop.remove();
    cancelASRequest(id, reason);
  });
  pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
  document.body.appendChild(pop);
  setTimeout(()=>pop.querySelector('#_as-cancel-reason')?.focus(), 100);
}

function cancelASRequest(id, reason){
  const reqs = getAsReqs();
  const idx = reqs.findIndex(r=>r.id===id);
  if(idx<0) return;
  const r = reqs[idx];
  r.status = '취소';
  r.cancelledAt = Date.now();
  r.cancelledBy = S?.name || '';
  if(!Array.isArray(r.comments)) r.comments = [];
  r.comments.push({text:'[접수취소] '+reason, author:S?.name||'', company:S?.company||'', role:S?.role||'', ts:Date.now()});
  r.synced = false;
  reqs[idx] = r;
  saveAsReqs(reqs);
  _syncToSupabase().catch(e=>console.warn('[as cancel sync]',e));
  toast('접수취소 처리되었습니다','ok');
  renderASPage();
}

function updateASStatus(id, status, resolvedNote){
  if(S?.role !== 'aj'){ toast('AJ 멤버만 상태를 변경할 수 있습니다','err'); return; }
  const reqs = getAsReqs();
  const idx = reqs.findIndex(r=>r.id===id);
  if(idx<0) return;
  const r = reqs[idx];
  r.status = status;
  r.techName = document.getElementById(`astech-name-${id}`)?.value.trim() || r.techName;
  // 댓글 자동 추가 (입력한 경우)
  const cmtEl = document.getElementById(`astech-cmt-${id}`);
  const cmtText = cmtEl?.value.trim();
  if(cmtText){
    if(!Array.isArray(r.comments)){
      r.comments = r.resolvedNote && r.techName
        ? [{text:r.resolvedNote, author:r.techName, company:'AJ네트웍스', role:'aj', ts:r.resolvedAt||Date.now()}]
        : [];
    }
    const statusLabel = status==='처리완료' ? '[처리완료] ' : '[자재수급중] ';
    r.comments.push({text:statusLabel+cmtText, author:S?.name||r.techName||'AJ', company:S?.company||'AJ네트웍스', role:S?.role||'aj', ts:Date.now()});
  }
  if(status==='처리완료'){
    r.resolvedAt = Date.now();
    r.resolvedStatus = '처리완료';
    if(resolvedNote){
      if(!Array.isArray(r.comments)) r.comments = [];
      r.comments.push({text:'[처리완료] '+resolvedNote, author:S?.name||r.techName||'AJ', company:S?.company||'AJ네트웍스', role:S?.role||'aj', ts:Date.now()});
    }
    // 담당기사 미입력 시 현재 로그인 AJ 멤버 이름으로 자동 설정
    if(!r.techName && S?.name) r.techName = S.name;
    addNotif({icon:'', title:`AS처리완료: ${r.equip}`, desc:`${r.company} — ${r.techName||'기사'}님 처리 완료`});
    // 신청인에게 알림 (submitterMemberId가 있으면 직접, 없으면 site의 sub 전체)
    pushSBNotif({
      target_user_id: r.submitterMemberId || null,
      target_role: r.submitterMemberId ? null : 'sub',
      site_id: r.siteId || null,
      type: 'as_complete',
      title: `✅ AS처리완료: ${r.equip}`,
      body: `${r.company} — ${r.techName||'기사'}님이 처리 완료했습니다.`,
      ref_id: r.id,
    }).catch(()=>{});
  }
  if(status==='자재수급중'){
    r.materialAt = r.materialAt || Date.now();
    addNotif({icon:'', title:`자재수급중: ${r.equip}`, desc:`${r.company} — 자재 수급 진행 중`});
    pushSBNotif({
      target_user_id: r.submitterMemberId || null,
      target_role: r.submitterMemberId ? null : 'sub',
      site_id: r.siteId || null,
      type: 'as_material',
      title: `🔩 자재수급중: ${r.equip}`,
      body: `${r.company} — 자재 수급이 진행 중입니다.`,
      ref_id: r.id,
    }).catch(()=>{});
  }
  r.synced = false;
  reqs[idx] = r;
  saveAsReqs(reqs);
  _directPushAS(r).catch(()=>_syncToSupabase().catch(()=>{}));
  updateASBadge();
  renderASPage();
  toast(status==='처리완료'?'처리 완료로 변경됨':'자재수급중으로 변경됨','ok');
  _fetchFromSB().catch(()=>{}).then(changed=>{ if(changed){ renderASPage(); updateASBadge(); } });
}

function resolveAS(idx){
  // 하위호환
  const reqs=getAsReqs();
  if(!reqs[idx]) return;
  updateASStatus(reqs[idx].id, '처리완료');
}

function updateASBadge(){
  const nb=document.getElementById('nb-as');
  if(!nb) return;
  const n=getAsReqs().filter(r=>r.status==='대기'||r.status==='자재수급중').length;
  nb.textContent=n>0?n:'';
  nb.classList.toggle('on',n>0);
}

/* ═══════════════════════════════════════════
   반입반출 (TRANSIT)
═══════════════════════════════════════════ */
// ── 제원 목록 ──
const TR_SPECS = ['6M','8M','10M','12M','14M','16M','18M','16M굴절','기타'];
const EQUIP_MODELS = {
  '6M':     ['GS1330'],
  '8M':     ['GS1930','OPTIMUM8'],
  '10M':    ['GS2632','GS2646'],
  '12M':    ['GS3246','MS10.4'],
  '14M':    ['GS4047','ERT4069'],
  '16M':    ['GS4655'],
  '18M':    ['GS5069'],
  '16M굴절':['SIGMA16','Z4525J','E450AJ'],
  '기타':   [],
};
const _nh = s => (s||'').replace(/-/g,'').trim();
function _equipUpdateModelOptions(spec){
  const sel = document.getElementById('eq-add-model');
  if(!sel) return;
  const models = EQUIP_MODELS[spec] || [];
  sel.innerHTML = '<option value="">모델명 (선택)</option>' + models.map(m=>`<option value="${m}">${m}</option>`).join('');
  sel.style.color = 'var(--tx3)';
}

// 영업일 기준 다음 날 (주말 건너뜀)
function nextBizDay(dateStr){
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// 반입반출 상태 라벨 (영업일 기준)
function trStatusLabel(date, type, status){
  const td = today();
  const verb = type==='in' ? ['반입','금일반입','명일반입','반입완료']
             : type==='handover' ? ['인수인계','금일인계','명일인계','인계완료']
             : ['반출','금일반출','명일반출','반출완료'];
  const diff = (new Date(date) - new Date(td)) / 86400000;
  if(diff < 0 && status === '예정'){
    const delayLabel = type==='in'?'반입지연':type==='handover'?'인계지연':'반출지연';
    return {label: delayLabel, color:'#f87171', bg:'rgba(248,113,113,.15)', done:false};
  }
  if(diff < 0)                  return {label: verb[3], color:'#22c55e',      bg:'rgba(34,197,94,.15)',   done:true};
  if(date === td)               return {label: verb[1], color:'#3b82f6',      bg:'rgba(59,130,246,.15)',  done:false};
  if(date === nextBizDay(td))   return {label: verb[2], color:'var(--orange)', bg:'rgba(249,115,22,.15)', done:false};
  return {label: verb[0] + ' 예정', color:'var(--tx2)', bg:'rgba(255,255,255,.05)', done:false};
}

// 날짜 차이 정밀 계산
function trDiff(date){
  const now = new Date(); now.setHours(0,0,0,0);
  const d   = new Date(date); d.setHours(0,0,0,0);
  return Math.round((d - now) / 86400000);
}

function _attachTrSentinels(container){
  function _bindSentinel(sentinelSel, listId, getAll, getIdx, setIdx){
    const sentinel = container?.querySelector(sentinelSel);
    const list     = container?.querySelector('#'+listId);
    if(!sentinel || !list) return;
    const doLoad = ()=>{
      const all   = getAll();
      const idx   = getIdx();
      const chunk = all.slice(idx, idx+20);
      if(!chunk.length){ sentinel.remove(); return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = chunk.map(r=>_trCard(r, window._trSeqMap?.get(r.id)||0, false, false)).join('');
      while(tmp.firstChild) list.appendChild(tmp.firstChild);
      setIdx(idx + chunk.length);
      const remaining = all.length - getIdx();
      if(remaining <= 0) sentinel.remove();
      else sentinel.textContent = `▾ ${remaining}건 더 보기`;
    };
    if('IntersectionObserver' in window){
      const io = new IntersectionObserver(entries=>{
        if(entries[0].isIntersecting){ io.disconnect(); doLoad(); }
      }, {root: document.getElementById('transit-content'), threshold: 0.1});
      io.observe(sentinel);
    } else {
      sentinel.style.color = 'var(--blue)';
      sentinel.style.fontWeight = '700';
      sentinel.onclick = doLoad;
    }
  }
  _bindSentinel('.tr-done-sentinel',   'tr-done-list',
    ()=>window._trDoneAll||[],   ()=>window._trDoneIdx||0,   v=>{ window._trDoneIdx=v; });
  _bindSentinel('.tr-cancel-sentinel', 'tr-cancel-list',
    ()=>window._trCancelAll||[], ()=>window._trCancelIdx||0, v=>{ window._trCancelIdx=v; });
}

function renderTransit(){
  const el=document.getElementById('transit-content');
  if(!el) return;
  const isAJ = S?.role==='aj';
  const isSub = S?.role==='sub';
  const siteId=S?.siteId==='all'?null:S?.siteId;
  const allRecs=getTransit().filter(r=>siteId?r.siteId===siteId:true);

  // ── 필터 상태 유지 ──────────────────────────
  if (!window._trFilter) window._trFilter = {dateFrom:'', dateTo:'', company:'', spec:'', status:''};
  const fDateFrom = window._trFilter.dateFrom || '';
  const fDateTo   = window._trFilter.dateTo   || '';
  const fCompany  = window._trFilter.company  || '';
  const fSpec     = window._trFilter.spec     || '';
  const fStatus   = window._trFilter.status   || '';

  // ── 유니크 업체 목록 ────────────────────────
  const coSet = new Set();
  allRecs.forEach(r => {
    if(r.company)     coSet.add(r.company);
    if(r.fromCompany) coSet.add(r.fromCompany);
    if(r.toCompany)   coSet.add(r.toCompany);
  });
  const coList = [...coSet].sort((a,b)=>a.localeCompare(b,'ko'));

  // ── 필터 적용 ───────────────────────────────
  const filtered = allRecs.filter(r => {
    if (fDateFrom && r.date < fDateFrom) return false;
    if (fDateTo   && r.date > fDateTo)   return false;
    if (fCompany) {
      const m = r.company===fCompany || r.fromCompany===fCompany || r.toCompany===fCompany;
      if (!m) return false;
    }
    if (fSpec) {
      const s = fSpec.toUpperCase();
      const inSp = (r.specs||[]).some(x=>(x.spec||'').toUpperCase().includes(s)||(x.model||'').toUpperCase().includes(s));
      const inEq = (r.ajEquip||'').toUpperCase().includes(s);
      const inHo = (r.handoverEquips||[]).some(x=>x.toUpperCase().includes(s));
      if (!inSp && !inEq && !inHo) return false;
    }
    if (fStatus && r.status !== fStatus) return false;
    return true;
  });

  // ── KPI 탭 상태 ─────────────────────────────
  const _kt = window._trKpiTab || null;

  // ── KPI는 전체 기준 ─────────────────────────
  const DONE_ST = ['반입완료','반출완료','인계완료'];
  const kpiIn   = allRecs.filter(r=>r.type==='in'&&r.status==='예정').length;
  const kpiOut  = allRecs.filter(r=>r.type==='out'&&r.status==='예정').length;
  const kpiHo   = allRecs.filter(r=>r.type==='handover'&&r.status!=='취소').length;
  const kpiCan  = allRecs.filter(r=>r.status==='취소').length;
  const kpiDone = allRecs.filter(r=>DONE_ST.includes(r.status)).length;

  // ── KPI 탭 필터 (검색 필터 위에 추가 적용) ──
  const tabFiltered = !_kt ? filtered : filtered.filter(r=>{
    if(_kt==='반입예정') return r.type==='in'&&r.status==='예정';
    if(_kt==='반출예정') return r.type==='out'&&r.status==='예정';
    if(_kt==='인수인계') return r.type==='handover';
    if(_kt==='취소')     return r.status==='취소';
    if(_kt==='완료')     return DONE_ST.includes(r.status);
    return true;
  });

  // ── 섹션 분류 (상태 기준) ──────────────────
  // 진행 예정: 아직 완료/취소 안된 것
  const active    = tabFiltered.filter(r => r.status === '예정');
  // 완료: 완료 버튼이 눌러진 것
  const done      = tabFiltered.filter(r => DONE_ST.includes(r.status));
  // 취소
  const cancelled = tabFiltered.filter(r => r.status === '취소');

  // 날짜 정렬
  active.sort((a,b)=>a.date.localeCompare(b.date));
  done.sort((a,b)=>b.date.localeCompare(a.date));

  const hasFilter = !!(fDateFrom || fDateTo || fCompany || fSpec || fStatus || _kt);
  const filterBadge = hasFilter
    ? `<span style="font-size:10px;background:rgba(59,139,255,.2);color:#60a5fa;padding:2px 8px;border-radius:6px">${tabFiltered.length}건</span>`
    : '';

  // 반입반출 순번맵 (등록 시간순 1부터)
  const _allTrSorted=getTransit().sort((a,b)=>(a.ts||0)-(b.ts||0));
  window._trSeqMap=new Map(_allTrSorted.map((r,i)=>[r.id,i+1]));

  el.innerHTML=`
  <!-- KPI 필터 탭 -->
  <div id="tr-kpi-bar" style="position:sticky;top:0;z-index:20;background:var(--bg1);padding:6px 8px 5px;border-bottom:1px solid var(--br)">
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:3px">
    <div class="kpi" style="text-align:center;padding:6px 2px;cursor:pointer;border-radius:7px;border:1px solid ${_kt==='반입예정'?'var(--blue)':'transparent'};background:${_kt==='반입예정'?'rgba(59,130,246,.08)':'transparent'}" onclick="_setTrKpiTab('반입예정')">
      <div style="font-size:15px;font-weight:900;color:var(--blue)">${kpiIn}</div>
      <div style="font-size:8px;color:${_kt==='반입예정'?'var(--blue)':'var(--tx2)'};font-weight:${_kt==='반입예정'?800:400}">반입예정</div>
    </div>
    <div class="kpi" style="text-align:center;padding:6px 2px;cursor:pointer;border-radius:7px;border:1px solid ${_kt==='반출예정'?'var(--orange)':'transparent'};background:${_kt==='반출예정'?'rgba(249,115,22,.08)':'transparent'}" onclick="_setTrKpiTab('반출예정')">
      <div style="font-size:15px;font-weight:900;color:var(--orange)">${kpiOut}</div>
      <div style="font-size:8px;color:${_kt==='반출예정'?'var(--orange)':'var(--tx2)'};font-weight:${_kt==='반출예정'?800:400}">반출예정</div>
    </div>
    <div class="kpi" style="text-align:center;padding:6px 2px;cursor:pointer;border-radius:7px;border:1px solid ${_kt==='인수인계'?'#14b8a6':'transparent'};background:${_kt==='인수인계'?'rgba(20,184,166,.08)':'transparent'}" onclick="_setTrKpiTab('인수인계')">
      <div style="font-size:15px;font-weight:900;color:#14b8a6">${kpiHo}</div>
      <div style="font-size:8px;color:${_kt==='인수인계'?'#14b8a6':'var(--tx2)'};font-weight:${_kt==='인수인계'?800:400}">인수인계</div>
    </div>
    <div class="kpi" style="text-align:center;padding:6px 2px;cursor:pointer;border-radius:7px;border:1px solid ${_kt==='취소'?'rgba(148,163,184,.5)':'transparent'};background:${_kt==='취소'?'rgba(148,163,184,.08)':'transparent'}" onclick="_setTrKpiTab('취소')">
      <div style="font-size:15px;font-weight:900;color:var(--tx3)">${kpiCan}</div>
      <div style="font-size:8px;color:${_kt==='취소'?'var(--tx2)':'var(--tx2)'};font-weight:${_kt==='취소'?800:400}">취소</div>
    </div>
    <div class="kpi" style="text-align:center;padding:6px 2px;cursor:pointer;border-radius:7px;border:1px solid ${_kt==='완료'?'#22c55e':'transparent'};background:${_kt==='완료'?'rgba(34,197,94,.08)':'transparent'}" onclick="_setTrKpiTab('완료')">
      <div style="font-size:15px;font-weight:900;color:#22c55e">${kpiDone}</div>
      <div style="font-size:8px;color:${_kt==='완료'?'#22c55e':'var(--tx2)'};font-weight:${_kt==='완료'?800:400}">완료</div>
    </div>
  </div>
  </div><!-- /tr-kpi-bar -->
  <div style="padding:10px 14px 80px">

  <!-- 검색 필터 바 -->
  <div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:10px 12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--tx2)">🔍 검색 필터</span>
      ${hasFilter?`<button onclick="_clearTransitFilter()" style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25);cursor:pointer">✕ 초기화</button>`:''}
      ${filterBadge}
      <button onclick="_openTransitSchedule()" style="margin-left:auto;font-size:10px;padding:3px 10px;border-radius:6px;background:rgba(20,184,166,.1);color:#14b8a6;border:1px solid rgba(20,184,166,.3);cursor:pointer;font-weight:700;flex-shrink:0">📅 스케쥴표</button>
    </div>
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px">
      <input type="date" id="tr-filter-date-from" value="${fDateFrom}" onchange="_filterTransit()" placeholder="시작일" title="시작일" style="flex:1;min-width:0;font-size:11px;padding:5px 6px;border:1px solid var(--br);border-radius:8px;background:var(--bg1);color:var(--tx);box-sizing:border-box">
      <span style="font-size:10px;color:var(--tx3);flex-shrink:0">~</span>
      <input type="date" id="tr-filter-date-to" value="${fDateTo}" onchange="_filterTransit()" placeholder="종료일" title="종료일" style="flex:1;min-width:0;font-size:11px;padding:5px 6px;border:1px solid var(--br);border-radius:8px;background:var(--bg1);color:var(--tx);box-sizing:border-box">
      <select id="tr-filter-company" onchange="_filterTransit()" style="flex:1;min-width:0;font-size:11px;padding:5px 6px;border:1px solid var(--br);border-radius:8px;background:var(--bg1);color:var(--tx);box-sizing:border-box">
        <option value="">전체 업체</option>
        ${coList.map(c=>`<option value="${c}"${fCompany===c?' selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input type="text" id="tr-filter-spec" value="${fSpec}" oninput="_filterTransit()" placeholder="장비명 / 장비번호 검색" style="font-size:11px;padding:6px 10px;border:1px solid var(--br);border-radius:8px;background:var(--bg1);color:var(--tx);width:100%;box-sizing:border-box">
      <select id="tr-filter-status" onchange="_filterTransit()" style="font-size:11px;padding:6px 8px;border:1px solid var(--br);border-radius:8px;background:var(--bg1);color:var(--tx);width:100%;box-sizing:border-box">
        <option value="">전체 상태</option>
        <option value="예정"${fStatus==='예정'?' selected':''}>예정</option>
        <option value="반입완료"${fStatus==='반입완료'?' selected':''}>반입완료</option>
        <option value="반출완료"${fStatus==='반출완료'?' selected':''}>반출완료</option>
        <option value="인계완료"${fStatus==='인계완료'?' selected':''}>인계완료</option>
        <option value="취소"${fStatus==='취소'?' selected':''}>취소</option>
      </select>
    </div>
  </div>

  <!-- 신규 등록 버튼 -->
  ${(isAJ||isSub)?`<button class="btn-full teal" onclick="openTransitForm()" style="margin-bottom:14px">+ 반입/반출 신청</button>`:''}

  <!-- 진행 예정 -->
  <div class="shd"><span class="shd-title">진행 예정 (${active.length}건)</span></div>
  ${active.length===0?'<div class="empty" style="margin-bottom:10px"><div class="empty-txt">예정 없음</div></div>':
    active.map(r=>_trCard(r, window._trSeqMap.get(r.id)||0, isAJ, isSub)).join('')}

  <!-- 완료 (상태 기준 — 완료 버튼 누른 것) -->
  ${done.length>0?`<div class="shd" style="margin-top:10px"><span class="shd-title" style="color:#22c55e">완료 (${done.length}건)</span></div>
  <div id="tr-done-list">${done.slice(0,20).map(r=>_trCard(r, window._trSeqMap.get(r.id)||0, false, false)).join('')}</div>
  ${done.length>20?`<div class="tr-done-sentinel" style="height:20px;text-align:center;padding:8px;color:var(--tx3);font-size:11px;cursor:pointer">▾ ${done.length-20}건 더 보기</div>`:''}`:''}

  <!-- 취소 -->
  ${cancelled.length>0?`<div class="shd" style="margin-top:8px"><span class="shd-title" style="color:var(--tx3)">취소 (${cancelled.length}건)</span></div>
  <div id="tr-cancel-list" style="opacity:.5">${cancelled.slice(0,20).map(r=>_trCard(r, window._trSeqMap.get(r.id)||0, false, false)).join('')}</div>
  ${cancelled.length>20?`<div class="tr-cancel-sentinel" style="height:20px;text-align:center;padding:8px;color:var(--tx3);font-size:11px;cursor:pointer">▾ ${cancelled.length-20}건 더 보기</div>`:''}`:''}
  </div>`;

  // AJ 관리자 — 반입 예정 카드의 인라인 장비번호 자동완성 초기화
  if (isAJ) {
    active.filter(r => r.type === 'in').forEach(r => _initInlineEquipAC(r.id, r.siteId));
  }
  // 완료/취소 섹션 지연 로딩 (IntersectionObserver)
  window._trDoneAll   = done;      window._trDoneIdx   = Math.min(20, done.length);
  window._trCancelAll = cancelled; window._trCancelIdx = Math.min(20, cancelled.length);
  _attachTrSentinels(el);
}

function _filterTransit(){
  if (!window._trFilter) window._trFilter = {};
  // 포커스·커서 위치 저장 (re-render 후 복원용)
  const _focId  = document.activeElement?.id || '';
  const _selEnd = document.activeElement?.selectionStart ?? null;
  window._trFilter.dateFrom = document.getElementById('tr-filter-date-from')?.value || '';
  window._trFilter.dateTo   = document.getElementById('tr-filter-date-to')?.value   || '';
  window._trFilter.company  = document.getElementById('tr-filter-company')?.value   || '';
  window._trFilter.spec     = document.getElementById('tr-filter-spec')?.value      || '';
  window._trFilter.status   = document.getElementById('tr-filter-status')?.value    || '';
  renderTransit();
  // re-render 후 포커스 복원
  if(_focId){
    const restored = document.getElementById(_focId);
    if(restored){
      restored.focus();
      if(_selEnd !== null && restored.setSelectionRange)
        restored.setSelectionRange(_selEnd, _selEnd);
    }
  }
}

function _clearTransitFilter(){
  window._trFilter = {dateFrom:'', dateTo:'', company:'', spec:'', status:''};
  window._trKpiTab = null;
  renderTransit();
}

function _setTrKpiTab(tab){
  window._trKpiTab = (window._trKpiTab === tab) ? null : tab;
  renderTransit();
}

function _openTransitSchedule(){
  const siteId=S?.siteId==='all'?null:S?.siteId;
  const allRecs=getTransit().filter(r=>siteId?r.siteId===siteId:true);
  const byDate={};
  allRecs.forEach(r=>{
    if(!r.date) return;
    if(r.status==='취소') return; // 취소 건 집계 제외
    if(!byDate[r.date]) byDate[r.date]={in:0,out:0,handover:0};
    if(r.type==='in')            byDate[r.date].in++;
    else if(r.type==='out')      byDate[r.date].out++;
    else if(r.type==='handover') byDate[r.date].handover++;
  });
  const d=new Date();
  window._schedCalState={year:d.getFullYear(),month:d.getMonth(),byDate};
  _renderSchedCalendar();
}

function _renderSchedCalendar(){
  const {year,month,byDate}=window._schedCalState;
  const MON=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayStr=today();

  // 요일 헤더
  let cellHtml=['일','월','화','수','목','금','토'].map((lbl,i)=>
    `<div style="text-align:center;font-size:9px;font-weight:700;padding:4px 0;color:${i===0?'#f87171':i===6?'#93c5fd':'var(--tx3)'}">${lbl}</div>`
  ).join('');

  // 빈 칸
  for(let i=0;i<firstDay;i++) cellHtml+='<div></div>';

  // 날짜 칸
  for(let d=1;d<=daysInMonth;d++){
    const mm=String(month+1).padStart(2,'0');
    const dd=String(d).padStart(2,'0');
    const ds=`${year}-${mm}-${dd}`;
    const v=byDate[ds]||{in:0,out:0,handover:0};
    const hasData=v.in||v.out||v.handover;
    const isToday=ds===todayStr;
    const dow=(firstDay+d-1)%7;
    const dateCol=isToday?'#fff':dow===0?'#f87171':dow===6?'#93c5fd':'var(--tx)';
    const dateBg=isToday?'background:var(--blue);border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;':'';
    const badges=[
      v.in      ?`<span style="color:var(--blue);font-size:8px;font-weight:900;line-height:1.3">↓${v.in}</span>`:'',
      v.out     ?`<span style="color:var(--orange);font-size:8px;font-weight:900;line-height:1.3">↑${v.out}</span>`:'',
      v.handover?`<span style="color:#14b8a6;font-size:8px;font-weight:900;line-height:1.3">⇄${v.handover}</span>`:'',
    ].filter(Boolean).join('');
    cellHtml+=`<div onclick="${hasData?`_schedSelectDate('${ds}')`:''}" style="text-align:center;padding:3px 1px;min-height:52px;border-radius:8px;${hasData?'background:rgba(255,255,255,.04);cursor:pointer;':''}" >
      <div style="font-size:12px;font-weight:${isToday||hasData?700:400};color:${dateCol};${dateBg}">${d}</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:0;margin-top:2px">${badges}</div>
    </div>`;
  }

  document.getElementById('tr-sched-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='tr-sched-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  ov.innerHTML=`<div style="background:var(--bg1);border-radius:16px;width:100%;max-width:420px;padding:16px 12px;box-shadow:0 8px 48px rgba(0,0,0,.7)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:14px;font-weight:800">📅 스케쥴표</span>
      <button onclick="document.getElementById('tr-sched-ov').remove()" style="background:none;border:none;font-size:20px;color:var(--tx3);cursor:pointer;line-height:1">×</button>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:10px">
      <span style="font-size:10px;color:var(--blue);font-weight:700">↓ 반입</span>
      <span style="font-size:10px;color:var(--orange);font-weight:700">↑ 반출</span>
      <span style="font-size:10px;color:#14b8a6;font-weight:700">⇄ 인수인계</span>
      <span style="font-size:10px;color:var(--tx3)">날짜 클릭 → 해당 내역 조회</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <button onclick="_schedNavMonth(-1)" style="font-size:22px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:2px 8px;border-radius:8px">‹</button>
      <span style="font-size:13px;font-weight:700">${year}년 ${MON[month]}</span>
      <button onclick="_schedNavMonth(1)"  style="font-size:22px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:2px 8px;border-radius:8px">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${cellHtml}</div>
  </div>`;
  document.body.appendChild(ov);
}

function _schedNavMonth(delta){
  if(!window._schedCalState) return;
  let {year,month}=window._schedCalState;
  month+=delta;
  if(month>11){month=0;year++;}
  if(month<0) {month=11;year--;}
  window._schedCalState.year=year;
  window._schedCalState.month=month;
  _renderSchedCalendar();
}

function _schedSelectDate(ds){
  // 스케쥴표 닫기
  document.getElementById('tr-sched-ov')?.remove();
  // 날짜 필터 적용
  if(!window._trFilter) window._trFilter={dateFrom:'',dateTo:'',company:'',spec:'',status:''};
  window._trFilter.dateFrom=ds;
  window._trFilter.dateTo=ds;
  window._trKpiTab=null; // KPI 탭 초기화
  // 반입반출 탭으로 이동하거나 렌더
  if(typeof goTab==='function') goTab('pg-transit');
  else renderTransit();
}

// ── KPI 달력 팝업 ─────────────────────────────────────────────
function openTransitCalendar(type, label){
  const siteId  = S?.siteId==='all' ? null : S?.siteId;
  const allRecs = getTransit().filter(r => siteId ? r.siteId===siteId : true);
  const d = new Date();
  window._calState = { type, label, year: d.getFullYear(), month: d.getMonth(), allRecs };
  _renderTransitCalendar();
}

function _renderTransitCalendar(){
  const {type, label, year, month, allRecs} = window._calState;

  // 타입별 레코드 필터
  const _DONE_ST = ['반입완료','반출완료','인계완료'];
  const typeRecs = type === 'cancel'
    ? allRecs.filter(r => r.status === '취소')
    : type === 'done'
    ? allRecs.filter(r => _DONE_ST.includes(r.status))
    : allRecs.filter(r => r.type === type && r.status !== '취소');

  // 날짜별 건수 집계
  const dateCnt = {};
  typeRecs.forEach(r => { dateCnt[r.date] = (dateCnt[r.date]||0)+1; });

  const firstDay    = new Date(year, month, 1).getDay();   // 0=일
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr    = today();
  const MON = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const typeColor   = type==='in'?'var(--blue)':type==='out'?'var(--orange)':type==='handover'?'#14b8a6':type==='done'?'#22c55e':'var(--tx3)';

  // 요일 헤더
  let cellHtml = ['일','월','화','수','목','금','토'].map((d,i)=>
    `<div style="text-align:center;font-size:10px;font-weight:700;padding:4px 0;color:${i===0?'#f87171':i===6?'#93c5fd':'var(--tx2)'}">${d}</div>`
  ).join('');

  // 빈 칸
  for(let i=0;i<firstDay;i++) cellHtml += '<div></div>';

  // 날짜 칸
  for(let d=1;d<=daysInMonth;d++){
    const mm = String(month+1).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    const ds = `${year}-${mm}-${dd}`;
    const cnt = dateCnt[ds] || 0;
    const isToday = ds === todayStr;
    const dow = (firstDay + d - 1) % 7;
    const tx  = isToday ? '#fff' : dow===0 ? '#f87171' : dow===6 ? '#93c5fd' : 'var(--tx)';
    const bg  = isToday ? 'background:var(--blue);border-radius:8px;' : '';
    const click = cnt ? `onclick="_calSelectDate('${ds}')"` : '';
    cellHtml += `<div ${click} style="text-align:center;padding:3px 1px;${bg}${cnt?'cursor:pointer;':''}border-radius:8px;transition:.1s"
      ${cnt?`onmouseenter="this.style.background='rgba(255,255,255,.1)'" onmouseleave="this.style.background='${isToday?'var(--blue)':'transparent'}'"`:''}>
      <div style="font-size:12px;font-weight:${isToday||cnt?700:400};color:${tx}">${d}</div>
      ${cnt
        ? `<div style="font-size:9px;font-weight:800;color:${typeColor}">${cnt}건</div>`
        : '<div style="height:14px"></div>'}
    </div>`;
  }

  document.getElementById('transit-cal-popup')?.remove();
  const ov = document.createElement('div');
  ov.id = 'transit-cal-popup';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  ov.onclick = e => { if(e.target===ov) _closeTransitCalendar(); };
  ov.innerHTML = `
    <div style="background:var(--bg1);border-radius:16px;width:100%;max-width:360px;padding:16px;box-shadow:0 8px 48px rgba(0,0,0,.7)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:14px;font-weight:800;color:${typeColor}">${label} 달력</span>
        <button onclick="_closeTransitCalendar()" style="font-size:18px;background:none;border:none;color:var(--tx2);cursor:pointer;line-height:1">✕</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <button onclick="_calNavMonth(-1)" style="font-size:20px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:4px 10px;border-radius:8px;transition:.1s" onmouseenter="this.style.background='rgba(255,255,255,.08)'" onmouseleave="this.style.background='none'">‹</button>
        <span style="font-size:14px;font-weight:700">${year}년 ${MON[month]}</span>
        <button onclick="_calNavMonth(1)"  style="font-size:20px;background:none;border:none;color:var(--tx2);cursor:pointer;padding:4px 10px;border-radius:8px;transition:.1s" onmouseenter="this.style.background='rgba(255,255,255,.08)'" onmouseleave="this.style.background='none'">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${cellHtml}</div>
      <div style="margin-top:10px;font-size:10px;color:var(--tx3);text-align:center">건수 표시된 날짜를 클릭하면 해당 일 목록이 검색됩니다</div>
    </div>`;
  document.body.appendChild(ov);
}

function _calNavMonth(delta){
  if(!window._calState) return;
  let {year,month} = window._calState;
  month += delta;
  if(month>11){month=0;year++;}
  if(month<0) {month=11;year--;}
  window._calState.year  = year;
  window._calState.month = month;
  _renderTransitCalendar();
}

function _calSelectDate(ds){
  if(!window._trFilter) window._trFilter={dateFrom:'',dateTo:'',company:'',spec:'',status:''};
  window._trFilter.dateFrom = ds;
  window._trFilter.dateTo   = ds;
  window._trKpiTab = null;  // KPI 탭 초기화 → 진행예정·완료·취소 전체 표시
  _closeTransitCalendar();
  renderTransit();
}

function _closeTransitCalendar(){
  document.getElementById('transit-cal-popup')?.remove();
  window._calState = null;
}

function _trHandoverCard(r, canEdit) {
  const st   = trStatusLabel(r.date, r.type, r.status);
  const diff = trDiff(r.date);
  const dDayStr = diff===0?' ★D-DAY':diff===1?' (내일)':diff>=2?' (D-'+diff+')':'';
  let border = 'border:1px solid var(--br)';
  let headerBg = 'background:var(--bg2)';
  if (!st.done && diff===0){ border='border:2px solid #14b8a6;box-shadow:0 0 0 3px rgba(20,184,166,.15)'; headerBg='background:linear-gradient(135deg,#042f2e,#0f766e)'; }
  else if (!st.done && diff===1){ border='border:2px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12)'; headerBg='background:linear-gradient(135deg,#451a03,#92400e)'; }
  const isDone = r.status==='인계완료';
  const doneBadge = isDone ? '<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:8px;background:rgba(34,197,94,.2);color:#22c55e;margin-left:4px">완료</span>' : '';
  const equipStr = (r.handoverEquips||[]).join(', ') || '—';
  const projHtml = (r.projChange && (r.fromProject||r.toProject))
    ? '<div style="grid-column:1/-1;display:flex;align-items:center;gap:5px;font-size:10px"><span style="color:var(--tx3)">프로젝트 변경</span><span style="color:var(--tx3)">'+(r.fromProject||'—')+'</span><span style="color:#14b8a6">→</span><span style="font-weight:800;color:#14b8a6">'+(r.toProject||'—')+'</span></div>'
    : '';
  const locationBadge = r.location ? '<span style="font-size:9px;padding:2px 7px;border-radius:6px;background:rgba(139,92,246,.15);color:#a78bfa">'+r.location+'</span>' : '';
  const handoverDoneByHtml = isDone && r.doneBy ? '<div style="text-align:center;font-size:10px;color:var(--tx3);margin-top:4px">완료 확인: '+r.doneBy+'</div>' : '';
  let actionHtml = '';
  if (canEdit && r.status==='예정') {
    actionHtml = '<div style="display:flex;gap:6px;margin-top:6px;border-top:1px solid var(--br);padding-top:8px">'
      +'<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#14b8a6;border-color:rgba(20,184,166,.4);font-weight:700" onclick="completeTransit(\''+r.id+'\')">인계완료</button>'
      +'<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px" onclick="editTransitDate(\''+r.id+'\')">날짜변경</button>'
      +'<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#f87171;border-color:rgba(248,113,113,.3)" onclick="cancelTransit(\''+r.id+'\')">취소</button>'
      +'</div>';
  }
  const hoIsExpanded = window._trExpanded && window._trExpanded.has(r.id);
  return `<div class="lcard" id="tr-card-${r.id}" style="margin-bottom:10px;border-radius:12px;overflow:hidden;${border}${r.status==='취소'?';opacity:.4':''}">
    <div onclick="toggleTrCard('${r.id}')" style="padding:10px 12px;cursor:pointer;display:flex;align-items:flex-start;gap:8px;${headerBg}">
      <div style="flex:1;display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;min-width:0">
        <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(20,184,166,.2);color:#14b8a6;flex-shrink:0">인수인계</span>
        ${doneBadge}
        <span style="font-weight:800;font-size:12px;flex-shrink:0">${r.fromCompany||r.company||'—'}</span>
        <span style="color:#14b8a6;font-weight:900;flex-shrink:0">→</span>
        <span style="font-weight:800;font-size:12px;flex-shrink:0">${r.toCompany||'—'}</span>
        <span style="font-family:monospace;font-size:11px;color:#60a5fa;flex-shrink:0">${equipStr}</span>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;font-weight:900;color:${!st.done&&diff<=1?st.color:'var(--tx)'}">${r.date}</div>
        <div style="font-size:10px;font-weight:800;color:${st.color}">${st.label}${dDayStr}</div>
      </div>
      <span id="tr-arrow-${r.id}" style="font-size:12px;color:var(--tx3);transition:transform .2s;flex-shrink:0;align-self:center${hoIsExpanded?';transform:rotate(180deg)':''}">▼</span>
    </div>
    <div id="tr-body-${r.id}" style="display:${hoIsExpanded?'block':'none'}">
      <div style="${headerBg};padding:10px 12px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(20,184,166,.2);color:#14b8a6">인수인계</span>
          ${doneBadge}
          <span style="font-weight:800;font-size:12px">${r.fromCompany||r.company||'—'}</span>
          <span style="color:#14b8a6;font-weight:900">→</span>
          <span style="font-weight:800;font-size:12px">${r.toCompany||'—'}</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;font-weight:900;color:${!st.done&&diff<=1?st.color:'var(--tx)'};cursor:pointer" onclick="editTransitDate(${JSON.stringify(r.id)})" title="날짜 변경">${r.date}</div>
          <div style="font-size:10px;font-weight:800;color:${st.color};margin-top:1px">${st.label}${dDayStr}</div>
        </div>
      </div>
      <div style="padding:10px 12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--tx3)">장비</span>
          <span style="font-family:monospace;font-weight:700;font-size:11px;color:#60a5fa">${equipStr}</span>
          ${locationBadge}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;color:var(--tx3)">
          ${projHtml}
          ${r.recorder?'<div style="grid-column:1/-1;display:flex;align-items:center;gap:5px"><span>기록자</span><b>'+r.recorder+'</b>'+(r.reporterPhone?'· <a href="tel:'+r.reporterPhone+'" style="color:#60a5fa;font-weight:600;text-decoration:none">'+r.reporterPhone+'</a>':'')+'</div>':''}
          ${r.note?'<div style="grid-column:1/-1;color:var(--tx3);font-size:10px">비고: '+r.note+'</div>':''}
        </div>
        ${actionHtml}
        ${handoverDoneByHtml}
      </div>
    </div>
  </div>`;
}

function _trCard(r, seqNo, canEdit, canMsg){
  if (r.type === 'handover') return _trHandoverCard(r, canEdit);
  const st = trStatusLabel(r.date, r.type, r.status);
  const diff = trDiff(r.date);
  const isIn = r.type === 'in';
  const isAJ = S?.role === 'aj';
  const specs = (r.specs && r.specs.length) ? r.specs : _parseSpecString(r.equip || r.equip_specs || '');
  const specStr = specs.map(s => {
    let line = s.spec + (s.model ? ' ('+s.model+')' : '') + ' ×' + s.qty;
    if (s.equipNos && s.equipNos.length) {
      line += ' <span style="font-family:monospace;font-size:11px;color:#60a5fa;font-weight:900">' + s.equipNos.join(', ') + '</span>';
    }
    return line;
  }).join('<br>') || (r.equip ? r.equip.replace(/\//g,'<br>') : '—');

  // 카드 헤더 배경
  let border = 'border:1px solid var(--br)';
  let headerBg = 'background:var(--bg2)';
  if (!st.done && diff === 0) {
    border = 'border:2px solid #3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)';
    headerBg = 'background:linear-gradient(135deg,rgba(30,58,95,.7),rgba(30,64,175,.7))';
  } else if (!st.done && diff === 1) {
    border = 'border:2px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12)';
    headerBg = 'background:linear-gradient(135deg,rgba(69,26,3,.7),rgba(146,64,14,.7))';
  }

  const typeColor = isIn ? '#60a5fa' : '#fb923c';
  const typeLabel = isIn ? '반입' : '반출';
  const dDayStr = diff === 0 ? ' ★D-DAY' : diff === 1 ? ' (내일)' : diff >= 2 ? ' (D-' + diff + ')' : '';

  // 완료 상태 배지
  const isDone = r.status === '반입완료' || r.status === '반출완료';
  const doneBadge = isDone
    ? `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:8px;background:rgba(34,197,94,.2);color:#22c55e;margin-left:4px">${r.status}</span>`
    : '';
  // 프로젝트 뱃지
  const projectBadge = r.project
    ? `<span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:6px;background:rgba(20,184,166,.2);color:#14b8a6">${r.project}</span>`
    : '';


  // AJ 장비번호 영역
  let ajEquipHtml = '';
  if (r.ajEquip) {
    ajEquipHtml = `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:8px;margin-bottom:6px">` +
      `<span style="font-size:10px;color:var(--tx3)">AJ장비번호</span>` +
      `<span style="font-family:monospace;font-weight:900;font-size:13px;color:#60a5fa;flex:1">${r.ajEquip}</span>` +
      `<button onclick="copyAjEquip(this)" style="padding:2px 8px;font-size:9px;background:rgba(96,165,250,.15);border:1px solid rgba(96,165,250,.3);border-radius:4px;color:#60a5fa;cursor:pointer" data-equip="${r.ajEquip}">복사</button>` +
      `<button onclick="shareTransitKakao(this.dataset.id)" data-id="${r.id}" style="padding:2px 8px;font-size:9px;background:rgba(254,229,0,.15);border:1px solid rgba(254,229,0,.3);border-radius:4px;color:#fde68a;cursor:pointer">카카오</button>` +
      `</div>`;
  }

  // 신청인/양중 담당자 정보 — 2열 테이블
  const _repLine = r.recorder || r.reporterName || '';
  const _repNameHtml = _repLine
    ? (r.reporterPhone
        ? '<a href="tel:'+r.reporterPhone+'" style="color:#60a5fa;font-weight:700;text-decoration:none">'+_repLine+'</a>'
        : '<b style="color:var(--tx)">'+_repLine+'</b>')
    : '<span style="color:var(--tx3)">—</span>';
  const _mgrNameTitle = [r.managerName, r.managerTitle].filter(Boolean).join(' ');
  const _mgrNameHtml = _mgrNameTitle
    ? (r.managerPhone
        ? '<a href="tel:'+r.managerPhone+'" style="color:#60a5fa;font-weight:700;text-decoration:none">'+_mgrNameTitle+'</a>'
        : '<b style="color:var(--tx)">'+_mgrNameTitle+'</b>')
    : '<span style="color:var(--tx3)">—</span>';
  const contactHtml = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">'
    + '<tr>'
    + '<td style="padding:4px 8px 3px 0;vertical-align:middle;text-align:left;width:50%">'
    + '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
    + '<span style="color:var(--tx3);font-size:10px;font-weight:600;flex-shrink:0">신청자</span>'
    + _repNameHtml
    + '</div>'
    + '</td>'
    + '<td style="padding:4px 0 3px 8px;vertical-align:middle;text-align:left;border-left:1px solid var(--br2)">'
    + '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
    + '<span style="color:var(--tx3);font-size:10px;font-weight:600;flex-shrink:0">양중담당</span>'
    + _mgrNameHtml
    + '</div>'
    + '</td>'
    + '</tr>'
    + '<tr>'
    + '<td style="padding:3px 8px 0 0;vertical-align:middle;text-align:left">'
    + '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
    + '<span style="color:var(--tx3);font-size:10px;font-weight:600;flex-shrink:0">비고</span>'
    + '<span style="color:var(--tx2)">'+(r.note&&r.note.trim()?r.note:'—')+'</span>'
    + '</div>'
    + '</td>'
    + '<td style="padding:3px 0 0 8px;vertical-align:middle;text-align:left;border-left:1px solid var(--br2)">'
    + '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
    + '<span style="color:var(--tx3);font-size:10px;font-weight:600;flex-shrink:0">양중위치</span>'
    + '<span style="color:var(--tx2)">'+(r.managerLocation||'—')+'</span>'
    + '</div>'
    + '</td>'
    + '</tr>'
    + '</table>';

  // ── 댓글 스레드 (최대 5개) ──
  const _msgs = r.ajMsgs && r.ajMsgs.length ? r.ajMsgs : (r.ajMsg ? [{text:r.ajMsg,author:S?.name||'AJ',ts:0}] : []);
  function _fmtTs(ts){ if(!ts) return ''; const d=new Date(ts); return (d.getMonth()+1)+'/'+(d.getDate())+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  const _allMsgHtmls = _msgs.map((m,i) => {
    const _delBtn = canEdit
      ? '<button data-rid="'+r.id+'" data-idx="'+i+'" onclick="var b=this;_delTransitMsg(b.dataset.rid,+b.dataset.idx)" style="margin-left:auto;background:none;border:none;color:var(--tx3);font-size:12px;cursor:pointer;padding:0 4px;line-height:1">×</button>'
      : '';
    const _isAJMsg = m.role === 'aj' || (!m.role && (m.author === 'AJ' || m.company === 'AJ네트웍스' || (S?.role==='aj')));
    const _avatarBg = _isAJMsg ? 'linear-gradient(135deg,#DE1F23,#9f1214)' : _companyColor(m.company||m.author||'');
    const _nameCol = _isAJMsg ? '#DE1F23' : '#60a5fa';
    const _msgBg = _isAJMsg ? 'rgba(222,31,35,.06)' : 'rgba(96,165,250,.07)';
    const _msgBdr = _isAJMsg ? 'rgba(222,31,35,.15)' : 'rgba(96,165,250,.15)';
    // 아바타: 업체명 앞 두글자 (없으면 이름 앞 두글자)
    const _avatarLabel = (m.company || (m.role==='aj'?'AJ네트웍스':m.author) || 'AJ').slice(0,2);
    return '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">'
      + '<div style="width:28px;height:28px;border-radius:50%;background:'+_avatarBg+';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:white;flex-shrink:0">'+_avatarLabel+'</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="display:flex;align-items:baseline;gap:5px;margin-bottom:3px">'
      + '<span style="font-size:11px;font-weight:800;color:'+_nameCol+'">'+(m.author||'AJ')+'</span>'
      + '<span style="font-size:9px;color:var(--tx3)">'+_fmtTs(m.ts)+'</span>'
      + _delBtn
      + '</div>'
      + '<div style="font-size:11px;color:var(--tx);line-height:1.5;background:'+_msgBg+';padding:6px 10px;border-radius:0 8px 8px 8px;border:1px solid '+_msgBdr+'">'+m.text+'</div>'
      + '</div></div>';
  });
  // 최대 15개, 최신 3개만 기본 표시 — 나머지는 아코디언
  const _MAX_MSGS = 15, _SHOW_MSGS = 3;
  const _isDoneStatus = ['반입완료','반출완료','인계완료','취소'].includes(r.status);
  const _canAddMsg = !_isDoneStatus && (canEdit || canMsg || S?.role==='sub') && _msgs.length < _MAX_MSGS;
  const _myInitials = (S?.company||(S?.role==='aj'?'AJ네트웍스':S?.name)||'AJ').slice(0,2);
  const _olderCnt  = Math.max(0, _allMsgHtmls.length - _SHOW_MSGS);
  const _olderHtml = _allMsgHtmls.slice(0, _olderCnt).join('');
  const _recentHtml= _allMsgHtmls.slice(_olderCnt).join('');
  const _accordId  = 'tr-more-' + r.id;
  const _moreBtn   = _olderCnt > 0
    ? '<button onclick="var d=document.getElementById(\''+_accordId+'\');var o=d.style.display!==\'none\';d.style.display=o?\'none\':\'\';this.innerHTML=o?\'▼ 댓글 더보기 ('+_olderCnt+'개)\':\'▲ 댓글 접기\';" style="display:block;width:100%;text-align:left;padding:4px 8px 7px;font-size:10px;font-weight:600;color:var(--tx3);background:none;border:none;border-bottom:1px dashed rgba(222,31,35,.2);cursor:pointer;margin-bottom:6px">▼ 댓글 더보기 ('+_olderCnt+'개)</button>'
    : '';
  const _olderBlock = _olderCnt > 0
    ? '<div id="'+_accordId+'" style="display:none">'+_olderHtml+'</div>'
    : '';
  const _myAvBg = S?.role==='aj' ? 'linear-gradient(135deg,#DE1F23,#9f1214)' : _companyColor(S?.company||S?.name||'');
  const _commentBox = _canAddMsg
    ? '<div style="display:flex;gap:8px;align-items:center;padding-top:8px;border-top:1px solid rgba(222,31,35,.15)">'
      + '<div style="width:28px;height:28px;border-radius:50%;background:'+_myAvBg+';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:white;flex-shrink:0">'+_myInitials+'</div>'
      + '<input type="text" id="tr-cmt-'+r.id+'" data-rid="'+r.id+'" placeholder="메시지 입력... (Enter)" onkeydown="if(event.keyCode===13){_addTransitMsg(this.dataset.rid);this.blur();}" style="flex:1;padding:7px 12px;font-size:11px;background:var(--bg2);border:1px solid var(--br);border-radius:20px;color:var(--tx);outline:none">'
      + '<button data-rid="'+r.id+'" onclick="_addTransitMsg(this.dataset.rid)" style="width:30px;height:30px;border-radius:50%;background:#DE1F23;border:none;cursor:pointer;font-size:14px;color:white;flex-shrink:0">↑</button>'
      + '</div>'
    : (_msgs.length >= _MAX_MSGS ? '<div style="font-size:10px;color:var(--tx3);text-align:center;padding-top:6px">최대 15개 댓글</div>' : '');
  const threadBlock = (_msgs.length > 0 || _canAddMsg)
    ? '<div style="margin-top:10px;padding:10px;background:rgba(222,31,35,.03);border:1px solid rgba(222,31,35,.12);border-radius:10px">'
      + _moreBtn
      + _olderBlock
      + (_msgs.length > 0 ? _recentHtml : '')
      + _commentBox
      + '</div>'
    : '';
  const ajMsgHtml = threadBlock;
  const ajInputHtml = ''; // 댓글 방식으로 통합

  // 서버 미동기화 배너
  const syncFailBanner = (!r.synced) ? `
  <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding:5px 8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);border-radius:6px">
    <span style="font-size:10px;color:#f87171;flex:1">⚠ 서버 미등록 — 네트워크 오류</span>
    <button onclick="_retryTransitPush('${r.id}')" style="font-size:10px;font-weight:700;padding:3px 8px;background:rgba(248,113,113,.2);border:1px solid rgba(248,113,113,.4);border-radius:5px;color:#f87171;cursor:pointer">재등록</button>
  </div>` : '';

  // 완료 확인자
  const doneByHtml = isDone && r.doneBy ? `<div style="text-align:center;font-size:10px;color:var(--tx3);margin-top:4px">완료 확인: ${r.doneBy}</div>` : '';

  // 액션 버튼
  let actionHtml = '';
  const alreadyDone = rec => rec.status === '반입완료' || rec.status === '반출완료' || rec.status === '취소';
  if (canEdit && !st.done && !alreadyDone(r)) {
    const completeBtnLabel = isIn ? '반입완료' : '반출완료';
    const completeBtnColor = isIn ? '#22c55e' : '#fb923c';
    const hasDispatch = !!(r.dispatch && _parseDispatch(r.dispatch).length);
    const dispBtnLabel = hasDispatch ? '배차정보 확인' : '배차정보 등록';
    actionHtml =
      `<div style="margin-top:4px;border-top:1px solid var(--br);padding-top:8px">` +
      `<div style="display:flex;gap:6px">` +
      `<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#a78bfa;border-color:rgba(167,139,250,.3)" onclick="openDispatchPopup('${r.id}')">${dispBtnLabel}</button>` +
      `<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:#f87171;border-color:rgba(248,113,113,.3)" onclick="cancelTransit('${r.id}')">취소</button>` +
      `<button class="btn-ghost" style="flex:1;font-size:10px;padding:5px;color:${completeBtnColor};border-color:${completeBtnColor}40;font-weight:700" onclick="completeTransit('${r.id}')">${completeBtnLabel}</button>` +
      `</div></div>`;
  } else if (canEdit && (alreadyDone(r) || st.done) && r.status !== '취소') {
    // 완료 후 안내만 (장비번호 수정은 specBlock 입력란에서)
    if (r.type === 'in' && (!r.ajEquip || !(r.specs||[]).every(s=>s.equipNos&&s.equipNos.length))) {
      actionHtml = `<div style="margin-top:6px;border-top:1px solid var(--br);padding-top:6px;font-size:10px;color:#fb923c;text-align:center">
        ⚠️ 일부 제원에 장비번호가 미등록되어 있습니다</div>`;
    }
  } else if (canMsg) {
    actionHtml = `<div style="margin-top:8px;border-top:1px solid var(--br);padding-top:6px">` +
      `<button class="btn-ghost" style="width:100%;font-size:10px;padding:5px" onclick="editTransitMsg('${r.id}')">AJ 메시지 입력</button>` +
      `</div>`;
  }

  // 아코디언 요약
  const totalQty = specs.reduce((a,s)=>a+(+s.qty||0),0);
  const specSummary = specs.length
    ? specs.map(s=>`<span style="font-size:11px;font-weight:700">${s.spec} × ${s.qty}</span>`).join('<br>')
    : (r.equip||'—');
  const specEquipSet = new Set(specs.flatMap(s=>s.equipNos||[]));
  const allEquipNos = [...specEquipSet];
  if(r.ajEquip){
    const ajNos = r.ajEquip.split(/[,，\s]+/).map(s=>s.trim()).filter(Boolean);
    ajNos.filter(n=>!specEquipSet.has(n)).forEach(n=>allEquipNos.unshift(n));
  }
  const equipShort = allEquipNos.length===0 ? '—'
    : allEquipNos.length<=2 ? allEquipNos.join(', ')
    : allEquipNos.slice(0,2).join(', ')+' ...';
  const isExpanded = window._trExpanded && window._trExpanded.has(r.id);

  return `<div class="lcard" id="tr-card-${r.id}" style="position:relative;margin-bottom:10px;border-radius:12px;overflow:hidden;${border}${r.status==='취소'?';opacity:.4':''}">
    <!-- 입력일/고유번호 — 카드 우상단 고정 -->
    <div style="position:absolute;top:0;right:0;z-index:2;background:rgba(0,0,0,.28);border-radius:0 12px 0 8px;padding:2px 10px;text-align:right;pointer-events:none;display:flex;align-items:center;gap:6px">
      ${(r.ts||r.createdAt)?`<span style="font-size:9px;color:rgba(255,255,255,.55);font-family:monospace">${_fmtAsDate(r.ts||r.createdAt)}</span>`:''}
      ${seqNo?`<span style="font-size:9px;color:rgba(255,255,255,.55);font-family:monospace">No.${seqNo}</span>`:''}
    </div>
    <div onclick="toggleTrCard('${r.id}')" style="padding:10px 12px;cursor:pointer;display:flex;align-items:flex-start;gap:8px;${headerBg}">
      <div style="flex:1;min-width:0">
        <!-- 1행: 반입/반출 뱃지 + 완료뱃지 + 업체명 + 현장명 + 프로젝트 -->
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(${isIn?'96,165,250':'251,146,60'},.2);color:${typeColor};flex-shrink:0">${typeLabel}</span>
          ${doneBadge}
          <span style="font-weight:800;font-size:12px">${r.company||'—'}</span>
          ${r.siteName?`<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,.12);color:#f59e0b;font-weight:700">${r.siteName}</span>`:''}
          ${r.project?`<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(20,184,166,.12);color:#14b8a6;font-weight:700">${r.project}</span>`:''}
        </div>
        <!-- 2행: 제원×수량 + 장비번호 -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px">
          <div style="font-size:11px;line-height:1.4;color:var(--tx2)">${specSummary}</div>
          ${equipShort!=='—'?`<span style="font-family:monospace;font-size:11px;color:#60a5fa">${equipShort}</span>`:''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${totalQty>0?`<span style="font-size:10px;font-weight:700;color:var(--tx3);flex-shrink:0">총 ${totalQty}대</span>`:''}
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:900;color:${!st.done&&diff<=1?st.color:'var(--tx)'}">${r.date}</div>
          <div style="font-size:10px;font-weight:800;color:${st.color}">${st.label}${dDayStr}</div>
          ${isIn && r.planData ? `<button onclick="event.stopPropagation();_showTrPlanPopup('${r.id}')" style="margin-top:3px;padding:2px 8px;background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);border-radius:5px;color:#a5b4fc;font-size:9px;font-weight:700;cursor:pointer">📄 신청서</button>` : ''}
        </div>
      </div>
      <span id="tr-arrow-${r.id}" style="font-size:12px;color:var(--tx3);transition:transform .2s;flex-shrink:0;align-self:center${isExpanded?';transform:rotate(180deg)':''}">▼</span>
    </div>
    <div id="tr-body-${r.id}" style="display:${isExpanded?'block':'none'}">
      <div style="padding:10px 12px">
        ${_renderSpecBlock(r, isIn && isAJ)}
        ${(!isAJ || !isIn) ? ajEquipHtml : ''}
        ${contactHtml}
        ${ajMsgHtml}
        ${ajInputHtml}
        ${actionHtml}
        ${doneByHtml}
        ${syncFailBanner}
      </div>
    </div>
  </div>`;
}


// ── 배차정보 팝업 (다중 차량 지원) ────────────────────────────
function _parseDispatch(v){
  if(!v) return [];
  try{
    const o=JSON.parse(v);
    if(Array.isArray(o)) return o.filter(i=>i.driver||i.carNo||i.phone);
    // 기존 단일 객체 → 배열로 변환
    if(o&&typeof o==='object'&&(o.driver||o.carNo||o.phone))
      return [{driver:o.driver||'',carNo:o.carNo||'',phone:o.phone||''}];
  }catch(_e){}
  return [];
}
function _dispatchRowHtml(idx, d={}){
  const rowId = 'dr-' + idx + '-' + Date.now().toString(36);
  return `<div class="dispatch-row" style="margin-bottom:8px;padding:8px;background:rgba(255,255,255,.04);border:1px solid var(--br);border-radius:8px" data-row-id="${rowId}">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:var(--tx3)">${idx+1}번 차량</span>
      <button onclick="_openDriverPicker(this.closest('.dispatch-row'))" style="margin-left:auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3);color:#60a5fa;cursor:pointer">기사님 불러오기</button>
      <button onclick="this.closest('.dispatch-row').remove()" style="background:none;border:none;color:#f87171;font-size:16px;cursor:pointer;line-height:1;padding:0 4px">×</button>
    </div>
    <div style="display:flex;gap:6px">
      <input type="text" class="fg-input disp-driver" value="${d.driver||''}" placeholder="기사 성명" style="flex:1;min-width:0">
      <input type="text" class="fg-input disp-carno" value="${d.carNo||''}" placeholder="차량번호" style="flex:1;min-width:0">
      <input type="tel" class="fg-input phone-input disp-phone" value="${d.phone||''}" placeholder="연락처" maxlength="11" style="flex:1;min-width:0">
    </div>
  </div>`;
}
// 과거 배차 이력에서 중복 없는 기사 목록 추출
function _getDriverHistory(){
  const seen = new Map();
  getTransit().forEach(r=>{
    const list = _parseDispatch(r.dispatch);
    list.forEach(d=>{
      if(!d.driver && !d.phone) return;
      const key = (d.driver||'') + '|' + (d.phone||'');
      if(!seen.has(key)) seen.set(key, {driver:d.driver||'', carNo:d.carNo||'', phone:d.phone||''});
    });
  });
  return [...seen.values()].sort((a,b)=>(a.driver||'').localeCompare(b.driver||''));
}
// 기사님 불러오기 선택 팝업
function _openDriverPicker(rowEl){
  if(!rowEl) return;
  const drivers = _getDriverHistory();
  document.getElementById('driver-picker')?.remove();
  const pop = document.createElement('div');
  pop.id = 'driver-picker';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:flex-end;justify-content:center;padding-bottom:env(safe-area-inset-bottom)';
  const listHtml = drivers.length
    ? drivers.map((d,i)=>`
        <button onclick="_fillDriverRow(${i})" data-i="${i}" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-bottom:1px solid var(--br);cursor:pointer;display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🚛</span>
          <span style="flex:1;min-width:0">
            <span style="font-size:13px;font-weight:700;color:var(--tx1)">${d.driver||'(이름 없음)'}</span>
            ${d.carNo?`<span style="font-size:11px;color:var(--tx3);margin-left:6px">${d.carNo}</span>`:''}
            ${d.phone?`<div style="font-size:11px;color:var(--tx3);margin-top:2px">${d.phone}</div>`:''}
          </span>
        </button>`).join('')
    : '<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">저장된 기사님 이력이 없습니다</div>';
  pop.innerHTML = `
    <div style="background:var(--bg1);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:70vh;display:flex;flex-direction:column">
      <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--br);flex-shrink:0">
        <span style="font-size:14px;font-weight:800">기사님 불러오기</span>
        <button onclick="document.getElementById('driver-picker').remove()" style="background:none;border:none;font-size:20px;color:var(--tx2);cursor:pointer;padding:4px">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1">${listHtml}</div>
    </div>`;
  // 각 버튼에 클릭 이벤트 (rowEl 참조 전달)
  pop.addEventListener('click', e=>{
    if(e.target === pop){ pop.remove(); return; }
    const btn = e.target.closest('button[data-i]');
    if(btn){
      const d = drivers[+btn.dataset.i];
      if(d){
        rowEl.querySelector('.disp-driver').value = d.driver||'';
        rowEl.querySelector('.disp-carno').value  = d.carNo||'';
        rowEl.querySelector('.disp-phone').value  = d.phone||'';
      }
      pop.remove();
    }
  });
  document.body.appendChild(pop);
}
function _dispatchAddRow(){
  const rows=document.getElementById('dispatch-rows');
  if(!rows) return;
  const idx=rows.querySelectorAll('.dispatch-row').length;
  const tmp=document.createElement('div');
  tmp.innerHTML=_dispatchRowHtml(idx);
  rows.appendChild(tmp.firstChild);
}
function openDispatchPopup(id){
  const recs = getTransit();
  const r = recs.find(x=>x.id===id);
  if(!r) return;
  const list = _parseDispatch(r.dispatch);
  const isAJ = S?.role==='aj';
  document.getElementById('dispatch-popup')?.remove();
  const pop = document.createElement('div');
  pop.id = 'dispatch-popup';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding-bottom:env(safe-area-inset-bottom)';
  if(isAJ){
    const initialRows = list.length ? list.map((d,i)=>_dispatchRowHtml(i,d)).join('') : _dispatchRowHtml(0);
    pop.innerHTML = `
    <div style="background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px;width:100%;max-width:480px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:14px;font-weight:800">배차정보 입력</span>
        <button onclick="document.getElementById('dispatch-popup').remove()" style="background:none;border:none;font-size:20px;color:var(--tx2);cursor:pointer;padding:4px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:14px">${r.company} · ${r.date}</div>
      <div id="dispatch-rows">${initialRows}</div>
      <button onclick="_dispatchAddRow()" style="width:100%;padding:8px;margin-bottom:10px;background:rgba(255,255,255,.05);border:1px dashed var(--br);border-radius:8px;color:var(--tx2);font-size:12px;cursor:pointer">+ 차량 추가</button>
      <div style="display:flex;gap:8px;margin-top:6px">
        ${list.length ? `<button onclick="_copyDispatchText('${id}')" style="flex:1;padding:10px;background:rgba(96,165,250,.12);color:#60a5fa;border:1px solid rgba(96,165,250,.3);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">📋 복사</button>` : ''}
        <button onclick="saveDispatch('${id}')" style="flex:1;padding:10px;background:#DE1F23;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">저장</button>
        <button onclick="document.getElementById('dispatch-popup').remove()" style="flex:1;padding:10px;background:var(--bg2);color:var(--tx2);border:1px solid var(--br);border-radius:8px;font-size:13px;cursor:pointer">닫기</button>
      </div>
    </div>`;
  } else {
    const viewHtml = list.length
      ? list.map((d,i)=>`
        <div style="padding:8px 10px;background:var(--bg2);border:1px solid var(--br);border-radius:8px;margin-bottom:8px;font-size:12px">
          <div style="font-size:10px;font-weight:700;color:var(--tx3);margin-bottom:5px">${i+1}번 차량</div>
          ${d.driver?`<div style="display:flex;gap:8px;margin-bottom:3px"><span style="color:var(--tx3);min-width:56px">기사</span><b>${d.driver}</b></div>`:''}
          ${d.carNo?`<div style="display:flex;gap:8px;margin-bottom:3px"><span style="color:var(--tx3);min-width:56px">차량번호</span><b>${d.carNo}</b></div>`:''}
          ${d.phone?`<div style="display:flex;gap:8px"><span style="color:var(--tx3);min-width:56px">연락처</span><a href="tel:${d.phone}" style="color:#60a5fa;font-weight:700;text-decoration:none">${d.phone}</a></div>`:''}
        </div>`).join('')
      : '<div style="color:var(--tx3);text-align:center;padding:16px">(배차정보 없음)</div>';
    pop.innerHTML = `
    <div style="background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:14px;font-weight:800">배차정보</span>
        <button onclick="document.getElementById('dispatch-popup').remove()" style="background:none;border:none;font-size:20px;color:var(--tx2);cursor:pointer;padding:4px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:14px">${r.company} · ${r.date}</div>
      ${viewHtml}
      <div style="display:flex;gap:8px;margin-top:8px">
        ${list.length ? `<button onclick="_copyDispatchText('${id}')" style="flex:1;padding:10px;background:rgba(96,165,250,.12);color:#60a5fa;border:1px solid rgba(96,165,250,.3);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">📋 복사</button>` : ''}
        <button onclick="document.getElementById('dispatch-popup').remove()" style="flex:1;padding:10px;background:var(--bg2);color:var(--tx2);border:1px solid var(--br);border-radius:8px;font-size:13px;cursor:pointer">닫기</button>
      </div>
    </div>`;
  }
  pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
  document.body.appendChild(pop);
}

async function saveDispatch(id){
  const rows = document.querySelectorAll('#dispatch-rows .dispatch-row');
  const list = [];
  rows.forEach(row=>{
    const driver=row.querySelector('.disp-driver')?.value.trim()||'';
    const carNo =row.querySelector('.disp-carno')?.value.trim()||'';
    const phone =row.querySelector('.disp-phone')?.value.trim()||'';
    if(driver||carNo||phone) list.push({driver,carNo,phone});
  });
  const recs = getTransit();
  const rec = recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  rec.dispatch = list.length ? JSON.stringify(list) : '';
  rec.synced = false;
  await saveTransit(recs);
  document.getElementById('dispatch-popup')?.remove();
  // 즉시 서버 연동
  _directPushTransit(rec).catch(e => { console.warn('[saveDispatch push]', e); scheduleRetrySync(); });
  // 알림: 배차정보 저장 시 AJ관리자 + 신청인
  if(list.length){
    const _dpBody = `${rec.date} · ${list.length}대`;
    pushSBNotif({target_aj_type:'관리자', type:'dispatch_saved', title:`🚛 배차정보: ${rec.company}`, body:_dpBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
    if(rec.submitterMemberId) pushSBNotif({target_user_id:rec.submitterMemberId, type:'dispatch_saved', title:`🚛 배차정보: ${rec.company}`, body:_dpBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  }
  toast(list.length ? `배차정보 ${list.length}대 저장됨` : '배차정보 삭제됨', 'ok');
  renderTransit();
  if(list.length) openDispatchPopup(id); // 저장 후 확인/복사 팝업 재오픈
}

function _copyDispatchText(id){
  const r = getTransit().find(x=>x.id===id);
  if(!r) return;
  const list = _parseDispatch(r.dispatch);
  if(!list.length){ toast('배차정보가 없습니다','warn'); return; }
  const lines = list.map((d,i)=>{
    const parts = [`[${i+1}번 차량]`];
    if(d.driver) parts.push(`기사: ${d.driver}`);
    if(d.carNo)  parts.push(`차량번호: ${d.carNo}`);
    if(d.phone)  parts.push(`연락처: ${d.phone}`);
    return parts.join('\n');
  });
  const text = `[배차정보] ${r.company} (${r.date})\n\n${lines.join('\n\n')}`;
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(()=>toast('배차정보 복사됨 ✓','ok')).catch(()=>{
      const t=document.createElement('textarea'); t.value=text;
      document.body.appendChild(t); t.select(); document.execCommand('copy');
      document.body.removeChild(t); toast('배차정보 복사됨 ✓','ok');
    });
  } else {
    const t=document.createElement('textarea'); t.value=text;
    document.body.appendChild(t); t.select(); document.execCommand('copy');
    document.body.removeChild(t); toast('배차정보 복사됨 ✓','ok');
  }
}

async function _retryTransitPush(id){
  const recs = getTransit();
  const rec = recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  const btn = event?.target;
  if(btn){ btn.textContent='재등록 중...'; btn.disabled=true; }
  try {
    await _directPushTransit(rec);
    toast('서버 등록 완료 ✓','ok');
    renderTransit();
  } catch(e) {
    toast('재등록 실패 — 네트워크를 확인하세요','err');
    if(btn){ btn.textContent='재등록'; btn.disabled=false; }
  }
}

async function _retryASPush(id){
  const arr = getAsReqs();
  const req = arr.find(r=>r.id===id);
  if(!req){ toast('레코드를 찾을 수 없습니다','err'); return; }
  const btn = event?.target;
  if(btn){ btn.textContent='재등록 중...'; btn.disabled=true; }
  try {
    await _directPushAS(req);
    toast('서버 등록 완료 ✓','ok');
    renderASPage();
  } catch(e) {
    toast('재등록 실패 — 네트워크를 확인하세요','err');
    if(btn){ btn.textContent='재등록'; btn.disabled=false; }
  }
}

function shareTransitKakao(recId){
  const recs = getTransit();
  const r = recs.find(x=>x.id===recId);
  if(!r) return;
  const specs = (r.specs||[]).map(s=>`${s.spec} ×${s.qty}`).join(', ');
  const equip = r.ajEquip ? `장비번호: ${r.ajEquip}` : '(장비번호 미입력)';
  const txt = `[반입완료] ${r.company}
날짜: ${r.date}
제원: ${specs}
${equip}`;
  if(navigator.share){
    navigator.share({title:'반입완료 정보', text:txt}).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(txt).then(()=>{
      toast('클립보드에 복사됨 — 카카오톡에 붙여넣기 하세요','ok');
      window.open('https://open.kakao.com/o/sGpAMVjf','_blank');
    });
  }
}

function copyAjEquip(btn){
  const equip = btn.getAttribute('data-equip');
  if(navigator.clipboard){
    navigator.clipboard.writeText(equip).then(function(){ toast('복사됨','ok'); });
  } else {
    const t = document.createElement('textarea');
    t.value = equip; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
    toast('복사됨','ok');
  }
}

function copyInInfo(recId){
  const r = getTransit().find(x=>x.id===recId);
  if(!r) return;
  const lines = (r.specs||[]).map(s=>{
    let line = s.spec + (s.model?' ('+s.model+')':'') + ' ×'+s.qty;
    if(s.equipNos && s.equipNos.length) line += '  장비번호: '+s.equipNos.join(', ');
    return line;
  });
  const txt = '[반입] '+r.company+' · '+r.date+'\n'+(lines.length?lines.join('\n'):'(제원 없음)');
  if(navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast('복사됨','ok'));
  } else {
    const t=document.createElement('textarea');
    t.value=txt; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
    toast('복사됨','ok');
  }
}


/* ── 트랜짓 댓글 (메시지 스레드) ── */
async function _addTransitMsg(id){
  const inp = document.getElementById('tr-cmt-'+id);
  if(!inp) return;
  const text = inp.value.trim();
  if(!text){ toast('메시지를 입력하세요','err'); return; }
  const recs = getTransit();
  const rec = recs.find(r=>r.id===id);
  if(!rec){ toast('레코드 없음','err'); return; }
  const msgs = rec.ajMsgs && rec.ajMsgs.length ? rec.ajMsgs : (rec.ajMsg ? [{text:rec.ajMsg, author:S?.name||'AJ', ts:0, role:'aj'}] : []);
  if(msgs.length >= 15){ toast('최대 15개 댓글','warn'); return; }
  msgs.push({text, author:S?.name||'AJ', company:S?.company||(S?.role==='aj'?'AJ네트웍스':''), ts:Date.now(), role: S?.role||'aj'});
  rec.ajMsgs = msgs;
  rec.ajMsg = msgs[0]?.text||'';
  rec.synced = false;
  saveTransit(recs);
  inp.value = '';
  renderTransit();
  // 서버 즉시 push
  try { await _directPushTransit(rec); toast('메시지 추가됨','ok'); }
  catch(e){ console.warn('[addTransitMsg push]',e); scheduleRetrySync(); toast('로컬 저장됨 — 자동 재시도','warn',2500); }
  // 댓글 알림: AJ가 쓴 경우 → 신청인, 협력사가 쓴 경우 → AJ관리자
  const _trNotifBody = `${S?.name||''}(${S?.company||''}) — ${text.slice(0,50)}`;
  if(S?.role === 'aj'){
    if(rec.submitterMemberId) pushSBNotif({target_user_id:rec.submitterMemberId, type:'transit_comment',
      title:`💬 댓글 [${rec.company}]`, body:_trNotifBody, ref_id:rec.id, site_id:rec.siteId||null}).catch(()=>{});
  } else {
    pushSBNotif({target_aj_type:'관리자', type:'transit_comment',
      title:`💬 댓글 [${rec.company}]`, body:_trNotifBody, ref_id:rec.id, site_id:rec.siteId||null}).catch(()=>{});
  }
  // @멘션 감지
  const _trMentions = [...new Set((text.match(/@([^\s@#]+)/g)||[]).map(m=>m.slice(1)))];
  if(_trMentions.length){
    const _trAllSub = typeof getMembers==='function' ? getMembers() : [];
    const _trAllAj  = typeof _getAjMembers==='function' ? _getAjMembers() : [];
    _trMentions.forEach(mName=>{
      const _st = _trAllSub.find(m=>m.name===mName);
      const _at = _trAllAj.find(m=>m.name===mName);
      const _tid = (_st?.record_id||_st?.id)||(_at?.record_id||_at?.emp_no)||null;
      if(_tid) pushSBNotif({target_user_id:_tid, type:'mention',
        title:`💬 @${mName} 님이 태그되었습니다`,
        body:`${S?.name||''}(${S?.company||''}) — ${text.slice(0,60)}`,
        ref_id:rec.id, site_id:rec.siteId||null}).catch(()=>{});
    });
  }
  _fetchFromSB().catch(()=>{}).then(changed=>{ if(changed) renderTransit(); });
}

async function _delTransitMsg(id, idx){
  if(!confirm('메시지를 삭제하시겠습니까?')) return;
  const recs = getTransit();
  const rec = recs.find(r=>r.id===id);
  if(!rec) return;
  const msgs = rec.ajMsgs && rec.ajMsgs.length ? [...rec.ajMsgs] : (rec.ajMsg?[{text:rec.ajMsg,author:'AJ',ts:0}]:[]);
  msgs.splice(idx,1);
  rec.ajMsgs = msgs;
  rec.ajMsg = msgs[0]?.text||'';
  rec.synced = false;
  saveTransit(recs);
  renderTransit();
  // 서버 즉시 push
  try { await _directPushTransit(rec); toast('삭제됨','ok'); }
  catch(e){ console.warn('[delTransitMsg push]',e); scheduleRetrySync(); toast('로컬 삭제됨 — 자동 재시도','warn',2500); }
  _fetchFromSB().catch(()=>{}).then(()=>renderTransit());
}

// 카드 인라인 장비번호 저장 (자동완성 포함)
// ══════════════════════════════════════════════════════════
//  반입 카드 — 제원별 장비번호 인라인 입력 블록
// ══════════════════════════════════════════════════════════
// 제원 문자열 파싱: "10MX1, 12MX2" 또는 "10M×1/12M×2" → [{spec, qty}]
function _parseSpecString(str) {
  if (!str || str === '—') return [];
  // "10MX1,12MX1" / "10M×1/12M×2" / "10M×1, 12M×2" 형식 지원
  const parts = str.split(/[,/]+/).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    // "10MX1" / "10M×1" / "10M ×1" / "10M x 1"
    const m = p.match(/^(.+?)\s*[Xx×]\s*(\d+)$/);
    if (m) return { spec: m[1].trim(), qty: parseInt(m[2]) || 1, model: '', equipNos: [] };
    // 수량 없으면 1로
    return { spec: p, qty: 1, model: '', equipNos: [] };
  }).filter(s => s.spec);
}

function _renderSpecBlock(r, canEdit) {
  const isIn = r.type === 'in';
  // specs가 없거나 비어있으면 equip 문자열 파싱 시도
  let specs = r.specs && r.specs.length ? r.specs : _parseSpecString(r.equip || r.equip_specs || '');
  if (!specs.length) {
    const fallback = r.equip || r.equip_specs || '';
    const rid = r.id;
    // 반입 + 편집권한: spec 없어도 장비번호 직접 입력란 표시 (반입신청 스펙블록과 동일 위치)
    if (isIn && canEdit) {
      const hasEquip = !!(r.ajEquip && r.ajEquip.trim());
      const isEditMode = !hasEquip || (window._specEditMode && window._specEditMode.get(rid));
      // ── 읽기 모드: 장비번호 저장됨 → 복사/수정 버튼
      if (!isEditMode) {
        window['_copyData_' + rid] = r.ajEquip;
        return `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(96,165,250,.04);border:1px solid rgba(96,165,250,.15);border-radius:8px">
          <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:6px">🏷 장비번호</div>
          ${fallback?`<div style="font-size:11px;color:var(--tx3);margin-bottom:4px;line-height:1.6">${fallback.replace(/\//g,'<br>')}</div>`:''}
          <div style="font-size:12px;font-weight:900;font-family:monospace;color:#60a5fa;line-height:1.8;margin-bottom:6px">${r.ajEquip.replace(/,/g,', ')}</div>
          <div style="display:flex;justify-content:flex-end;gap:4px">
            <button onclick="var t=window['_copyData_${rid}'];if(navigator.clipboard){navigator.clipboard.writeText(t).then(()=>toast('복사됨','ok')).catch(()=>{});}else{var e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');e.remove();toast('복사됨','ok');}"
              style="width:12.5%;padding:5px 0;font-size:11px;font-weight:700;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:6px;color:#60a5fa;cursor:pointer">복사</button>
            <button onclick="if(!window._specEditMode)window._specEditMode=new Map();window._specEditMode.set('${rid}',true);renderTransit();"
              style="width:12.5%;padding:5px 0;font-size:11px;font-weight:700;background:rgba(96,165,250,.18);border:1px solid rgba(96,165,250,.35);border-radius:6px;color:#60a5fa;cursor:pointer">수정</button>
          </div>
        </div>`;
      }
      // ── 편집 모드: 입력란 + 날짜변경/저장완료 버튼
      return `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(96,165,250,.04);border:1px solid rgba(96,165,250,.15);border-radius:8px">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:7px">🏷 장비번호 입력</div>
        ${fallback?`<div style="font-size:11px;color:var(--tx3);margin-bottom:4px;line-height:1.6">${fallback.replace(/\//g,'<br>')}</div>`:''}
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <input type="text" id="inline-equip-${rid}" value="${r.ajEquip||''}" placeholder="장비번호 입력 (쉼표 구분)" oninput="this.value=this.value.toUpperCase()" autocomplete="off"
            style="flex:1;padding:5px 8px;font-size:11px;font-family:monospace;font-weight:700;text-transform:uppercase;background:var(--bg2);border:1px solid var(--br);border-radius:6px;color:#60a5fa;outline:none">
        </div>
        <div style="display:flex;justify-content:flex-end;gap:4px;padding-top:6px;border-top:1px solid rgba(96,165,250,.12)">
          <button onclick="editTransitDate('${rid}')"
            style="min-width:72px;padding:5px 10px;font-size:11px;font-weight:700;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:6px;color:#60a5fa;cursor:pointer;white-space:nowrap">날짜변경</button>
          <button onclick="_saveInlineEquip('${rid}')"
            style="min-width:72px;padding:5px 10px;font-size:11px;font-weight:700;background:rgba(96,165,250,.18);border:1px solid rgba(96,165,250,.35);border-radius:6px;color:#60a5fa;cursor:pointer;white-space:nowrap">저장완료</button>
        </div>
      </div>`;
    }
    return '<div style="font-size:12px;font-weight:700;margin-bottom:6px;line-height:1.8">' + (fallback||'—').replace(/\//g,'<br>') + '</div>';
  }

  // 반입 카드 + 편집 권한: 제원별 장비번호 입력란 표시 (한번에 저장)
  if (isIn && canEdit) {
    const rid = r.id;
    const allHaveNos = specs.every(s => s.equipNos && s.equipNos.length > 0);
    const isEditMode = !allHaveNos || (window._specEditMode && window._specEditMode.get(rid));
    // ── 읽기 전용 모드: 장비번호 이미 저장됨 → 텍스트 표시 + "수정" 버튼
    if (!isEditMode) {
      const specLines = specs.map(s => {
        let line = s.spec + (s.model ? ' (' + s.model + ')' : '') + ' ×' + s.qty;
        if (s.equipNos && s.equipNos.length)
          line += ' <span style="font-family:monospace;color:#60a5fa;font-weight:900">' + s.equipNos.join(', ') + '</span>';
        return line;
      }).join('<br>');
      const _rdCopyText = specs.map(s => {
        let t = s.spec + ' ×' + s.qty;
        if (s.equipNos && s.equipNos.length) t += ' / ' + s.equipNos.join(', ');
        return t;
      }).join('\n');
      window['_copyData_' + rid] = _rdCopyText;
      return `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(96,165,250,.04);border:1px solid rgba(96,165,250,.15);border-radius:8px">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:6px">🏷 제원별 장비번호</div>
        <div style="font-size:12px;font-weight:700;line-height:2;margin-bottom:6px">${specLines}</div>
        <div style="display:flex;justify-content:flex-end;gap:4px">
          <button onclick="var t=window['_copyData_${rid}'];if(navigator.clipboard){navigator.clipboard.writeText(t).then(()=>toast('복사됨','ok')).catch(()=>{});}else{var e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');e.remove();toast('복사됨','ok');}"
            style="width:12.5%;padding:5px 0;font-size:11px;font-weight:700;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:6px;color:#60a5fa;cursor:pointer">복사</button>
          <button onclick="if(!window._specEditMode)window._specEditMode=new Map();window._specEditMode.set('${rid}',true);renderTransit();"
            style="width:12.5%;padding:5px 0;font-size:11px;font-weight:700;background:rgba(96,165,250,.18);border:1px solid rgba(96,165,250,.35);border-radius:6px;color:#60a5fa;cursor:pointer">수정</button>
        </div>
      </div>`;
    }
    // ── 편집 모드: 장비번호 입력란 표시
    const rows = specs.map((s, idx) => {
      const hasNos = s.equipNos && s.equipNos.length;
      const nosVal = hasNos ? s.equipNos.join(', ') : '';
      const inpId  = 'spec-equip-' + rid + '-' + idx;
      const specLabel = s.spec + (s.model ? ' (' + s.model + ')' : '') + ' ×' + s.qty;
      return `<div style="display:flex;align-items:center;gap:14px;margin-bottom:5px">
        <span style="font-size:12px;font-weight:700;white-space:nowrap;min-width:90px;color:var(--tx)">${specLabel}</span>
        <input type="text" id="${inpId}" data-rid="${rid}" data-idx="${idx}"
          value="${nosVal}"
          placeholder="장비번호 (예: GK228, GK229)"
          style="flex:1;padding:5px 8px;font-size:11px;font-family:monospace;font-weight:700;text-transform:uppercase;
            background:var(--bg2);border:1px solid ${hasNos?'rgba(96,165,250,.35)':'var(--br)'};border-radius:6px;
            color:#60a5fa;outline:none"
          oninput="this.value=this.value.toUpperCase()" autocomplete="off">
      </div>`;
    }).join('');
    const btnId = 'spec-save-btn-' + rid;
    return `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(96,165,250,.04);border:1px solid rgba(96,165,250,.15);border-radius:8px">
      <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:7px">🏷 제원별 장비번호 입력</div>
      ${rows}
      <div style="display:flex;justify-content:flex-end;gap:4px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(96,165,250,.12)">
        <button onclick="editTransitDate('${rid}')"
          style="min-width:72px;padding:5px 10px;font-size:11px;font-weight:700;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:6px;color:#60a5fa;cursor:pointer;white-space:nowrap">날짜변경</button>
        <button id="${btnId}" onclick="_saveAllSpecEquip('${rid}')"
          style="min-width:72px;padding:5px 10px;font-size:11px;font-weight:700;background:rgba(96,165,250,.18);border:1px solid rgba(96,165,250,.35);border-radius:6px;color:#60a5fa;cursor:pointer;white-space:nowrap">저장</button>
      </div>
    </div>`;
  }

  // 일반 표시 (반출 카드 또는 협력사 뷰) + 복사 버튼
  const specLines = specs.map(s => {
    let line = s.spec + (s.model ? ' (' + s.model + ')' : '') + ' ×' + s.qty;
    if (s.equipNos && s.equipNos.length) {
      line += ' <span style="font-family:monospace;font-size:11px;color:#60a5fa;font-weight:900">' + s.equipNos.join(', ') + '</span>';
    }
    return line;
  }).join('<br>');
  // 복사할 텍스트: 제원+장비번호
  const allEquipNos = specs.flatMap(s => s.equipNos || []).filter(Boolean);
  const copyText = specs.map(s => {
    let t = s.spec + (s.model?' ('+s.model+')':'') + ' ×' + s.qty;
    if (s.equipNos && s.equipNos.length) t += ' / ' + s.equipNos.join(', ');
    return t;
  }).join('\n');
  // 복사 버튼 - data 속성에 저장해서 script 인라인 회피
  const copyKey = 'spec-copy-' + r.id;
  window['_copyData_' + r.id] = copyText;
  const copyBtn = copyText
    ? '<button onclick="var t=window[\'_copyData_' + r.id + '\'];if(navigator.clipboard){navigator.clipboard.writeText(t).then(()=>toast(\'복사됨\',\'ok\')).catch(()=>{});}else{var e=document.createElement(\'textarea\');e.value=t;document.body.appendChild(e);e.select();document.execCommand(\'copy\');e.remove();toast(\'복사됨\',\'ok\');}" style="padding:3px 10px;font-size:10px;font-weight:700;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);border-radius:5px;color:#60a5fa;cursor:pointer">복사</button>'
    : '';
  return '<div style="font-size:12px;font-weight:700;margin-bottom:6px;line-height:2">' + specLines + '</div>' +
    (copyText ? '<div style="display:flex;justify-content:flex-end;margin-top:-2px;margin-bottom:6px">' + copyBtn + '</div>' : '');
}

// 전체 제원 한번에 저장
async function _saveAllSpecEquip(recordId) {
  const btnId = 'spec-save-btn-' + recordId;
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

  const recs = getTransit();
  const rec  = recs.find(r => r.id === recordId);
  if (!rec) { toast('레코드를 찾을 수 없습니다', 'err'); if(btn){btn.disabled=false;btn.innerHTML='저장';} return; }
  if (!rec.specs) { toast('제원 정보 없음', 'err'); if(btn){btn.disabled=false;btn.innerHTML='저장';} return; }

  let hasAny = false;
  rec.specs.forEach((s, idx) => {
    const inpId = 'spec-equip-' + recordId + '-' + idx;
    const inp = document.getElementById(inpId);
    if (!inp) return;
    const val = inp.value.toUpperCase().trim();
    const equipNos = val ? val.split(/[,，\s]+/).map(e=>e.trim()).filter(Boolean) : [];
    s.equipNos = equipNos;
    if (equipNos.length) hasAny = true;
  });
  // ajEquip 전체 목록 갱신
  const allNos = (rec.specs || []).flatMap(s => s.equipNos || []).filter(Boolean);
  rec.ajEquip = [...new Set(allNos)].join(', ');
  rec.synced = false;

  rec.synced = false;
  await saveTransit(recs);

  // ── 즉시 서버 연동 (다른 이용자가 바로 확인 가능) ──────────
  _directPushTransit(rec).catch(e => { console.warn('[_saveAllSpecEquip push]', e); scheduleRetrySync(); });
  // 알림: 장비번호 저장 시 AJ관리자 + 신청인
  if(rec.ajEquip){
    pushSBNotif({target_aj_type:'관리자', type:'equip_saved', title:`🏷 장비번호: ${rec.company}`, body:rec.ajEquip, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
    if(rec.submitterMemberId) pushSBNotif({target_user_id:rec.submitterMemberId, type:'equip_saved', title:`🏷 장비번호: ${rec.company}`, body:rec.ajEquip, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  }

  // ── 반입완료 상태라면 장비 마스터 즉시 등록 ─────────────────
  if (rec.type === 'in' && rec.status === '반입완료' && hasAny) {
    await registerEquipFromTransit(rec);
  }

  const toastMsg = rec.status === '반입완료' && hasAny ? '장비번호 저장 + 마스터 등록 + 서버 동기화 완료' : '장비번호 저장됨 (서버 반영 중)';
  toast(toastMsg, 'ok');
  if (btn) { btn.innerHTML = '저장완료'; btn.style.background = 'rgba(34,197,94,.15)'; btn.style.borderColor = 'rgba(34,197,94,.35)'; btn.style.color = '#4ade80'; btn.disabled = false; }
  if (window._specEditMode) window._specEditMode.delete(recordId);
  setTimeout(() => renderTransit(), 1500);
}

// 제원별 장비번호 저장 → 마스터 자동 등록 (개별, 하위호환 유지)
async function _saveSpecEquip(recordId, specIdx) {
  const inpId = 'spec-equip-' + recordId + '-' + specIdx;
  const inp = document.getElementById(inpId);
  if (!inp) return;
  const val = inp.value.toUpperCase().trim();
  const equipNos = val ? val.split(/[,，\s]+/).map(e=>e.trim()).filter(Boolean) : [];

  const recs = getTransit();
  const rec  = recs.find(r => r.id === recordId);
  if (!rec) { toast('레코드를 찾을 수 없습니다', 'err'); return; }
  if (!rec.specs || !rec.specs[specIdx]) { toast('제원을 찾을 수 없습니다', 'err'); return; }

  rec.specs[specIdx].equipNos = equipNos;
  rec.synced = false;
  const allNos = (rec.specs || []).flatMap(s => s.equipNos || []).filter(Boolean);
  rec.ajEquip = [...new Set(allNos)].join(', ');

  await saveTransit(recs);

  // 즉시 서버 연동
  _directPushTransit(rec).catch(e => { console.warn('[_saveSpecEquip push]', e); scheduleRetrySync(); });
  // 반입완료면 마스터 등록
  if (rec.type === 'in' && rec.status === '반입완료' && equipNos.length) {
    await registerEquipFromTransit(rec);
  }

  toast('저장됨 (서버 반영 중)', 'ok');
  renderTransit();
}

async function _saveInlineEquip(id) {
  const inp = document.getElementById('inline-equip-' + id);
  if (!inp) return;
  const equip = inp.value.toUpperCase().trim();
  const recs = getTransit();
  const rec  = recs.find(r => r.id === id);
  if (!rec) { toast('레코드를 찾을 수 없습니다', 'err'); return; }
  rec.ajEquip = equip;
  rec.synced  = false;
  await saveTransit(recs);
  // 편집모드 플래그 해제
  if (window._specEditMode) window._specEditMode.delete(id);
  // 즉시 서버 연동
  _directPushTransit(rec).catch(e => { console.warn('[_saveInlineEquip push]', e); scheduleRetrySync(); });
  // 반입완료 상태라면 마스터도 즉시 갱신
  if (rec.type === 'in' && rec.status === '반입완료' && equip) {
    await registerEquipFromTransit(rec);
    toast('장비번호 저장 + 마스터 등록 + 서버 동기화 완료', 'ok');
  } else {
    toast('장비번호 저장됨 (서버 반영 중)', 'ok');
  }
  renderTransit();
}

// 인라인 자동완성 초기화 (카드 렌더 후 호출)
function _initInlineEquipAC(id, siteId) {
  setTimeout(() => {
    setupEquipAutocomplete('inline-equip-' + id, {
      siteIdFn:  () => siteId || (S?.siteId === 'all' ? null : S?.siteId),
      companyFn: () => null,
      multi: true,
    });
  }, 80);
}

function saveAjEquip(id){
  const inp = document.getElementById('aj-equip-'+id);
  if(!inp) return;
  const equip = inp.value.toUpperCase().trim();
  const recs = getTransit();
  const rec = recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  rec.ajEquip = equip;
  saveTransit(recs);
  toast('장비번호 저장됨','ok');
  renderTransit();
}

// ── 완료 확인 커스텀 모달 ────────────────────────────────────
function _showCompleteConfirm(verb, company, date, equipNo){
  return new Promise(resolve=>{
    const isIn = verb==='반입완료';
    const color = isIn ? '#22c55e' : '#fb923c';
    const ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10001;display:flex;align-items:center;justify-content:center';
    ov.innerHTML=`<div style="background:var(--bg2,#1a1a2e);border:1px solid var(--br);border-radius:18px;padding:26px 20px;max-width:300px;width:88%;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.5)">
      <div style="font-size:22px;font-weight:900;color:${color};margin-bottom:8px;line-height:1.2">${verb} 완료 확인</div>
      <div style="font-size:16px;font-weight:800;color:var(--tx);margin-bottom:4px">${company}</div>
      ${equipNo?`<div style="font-size:12px;font-family:monospace;color:#60a5fa;margin-bottom:4px">${equipNo}</div>`:''}
      <div style="font-size:11px;color:var(--tx3);margin-bottom:20px">${date}</div>
      <div style="display:flex;gap:10px">
        <button id="_cc_no" style="flex:1;padding:10px;border-radius:10px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:#f87171;font-size:14px;font-weight:700;cursor:pointer">취소</button>
        <button id="_cc_yes" style="flex:1;padding:10px;border-radius:10px;background:${color}22;border:2px solid ${color}66;color:${color};font-size:14px;font-weight:900;cursor:pointer">확인</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done=(v)=>{ov.remove();resolve(v);};
    ov.querySelector('#_cc_yes').onclick=()=>done(true);
    ov.querySelector('#_cc_no').onclick=()=>done(false);
    ov.onclick=(e)=>{if(e.target===ov)done(false);};
  });
}

// ── 반입/반출 완료 처리 (장비 마스터 연동) ──────────────────
async function completeTransit(id) {
  // 더블클릭 / 중복 처리 방지
  if(window._completingTransit === id) return;
  window._completingTransit = id;
  try { await _completeTransitInner(id); } finally { window._completingTransit = null; }
}
async function _completeTransitInner(id) {
  const recs = getTransit();
  const rec  = recs.find(r => r.id === id);
  if (!rec) { toast('레코드를 찾을 수 없습니다', 'err'); return; }

  // 인수인계 완료 처리
  if (rec.type === 'handover') {
    if (!confirm('인계완료 처리하시겠습니까?\n' + (rec.fromCompany||'') + ' → ' + (rec.toCompany||'') + '\n장비: ' + (rec.handoverEquips||[]).join(', '))) return;
    rec.status = '인계완료'; rec.date = today(); rec.doneAt = Date.now(); rec.doneBy = S?.name||''; rec.synced = false;
    await saveTransit(recs);
    await _applyHandoverToEquipMaster(rec).catch(()=>{});
    toast('인계완료 처리 완료', 'ok'); renderTransit(); return;
  }

  // 반입완료 전 카드 인라인 장비번호 읽기
  if (rec.type === 'in') {
    const inlineInp = document.getElementById('inline-equip-' + id);
    if (inlineInp) {
      const val = inlineInp.value.toUpperCase().trim();
      if (val) rec.ajEquip = val;
    }
    if (!rec.ajEquip) {
      if (!confirm('장비번호가 입력되지 않았습니다.\n장비번호 없이 반입완료 처리하시겠습니까?\n(나중에 카드에서 입력 가능)')) return;
    }
  }

  const verb = rec.type === 'in' ? '반입완료' : rec.type === 'handover' ? '인계완료' : '반출완료';
  // 확인 팝업용 장비번호 수집 (반출: specs.equipNos + ajEquip, 반입: ajEquip)
  let _confirmEquip = rec.ajEquip || '';
  if (rec.type === 'out') {
    const _cnos = new Set();
    for (const sp of (rec.specs||[])) (sp.equipNos||[]).forEach(n=>_cnos.add(n));
    if (rec.ajEquip) rec.ajEquip.split(/[,\s]+/).filter(Boolean).forEach(n=>_cnos.add(n));
    if (_cnos.size) _confirmEquip = [..._cnos].join(', ');
  }
  const _ok = await _showCompleteConfirm(verb, rec.company, rec.date, _confirmEquip);
  if (!_ok) return;

  rec.status   = verb;
  rec.date     = today();
  rec.doneAt   = Date.now();
  rec.doneBy   = S?.name || '';
  rec.synced   = false;
  await saveTransit(recs);
  // 단건 즉시 서버 업서트 — 다른 이용자가 완료 상태 바로 확인 가능
  _directPushTransit(rec).catch(e => { console.warn('[completeTransit push]', e); scheduleRetrySync(); });
  // 알림: AJ관리자 + 신청인
  const _trVerbBody = `${rec.date} · ${(rec.specs||[]).map(s=>s.spec+'×'+s.qty).join(', ')}`;
  pushSBNotif({target_aj_type:'관리자', type:'transit_done', title:`📦 ${verb}: ${rec.company}`, body:_trVerbBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  if(rec.submitterMemberId) pushSBNotif({target_user_id:rec.submitterMemberId, type:'transit_done', title:`📦 ${verb}: ${rec.company}`, body:_trVerbBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});

  // 장비 마스터 업데이트
  if (rec.type === 'in') {
    const changed = await registerEquipFromTransit(rec);
    if (changed) {
      toast(`${verb} · 장비 마스터 등록 완료`, 'ok');
      _syncToSupabase().catch(e=>console.warn('[completeTransit equip sync]',e));
    } else {
      toast(verb + ' 처리 완료' + (rec.ajEquip ? '' : ' (장비번호 미입력)'), rec.ajEquip ? 'ok' : 'warn');
    }
  } else {
    // 반출 장비번호 전체 수집 (토스트 표시용)
    const outNos = new Set();
    for (const sp of (rec.specs || [])) (sp.equipNos||[]).forEach(n=>outNos.add(n));
    if (rec.equip) rec.equip.split(/[,\s]+/).filter(Boolean).forEach(n=>outNos.add(n));
    const changed = await deregisterEquipFromTransit(rec);
    if (changed) {
      toast(`${verb} · ${outNos.size}대 마스터 반출처리 완료`, 'ok');
      _syncToSupabase().catch(e=>console.warn('[completeTransit equip sync]',e));
    } else if (outNos.size === 0) toast(verb + ' 처리 완료 (장비번호 미입력)', 'warn');
    else toast(`${verb} · 마스터에서 장비를 찾을 수 없습니다 (이미 반출 또는 미등록)`, 'warn');
  }

  renderTransit();
  _fetchFromSB().catch(()=>{}).then(changed=>{ if(changed) renderTransit(); });
}


function _showMgrHistory(){
  const list = document.getElementById('mgr-history-list');
  if(!list) return;
  const hist = DB.g(K.MGR_HIST, []);
  if(!hist.length){ toast('저장된 담당자 이력이 없습니다','warn'); return; }
  if(list.style.display !== 'none'){ list.style.display='none'; return; }
  list.innerHTML = hist.map((m,i)=>`
    <div onclick="_fillMgrHistory(${i})" style="padding:6px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.15);font-size:11px;display:flex;align-items:center;gap:8px">
      <div style="flex:1"><b>${m.name}</b>${m.title?' ('+m.title+')':''}</div>
      <div style="color:var(--tx3)">${m.phone||'—'}</div>
    </div>`).join('');
  list.style.display='block';
}

function _fillMgrHistory(idx){
  const hist = DB.g(K.MGR_HIST, []);
  const m = hist[idx];
  if(!m) return;
  const el = (id,v) => { const e=document.getElementById(id); if(e) e.value=v||''; };
  el('tr-manager-name', m.name);
  el('tr-manager-title', m.title);
  el('tr-manager-phone', m.phone);
  document.getElementById('mgr-history-list').style.display='none';
  toast('담당자 정보가 입력됐습니다','ok');
}

function openTransitForm(){
  const sh=document.getElementById('sh-transit-form');
  if(!sh) return;
  _resetTransitForm();
  const titleEl = document.getElementById('transit-form-title');
  const siteName = S?.siteId==='all' ? '' : (S?.siteName||'');
  if(titleEl) titleEl.textContent = siteName ? `반입/반출 신청 — ${siteName}` : '반입/반출 신청';
  // AJ '전체 현장' 선택 시 사이트 선택 드롭다운 노출
  const siteRow = document.getElementById('tr-site-row');
  if(siteRow){
    siteRow.style.display = S?.siteId==='all' ? '' : 'none';
    if(S?.siteId==='all'){
      const sel = document.getElementById('tr-site-sel');
      if(sel){
        const sites = getSites();
        sel.innerHTML = sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
      }
    }
  }
  openSheet('sh-transit-form');
  // 프로젝트 칩 초기 렌더링 (반입 선택 후 자동 갱신됨)
  _updateProjectChips();
  // 자동완성은 반출 선택 시 _updateSpecModelVisibility에서 설정됨
}

function _resetTransitForm(){
  document.getElementById('tr-date').value=today();
  document.querySelectorAll('#tr-type-chips .chip.on').forEach(c=>c.classList.remove('on'));
  document.getElementById('tr-company').value=S?.company||'';
  document.getElementById('tr-specs-list').innerHTML='';
  document.getElementById('tr-note').value='';
  const trn = document.getElementById('tr-reporter-name');
  if(trn){ trn.value = S?.name||''; trn.readOnly = true; trn.style.opacity='.7'; }
  const trp = document.getElementById('tr-reporter-phone');
  if(trp){ trp.value = S?.phone || DB.g('last_reporter_phone','') || ''; trp.readOnly = true; trp.style.opacity='.7'; }
  const tmn = document.getElementById('tr-manager-name');
  if(tmn) tmn.value = '';
  const tmt = document.getElementById('tr-manager-title');
  if(tmt) tmt.value = '';
  const tmp = document.getElementById('tr-manager-phone');
  if(tmp) tmp.value = '';
  const teq = document.getElementById('tr-equip');
  if(teq) teq.value = '';
  const tml = document.getElementById('tr-manager-location');
  if(tml) tml.value = '';
  const mhl = document.getElementById('mgr-history-list');
  if(mhl) mhl.style.display='none';
  const ter = document.getElementById('tr-equip-row');
  if(ter) ter.style.display = 'none';
  // 프로젝트 칩 선택 초기화
  document.querySelectorAll('#tr-project-chips .chip.on').forEach(c=>c.classList.remove('on'));
  // 인수인계 필드 초기화
  const fco=document.getElementById('tr-from-co'); if(fco) fco.value='';
  const tco=document.getElementById('tr-to-co');   if(tco) tco.value='';
  const hem=document.getElementById('tr-handover-equip-manual'); if(hem) hem.value='';
  const hec=document.getElementById('tr-handover-equip-chips');
  if(hec) hec.innerHTML='<span id="tr-handover-equip-placeholder" style="font-size:10px;color:var(--tx3)">인계업체 입력 후 장비 선택</span>';
  // 프로젝트 변경: 아니오 기본 선택
  document.querySelectorAll('#tr-proj-change-chips .chip.on').forEach(c=>c.classList.remove('on'));
  const noBtn=document.querySelector('#tr-proj-change-chips .chip:last-child'); if(noBtn) noBtn.classList.add('on');
  const pcd=document.getElementById('tr-proj-change-detail'); if(pcd) pcd.style.display='none';
  document.querySelectorAll('#tr-from-proj-chips .chip.on,#tr-to-proj-chips .chip.on').forEach(c=>c.classList.remove('on'));
  document.querySelectorAll('#tr-handover-location-chips .chip.on').forEach(c=>c.classList.remove('on'));
  const hrc=document.getElementById('tr-handover-recorder'); if(hrc) hrc.value=S?.name||'';
  const hp=document.getElementById('tr-handover-phone'); if(hp) hp.value=S?.phone||'';
  const hn=document.getElementById('tr-handover-note'); if(hn) hn.value='';
  // 섹션: 기본 반입/반출 표시
  const bs=document.getElementById('tr-basic-section');    if(bs) bs.style.display='';
  const hs=document.getElementById('tr-handover-section'); if(hs) hs.style.display='none';
  const pi=document.getElementById('tr-proj-change-inline'); if(pi) pi.style.display='none';
  // 사용계획서 초기화
  _clearTrPlan();
  const planSec2 = document.getElementById('tr-plan-section');
  if(planSec2) planSec2.style.display = 'none';
  _trAddSpecRow(); // 기본 1행
}

function _updateProjectChips(){
  const siteId = S?.siteId==='all'
    ? (document.getElementById('tr-site-sel')?.value || getSites()[0]?.id || '')
    : S?.siteId;
  const site = getSites().find(s=>s.id===siteId);
  const projects = site?.projects||[];
  const row = document.getElementById('tr-project-row');
  const chipsEl = document.getElementById('tr-project-chips');
  const isIn = document.querySelector('#tr-type-chips .chip.on')?.textContent==='반입';
  if(row) row.style.display = (projects.length && isIn) ? '' : 'none';
  if(chipsEl){
    chipsEl.innerHTML = projects.map(p=>
      `<div class="chip" onclick="selectOne(this,'tr-project-chips')">${p}</div>`
    ).join('');
  }
}
function _updateSpecModelVisibility(){
  const type = document.querySelector('#tr-type-chips .chip.on')?.textContent;
  const isHandover = type === '인수인계';

  // 인수인계 ↔ 반입/반출 섹션 전환
  const basicSec    = document.getElementById('tr-basic-section');
  const handoverSec = document.getElementById('tr-handover-section');
  const companyFg   = document.getElementById('tr-company-fg');
  if (basicSec)    basicSec.style.display    = isHandover ? 'none' : '';
  if (handoverSec) handoverSec.style.display = isHandover ? '' : 'none';
  if (companyFg)   companyFg.style.display   = isHandover ? 'none' : '';
  const projInline = document.getElementById('tr-proj-change-inline');
  if (projInline) projInline.style.display = isHandover ? 'flex' : 'none';

  if (isHandover) {
    // 반입 전용 프로젝트 칩 숨기기
    const pr = document.getElementById('tr-project-row');
    if (pr) pr.style.display = 'none';
    _populateHandoverCompanies();
    _updateHandoverProjChips();
    return;
  }

  // 반입/반출 기존 로직
  const isOut = type === '반출';
  const list = document.getElementById('tr-specs-list');
  if (list && list.children.length) {
    const existing = [...list.children].map(row => ({
      spec:      row.querySelector('.tr-spec')?.value || '',
      qty:       +row.querySelector('.tr-qty')?.value || 1,
      equipNos:  row.querySelector('.tr-spec-equip')?.value || '',
    }));
    list.innerHTML = '';
    existing.forEach(r => _trAddSpecRow(r.spec, '', r.qty, r.equipNos));
  }
  // 사용계획서 섹션: 반입만 표시
  const planSec = document.getElementById('tr-plan-section');
  if(planSec) planSec.style.display = (type === '반입') ? '' : 'none';
  _updateProjectChips();
}

// ── 인수인계 헬퍼 ────────────────────────────────────────────
function _populateHandoverCompanies(){
  // transit 기록 + 장비마스터에서 유니크 업체명 수집
  const companies = new Set();
  getTransit().forEach(r => {
    if (r.company)     companies.add(r.company);
    if (r.fromCompany) companies.add(r.fromCompany);
    if (r.toCompany)   companies.add(r.toCompany);
  });
  getEquipMaster().forEach(e => { if (e.company) companies.add(e.company); });
  const dl = document.getElementById('handover-company-datalist');
  if (!dl) return;
  dl.innerHTML = [...companies].sort((a,b)=>a.localeCompare(b,'ko'))
    .map(c=>`<option value="${c}">`).join('');
}

function _updateHandoverEquipList(){
  const fromCo = document.getElementById('tr-from-co')?.value.trim();
  const chipsEl = document.getElementById('tr-handover-equip-chips');
  if (!chipsEl) return;
  if (!fromCo) {
    chipsEl.innerHTML = '<span style="font-size:10px;color:var(--tx3)">인계업체 입력 후 장비 선택</span>';
    return;
  }
  const siteId = S?.siteId==='all'
    ? (document.getElementById('tr-site-sel')?.value || null)
    : S?.siteId;
  let equips = getEquipByCompany(siteId, fromCo);
  // 프로젝트 필터: 프로젝트 변경 섹션에서 인계前 프로젝트가 선택된 경우 필터
  const fromProj = document.querySelector('#tr-from-proj-chips .chip.on')?.textContent.trim() || null;
  if (fromProj) equips = equips.filter(e => !e.project || e.project === fromProj);
  if (!equips.length) {
    chipsEl.innerHTML = '<span style="font-size:10px;color:var(--tx3)">등록된 장비 없음 — 직접 입력</span>';
    return;
  }
  chipsEl.innerHTML = equips.map(e =>
    `<div class="chip" style="font-family:monospace;font-size:11px;font-weight:700" onclick="this.classList.toggle('on')">${e.equipNo}${e.project?`<span style="font-size:9px;color:var(--tx3);margin-left:3px">[${e.project}]</span>`:''}</div>`
  ).join('');
}

function _updateHandoverProjSection(){
  const isYes = document.querySelector('#tr-proj-change-chips .chip.on')?.textContent === '예';
  const detail = document.getElementById('tr-proj-change-detail');
  if (detail) detail.style.display = isYes ? '' : 'none';
  if (isYes) _updateHandoverProjChips();
}

function _updateHandoverProjChips(){
  const siteId = S?.siteId==='all'
    ? (document.getElementById('tr-site-sel')?.value || getSites()[0]?.id || '')
    : S?.siteId;
  const projects = getSites().find(s=>s.id===siteId)?.projects || [];
  const fromEl = document.getElementById('tr-from-proj-chips');
  const toEl   = document.getElementById('tr-to-proj-chips');
  const placeholder = '<span style="font-size:10px;color:var(--tx3)">설정된 프로젝트 없음</span>';
  if (fromEl) fromEl.innerHTML = projects.length
    ? projects.map(p=>`<div class="chip" onclick="selectOne(this,'tr-from-proj-chips');_updateHandoverEquipList()">${p}</div>`).join('')
    : placeholder;
  if (toEl)   toEl.innerHTML   = projects.length
    ? projects.map(p=>`<div class="chip" onclick="selectOne(this,'tr-to-proj-chips')">${p}</div>`).join('')
    : placeholder;
}

async function _submitHandover(date) {
  const siteId = S.siteId==='all'
    ? (document.getElementById('tr-site-sel')?.value || getSites()[0]?.id || '')
    : S.siteId;
  const fromCo = document.getElementById('tr-from-co')?.value.trim();
  const toCo   = document.getElementById('tr-to-co')?.value.trim();
  if (!fromCo) { toast('인계업체를 입력하세요','err'); return; }
  if (!toCo)   { toast('인수업체를 입력하세요','err'); return; }

  // 장비번호 수집 (chip 선택 + 직접 입력)
  const selectedNos = [...document.querySelectorAll('#tr-handover-equip-chips .chip.on')].map(c=>c.textContent.trim());
  const manualRaw   = document.getElementById('tr-handover-equip-manual')?.value.toUpperCase().trim() || '';
  const manualNos   = manualRaw ? manualRaw.split(/[,，\s]+/).map(e=>e.trim()).filter(Boolean) : [];
  const handoverEquips = [...new Set([...selectedNos, ...manualNos])];
  if (!handoverEquips.length) { toast('이동 장비번호를 선택하거나 입력하세요','err'); return; }

  const projChange  = document.querySelector('#tr-proj-change-chips .chip.on')?.textContent === '예';
  const fromProject = projChange ? (document.querySelector('#tr-from-proj-chips .chip.on')?.textContent || '') : '';
  const toProject   = projChange ? (document.querySelector('#tr-to-proj-chips .chip.on')?.textContent  || '') : '';
  const location    = document.querySelector('#tr-handover-location-chips .chip.on')?.textContent || '';
  const note        = document.getElementById('tr-handover-note')?.value.trim() || '';
  const recorder    = document.getElementById('tr-handover-recorder')?.value.trim() || S?.name || '';
  const phoneRaw    = document.getElementById('tr-handover-phone')?.value || '';
  const reporterPhone = fmtPhone(phoneRaw);

  const rec = {
    id: 'tr-' + Date.now().toString(36),
    type: 'handover', siteId,
    siteName: getSites().find(s=>s.id===siteId)?.name || siteId,
    date, company: fromCo, fromCompany: fromCo, toCompany: toCo,
    handoverEquips, projChange, fromProject, toProject, location,
    note, recorder, reporterPhone,
    specs: [], ajEquip: '', ts: Date.now(), synced: false, status: '예정',
  };

  // 로컬 우선 저장
  const records = getTransit();
  records.unshift(rec);
  saveTransit(records);
  _applyHandoverToEquipMaster(rec).catch(()=>{});

  // 서버 우선 저장 (spinner + try/catch)
  spinner(true, '인수인계 등록 중...');
  try {
    await _directPushTransit(rec);
    toast('인수인계 등록 완료 ✓', 'ok');
  } catch(e) {
    console.warn('[submitHandover]', e.message);
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false);
  }
  closeSheet('sh-transit-form');
  renderTransit();
}

async function _applyHandoverToEquipMaster(rec) {
  if (rec.type !== 'handover' || !rec.handoverEquips?.length) return;
  const arr = getEquipMaster();
  let changed = false;
  for (const eNo of rec.handoverEquips) {
    const e = arr.find(x => x.equipNo === eNo && x.siteId === rec.siteId);
    if (e) {
      e.company = rec.toCompany;
      if (rec.projChange && rec.toProject) e.project = rec.toProject;
      changed = true;
    }
  }
  if (changed) await saveEquipMaster(arr);
}
// ────────────────────────────────────────────────────────────

function _trAddSpecRow(spec='', model='', qty=1, equipNos=''){
  const list=document.getElementById('tr-specs-list');
  if(!list) return;
  const isOut = document.querySelector('#tr-type-chips .chip.on')?.textContent==='반출';
  const div=document.createElement('div');
  div.className='tr-spec-row';
  div.style.cssText='margin-bottom:8px;background:rgba(59,130,246,.04);border:1px solid var(--br);border-radius:8px;padding:7px 8px';
  const equipId = 'tr-spec-equip-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,4);
  div.innerHTML=`
  <div style="display:flex;gap:6px;align-items:center;margin-bottom:${isOut?'5px':'0'}">
    <select class="fg-select tr-spec" style="flex:1;font-size:12px;padding:6px 8px">
      ${TR_SPECS.map(s=>`<option${s===spec?' selected':''}>${s}</option>`).join('')}
    </select>
    <input type="number" class="fg-input tr-qty" value="${qty}" min="1" style="flex:1;padding:6px 8px;font-size:12px;text-align:center" placeholder="수량">
    <button onclick="var l=document.getElementById('tr-specs-list');if(l&&l.querySelectorAll('.tr-spec-row').length>1)this.closest('.tr-spec-row').remove();" style="background:none;border:none;color:#f87171;font-size:18px;cursor:pointer;flex-shrink:0;line-height:1">x</button>
  </div>
  ${isOut?`<div style="display:flex;align-items:center;gap:5px;position:relative">
    <span style="font-size:10px;color:var(--tx3);white-space:nowrap;flex-shrink:0">반출 장비번호</span>
    <input type="text" class="fg-input tr-spec-equip" id="${equipId}"
      value="${equipNos}" placeholder="장비번호 입력 또는 선택 (자동완성)"
      style="flex:1;padding:5px 9px;font-size:12px;font-family:monospace;text-transform:uppercase;background:var(--bg2)"
      autocomplete="off" oninput="this.value=this.value.toUpperCase()">
  </div>`:'<input type="hidden" class="tr-spec-equip" id="'+equipId+'" value="">'}`;
  list.appendChild(div);
  // 자동완성: 반출 시에만 마스터에서 선택 가능
  if (isOut) {
    setTimeout(() => {
      setupEquipAutocomplete(equipId, {
        siteIdFn:  () => { const sel = document.getElementById('tr-site-sel'); return sel?.value || (S?.siteId === 'all' ? null : S?.siteId); },
        companyFn: () => document.getElementById('tr-company')?.value.trim() || null,
        projectFn: () => document.querySelector('#tr-project-chips .chip.on')?.textContent.trim() || null,
        specFn:    () => document.getElementById(equipId)?.closest('.tr-spec-row')?.querySelector('.tr-spec')?.value || null,
        multi: true,
      });
    }, 60);
  }
}

function editTransitDate(id){
  const recs=getTransit();
  const rec=recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  const specs = rec.specs||[];
  let sh = document.getElementById('sh-edit-date');
  if(!sh){
    sh = document.createElement('div');
    sh.className='soverlay'; sh.id='sh-edit-date';
    sh.onclick=function(e){ if(e.target===sh) closeSheet('sh-edit-date'); };
    document.body.appendChild(sh);
  }
  const specRows = specs.map((s,i)=>`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="flex:1;font-size:12px;font-weight:700">${s.spec} (전체 ${s.qty}대)</span>
      <input type="number" id="split-qty-${i}" min="0" max="${s.qty}" placeholder="0" style="width:60px;background:var(--bg3);border:1px solid var(--br);border-radius:6px;color:var(--tx);padding:4px 8px;font-size:12px;text-align:center">
      <span style="font-size:11px;color:var(--tx3)">대 이동</span>
    </div>`).join('');
  sh.innerHTML=`<div class="sheet">
    <div class="sh-handle"></div>
    <div class="sh-title">날짜 변경</div>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer">
        <input type="radio" name="split-mode" value="all" checked onchange="_onSplitModeChange()"> 전부
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer">
        <input type="radio" name="split-mode" value="partial" onchange="_onSplitModeChange()"> 일부
      </label>
    </div>
    <div class="fg">
      <label class="fg-lbl">새 날짜 <span class="req">*</span></label>
      <input type="date" class="fg-input" id="edit-date-input">
    </div>
    <div id="split-detail" style="display:none;border-top:1px solid var(--br);padding-top:10px;margin-top:4px">
      <div style="font-size:12px;font-weight:700;color:var(--tx2);margin-bottom:8px">이동할 수량</div>
      ${specRows||'<div style="font-size:11px;color:var(--tx3)">제원 정보 없음</div>'}
      <div class="fg" style="margin-top:8px">
        <label class="fg-lbl">이동할 장비번호 (쉼표 구분)</label>
        <input type="text" class="fg-input" id="split-equip" placeholder="예: GA123, GB456" style="text-transform:uppercase">
      </div>
    </div>
    <div class="btn-gap" style="margin-top:10px">
      <button class="btn-full teal" id="edit-date-save">변경 저장</button>
      <button class="btn-ghost" onclick="closeSheet('sh-edit-date')">닫기</button>
    </div>
  </div>`;
  document.getElementById('edit-date-input').value = rec.date||today();
  window._onSplitModeChange = function(){
    const isP = document.querySelector('input[name="split-mode"]:checked')?.value==='partial';
    document.getElementById('split-detail').style.display = isP?'block':'none';
  };
  document.getElementById('edit-date-save').onclick = function(){
    const nd = document.getElementById('edit-date-input').value;
    if(!nd){ toast('날짜를 선택하세요','err'); return; }
    const isPartial = document.querySelector('input[name="split-mode"]:checked')?.value==='partial';
    const recs2=getTransit();
    const rec2=recs2.find(r=>r.id===id);
    if(!rec2){ toast('레코드를 찾을 수 없습니다','err'); return; }
    if(!isPartial){
      rec2.date=nd; rec2.synced=false; saveTransit(recs2);
      closeSheet('sh-edit-date'); toast('날짜가 변경되었습니다','ok'); renderTransit(); return;
    }
    // 일부 분리
    const specs2 = rec2.specs||[];
    const movedSpecs = specs2.map((s,i)=>{
      const qtyEl = document.getElementById('split-qty-'+i);
      const mv = Math.min(+qtyEl?.value||0, s.qty);
      const movedEquipNos = (s.equipNos||[]).slice(0,mv);
      return mv>0 ? {...s, qty:mv, equipNos:movedEquipNos} : null;
    }).filter(Boolean);
    if(!movedSpecs.length){ toast('이동할 수량을 입력하세요','err'); return; }
    const splitEquipStr = document.getElementById('split-equip')?.value||'';
    const splitEquipNos = splitEquipStr.split(/[,\s]+/).filter(Boolean).map(x=>x.toUpperCase());
    // 원본 수정 — 이동된 equipNos(앞 mv개) 제거
    rec2.specs = specs2.map((s,i)=>{
      const qtyEl = document.getElementById('split-qty-'+i);
      const mv = Math.min(+qtyEl?.value||0, s.qty);
      if(mv>=s.qty) return null;
      return {...s, qty:s.qty-mv, equipNos:(s.equipNos||[]).slice(mv)};
    }).filter(Boolean);
    // ajEquip에서도 이동된 장비번호 제거 (spec equipNos + 직접 입력 splitEquipNos 모두)
    const movedEquipSet = new Set([
      ...movedSpecs.flatMap(s=>s.equipNos||[]).map(n=>n.toUpperCase()),
      ...splitEquipNos,
    ]);
    if(movedEquipSet.size && rec2.ajEquip){
      const origNos = rec2.ajEquip.split(/[,，\s]+/).map(s=>s.trim()).filter(Boolean);
      rec2.ajEquip = origNos.filter(n=>!movedEquipSet.has(n.toUpperCase())).join(', ');
    }
    rec2.synced=false;
    // 신규 카드 생성
    const newRec = {...rec2,
      id:'tr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),
      date:nd, specs:movedSpecs,
      ajEquip: splitEquipNos.length ? splitEquipNos.join(', ') : [...new Set(movedSpecs.flatMap(s=>s.equipNos||[]))].join(', '),
      status:'예정', doneAt:null, doneBy:null, synced:false, createdAt:Date.now()
    };
    recs2.push(newRec);
    saveTransit(recs2);
    closeSheet('sh-edit-date');
    toast(`일부 분리 완료 — 새 카드 생성됨 (${movedSpecs.reduce((a,s)=>a+s.qty,0)}대)`,'ok');
    renderTransit();
  };
  openSheet('sh-edit-date');
}
async function cancelTransit(id){
  if(!confirm('이 신청을 취소하시겠습니까?')) return;
  const recs=getTransit();
  const rec=recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  rec.status='취소'; rec.synced=false;
  await saveTransit(recs);
  _directPushTransit(rec).catch(e => { console.warn('[cancelTransit push]', e); scheduleRetrySync(); });
  // 알림: AJ관리자 + 신청인
  const _cnBody = `${rec.date} · ${rec.type==='in'?'반입':'반출'}`;
  pushSBNotif({target_aj_type:'관리자', type:'transit_cancel', title:`❌ 취소: ${rec.company}`, body:_cnBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  if(rec.submitterMemberId) pushSBNotif({target_user_id:rec.submitterMemberId, type:'transit_cancel', title:`❌ 취소: ${rec.company}`, body:_cnBody, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  toast('취소 처리되었습니다','warn');
  renderTransit();
  _fetchFromSB().catch(()=>{}).then(()=>renderTransit());
}

function editTransitMsg(id){
  const recs=getTransit();
  const rec=recs.find(r=>r.id===id);
  if(!rec){ toast('레코드를 찾을 수 없습니다','err'); return; }
  // 기존 msgs 배열 (구버전 호환)
  const msgs = rec.ajMsgs && rec.ajMsgs.length ? rec.ajMsgs : (rec.ajMsg ? [{text:rec.ajMsg, author:S?.name||'AJ', ts:Date.now()}] : []);
  if(msgs.length >= 3){ toast('메시지는 최대 3개까지 추가 가능합니다','warn'); return; }

  let sh = document.getElementById('sh-edit-msg');
  if(!sh){
    sh = document.createElement('div');
    sh.className='soverlay'; sh.id='sh-edit-msg';
    sh.onclick=function(e){ if(e.target===sh) closeSheet('sh-edit-msg'); };
    document.body.appendChild(sh);
  }
  // 기존 메시지 목록 HTML
  const existHtml = msgs.map((m,i)=>`
    <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;padding:6px 8px;background:rgba(245,158,11,.06);border-radius:6px;border-left:2px solid var(--orange)">
      <div style="flex:1;font-size:11px"><b style="color:var(--orange);margin-right:4px">${m.author||'AJ'}</b>${m.text}</div>
      <button onclick="deleteTransitMsg('${id}',${i})" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:13px;padding:0 2px;flex-shrink:0">×</button>
    </div>`).join('');

  sh.innerHTML=`<div class="sheet" style="max-height:85vh;overflow-y:auto">
    <div class="sh-handle"></div>
    <div class="sh-title">AJ 메시지 (${msgs.length}/3)</div>
    ${msgs.length ? '<div style="margin-bottom:10px">'+existHtml+'</div>' : ''}
    <div class="fg">
      <label class="fg-lbl">새 메시지 입력</label>
      <textarea class="fg-input" id="edit-msg-input" rows="3" placeholder="반입 확인, 현장 안내 등..." style="resize:none"></textarea>
    </div>
    <div class="btn-gap">
      <button class="btn-full teal" id="edit-msg-save">추가 저장</button>
      <button class="btn-ghost" onclick="closeSheet('sh-edit-msg')">닫기</button>
    </div>
  </div>`;
  document.getElementById('edit-msg-save').onclick = function(){
    const nd = document.getElementById('edit-msg-input').value.trim();
    if(!nd){ toast('메시지를 입력하세요','err'); return; }
    const recs2=getTransit();
    const rec2=recs2.find(r=>r.id===id);
    if(rec2){
      const curMsgs = rec2.ajMsgs && rec2.ajMsgs.length ? rec2.ajMsgs : (rec2.ajMsg ? [{text:rec2.ajMsg, author:S?.name||'AJ', ts:Date.now()}] : []);
      if(curMsgs.length >= 3){ toast('최대 3개까지 가능합니다','warn'); return; }
      curMsgs.push({text:nd, author:S?.name||'AJ', ts:Date.now()});
      rec2.ajMsgs = curMsgs;
      rec2.ajMsg = curMsgs[0]?.text || ''; // 구버전 호환
      saveTransit(recs2);
    }
    closeSheet('sh-edit-msg');
    toast('메시지가 추가되었습니다','ok'); renderTransit();
  };
  openSheet('sh-edit-msg');
}

function deleteTransitMsg(id, idx){
  const recs=getTransit();
  const rec=recs.find(r=>r.id===id);
  if(!rec) return;
  const msgs = rec.ajMsgs && rec.ajMsgs.length ? [...rec.ajMsgs] : (rec.ajMsg ? [{text:rec.ajMsg, author:'AJ', ts:0}] : []);
  msgs.splice(idx, 1);
  rec.ajMsgs = msgs;
  rec.ajMsg = msgs[0]?.text || '';
  saveTransit(recs);
  toast('메시지 삭제됨','ok');
  renderTransit();
  // 시트 갱신
  closeSheet('sh-edit-msg');
  if(msgs.length < 3) editTransitMsg(id);
}

async function submitTransit(){
  if(!S) return;
  const date = document.getElementById('tr-date').value || today();
  const typeChip = document.querySelector('#tr-type-chips .chip.on');
  if(!typeChip){ toast('구분을 선택하세요','err'); return; }
  // 인수인계 분기
  if(typeChip.textContent === '인수인계') return _submitHandover(date);

  const company  = document.getElementById('tr-company').value.trim();
  const note     = document.getElementById('tr-note')?.value.trim() || '';
  if(!company){  toast('업체명을 입력하세요','err'); return; }
  const typeVal = typeChip.textContent === '반입' ? 'in' : 'out';

  // 반출: tr-equip 필드 (하위 호환) — 실제 장비번호는 제원별 tr-spec-equip에서 수집
  const equipVal = document.getElementById('tr-equip')?.value.toUpperCase().trim() || '';

  // 제원 수집
  const specRows = document.querySelectorAll('#tr-specs-list > div');
  const specs = [];
  specRows.forEach(row => {
    const spec     = row.querySelector('.tr-spec')?.value  || '';
    const _qtyRaw  = (row.querySelector('.tr-qty')?.value||'1').toString().replace(/^x/i,'').trim();
    const qty      = parseInt(_qtyRaw)||1;
    const equipRaw = row.querySelector('.tr-spec-equip')?.value.toUpperCase().trim() || '';
    const equipNos = equipRaw ? equipRaw.split(/[,，\s]+/).map(e=>e.trim()).filter(Boolean) : [];
    if(spec) specs.push({spec, qty, equipNos});
  });
  if(!specs.length){ toast('제원을 1개 이상 입력하세요','err'); return; }

  // 반출 시 장비번호 필수 (hidden 타입 제외)
  if (typeVal === 'out') {
    const specRowsCheck = document.querySelectorAll('#tr-specs-list > div');
    let missingEquip = false;
    let firstMissingInp = null;
    specRowsCheck.forEach(row => {
      const inp = row.querySelector('input.tr-spec-equip[type="text"]');
      if (inp && !inp.value.trim()) {
        missingEquip = true;
        if (!firstMissingInp) firstMissingInp = inp;
      }
    });
    if (missingEquip) {
      toast('반출 시 모든 제원에 장비번호를 입력하세요','err');
      if (firstMissingInp) { firstMissingInp.focus(); firstMissingInp.style.borderColor='#f87171'; setTimeout(()=>firstMissingInp.style.borderColor='',1500); }
      return;
    }
  }

  // 신청인 정보는 회원 정보 자동 사용
  const reporterName  = S?.name  || '';
  const reporterPhone = fmtPhone(S?.phone || '');
  const managerName   = document.getElementById('tr-manager-name')?.value.trim()   || '';
  const managerTitle  = document.getElementById('tr-manager-title')?.value.trim()  || '';
  const managerPhone_raw = document.getElementById('tr-manager-phone')?.value || '';
  const managerPhone = fmtPhone(managerPhone_raw);
  if(managerPhone_raw && !validPhone(managerPhone)){
    toast('양중담당 연락처는 10~11자리 숫자로 입력하세요','err');
    document.getElementById('tr-manager-phone').classList.add('shake');
    setTimeout(()=>document.getElementById('tr-manager-phone').classList.remove('shake'),500);
    return;
  }
  const managerLocation = document.getElementById('tr-manager-location')?.value.trim() || '';
  if((typeVal==='in'||typeVal==='out') && !managerLocation){
    toast('양중 위치를 입력하세요','err');
    const mlEl = document.getElementById('tr-manager-location');
    mlEl?.classList.add('shake');
    mlEl?.focus();
    setTimeout(()=>mlEl?.classList.remove('shake'),500);
    return;
  }

  const siteId = S.siteId === 'all'
    ? (document.getElementById('tr-site-sel')?.value || getSites()[0]?.id || '')
    : S.siteId;
  const project = document.querySelector('#tr-project-chips .chip.on')?.textContent || '';
  const trSiteProjects = getSites().find(s=>s.id===siteId)?.projects||[];
  if(typeVal === 'in' && trSiteProjects.length && !project){
    toast('프로젝트를 선택하세요','err');
    document.getElementById('tr-project-row')?.scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  const rec = {
    id: 'tr-' + Date.now().toString(36),
    type: typeVal,
    siteId,
    siteName: getSites().find(s=>s.id===siteId)?.name || siteId,
    date, company, specs, note,
    equip: typeVal === 'out' ? equipVal : '',
    project,
    recorder: reporterName,
    reporterPhone,
    managerName, managerTitle, managerPhone, managerLocation,
    ajEquip: '',
    planData:  typeVal === 'in' && _pendingTrPlan ? _pendingTrPlan.data  : '',
    planType:  typeVal === 'in' && _pendingTrPlan ? _pendingTrPlan.type  : '',
    planName:  typeVal === 'in' && _pendingTrPlan ? _pendingTrPlan.name  : '',
    submitterMemberId: S?.memberId || '',
    ts: Date.now(), synced: false, status: '예정',
  };

  const records = getTransit();
  records.unshift(rec);
  saveTransit(records);

  // 반입 신청 시 장비번호가 있으면 마스터에 미리 등록 (예정 상태로)
  if (typeVal === 'in' && equipVal) {
    registerEquipFromTransit(rec).catch(() => {});
  }

  // 양중담당자 이력 저장 (이름+연락처 조합으로 중복 제거)
  if(managerName || managerPhone){
    const mgrHist = DB.g(K.MGR_HIST, []);
    const mgrKey = (managerName+'|'+managerPhone).toLowerCase();
    if(!mgrHist.some(m=>(m.name+'|'+m.phone).toLowerCase()===mgrKey)){
      mgrHist.unshift({name:managerName, title:managerTitle, phone:managerPhone});
      DB.s(K.MGR_HIST, mgrHist.slice(0,20)); // 최대 20개 보관
    }
  }

  addNotif({icon:'📦', title:`반입/반출 신청: ${company}`, desc:`${typeChip.textContent} · ${date}`});
  pushSBNotif({target_aj_type:'관리자', type:'transit_new', title:`📦 ${typeChip.textContent} 신청: ${company}`, body:`${date} · ${specs.map(s=>s.spec+'×'+s.qty).join(', ')}`, ref_id:rec.id, site_id:rec.siteId}).catch(()=>{});
  spinner(true, `${typeChip.textContent} 신청 등록 중...`);
  try {
    await _directPushTransit(rec);
    toast(typeChip.textContent + ' 신청이 등록되었습니다 ✓', 'ok');
  } catch(e) {
    console.warn('[submitTransit push]', e);
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false);
  }
  if(typeVal === 'in') _clearTrPlan();
  closeSheet('sh-transit-form');
  renderTransit();
}
function openASSheet(){
  const siteDisp = document.getElementById('as-site-disp');
  if(siteDisp){
    const siteName = S?.siteId==='all' ? '전체 현장' : (S?.siteName || '—');
    siteDisp.textContent = `[AS신청] AJ네트웍스 ${siteName}`;
  }
  const el = (id, val) => { const e=document.getElementById(id); if(e) e.value=val; };
  el('as-equip', '');
  el('as-desc',  '');
  el('as-location', '');
  el('as-location-detail', '');
  el('as-company',  S?.company || '');
  el('as-reporter-name',  S?.name  || '');
  el('as-reporter-phone', S?.phone || '');
  el('as-worker-name',    '');
  el('as-worker-phone',   '');
  document.querySelectorAll('#as-type-chips .chip.on').forEach(c=>c.classList.remove('on'));
  _clearAsPhoto(); // 사진 초기화
  openSheet('sh-as');
  // AS 장비번호 자동완성 (반입된 장비 목록)
  setTimeout(() => {
    setupEquipAutocomplete('as-equip', {
      siteIdFn:  () => S?.siteId === 'all' ? null : S?.siteId,
      companyFn: () => document.getElementById('as-company')?.value.trim() || null,
      multi: true,
    });
  }, 100);
}
async function submitAS(){
  if(!S) return;
  if(!navigator.onLine) toast('오프라인 상태입니다. 로컬에만 저장되며 온라인 복귀 시 자동 동기화됩니다','warn',4000);
  const equipRaw  = document.getElementById('as-equip').value.trim();
  const equipList = equipRaw.split(/[,，]+/).map(e=>e.trim().toUpperCase()).filter(Boolean);
  const equip     = equipList.join(', ');
  const company  = document.getElementById('as-company')?.value.trim() || S.company;
  const locationSel    = document.getElementById('as-location')?.value || '';
  const locationDetail = document.getElementById('as-location-detail')?.value.trim() || '';
  const location = locationDetail ? `${locationSel} ${locationDetail}`.trim() : locationSel;
  const typeChipEl = document.querySelector('#as-type-chips .chip.on');
  if(!typeChipEl){
    toast('증상 유형을 선택하세요','err');
    document.getElementById('as-type-chips')?.classList.add('shake');
    setTimeout(()=>document.getElementById('as-type-chips')?.classList.remove('shake'),500);
    return;
  }
  const type     = typeChipEl.textContent;
  const desc     = document.getElementById('as-desc').value.trim();
  const repName  = document.getElementById('as-reporter-name')?.value.trim() || '';
  if(!repName){
    toast('신청인 이름을 입력하세요','err');
    document.getElementById('as-reporter-name')?.classList.add('shake');
    setTimeout(()=>document.getElementById('as-reporter-name')?.classList.remove('shake'),500);
    return;
  }
  const repPhone_raw = document.getElementById('as-reporter-phone')?.value || '';
  const repPhone = fmtPhone(repPhone_raw);
  const workerName  = document.getElementById('as-worker-name')?.value.trim() || '';
  const workerPhone_raw = document.getElementById('as-worker-phone')?.value || '';
  const workerPhone = workerPhone_raw ? fmtPhone(workerPhone_raw) : '';
  if(!repPhone_raw){
    toast('신청인 연락처를 입력하세요','err');
    document.getElementById('as-reporter-phone')?.classList.add('shake');
    setTimeout(()=>document.getElementById('as-reporter-phone')?.classList.remove('shake'),500);
    return;
  }
  if(repPhone_raw && !validPhone(repPhone)){
    toast('연락처는 10~11자리 숫자로 입력하세요','err');
    document.getElementById('as-reporter-phone').classList.add('shake');
    setTimeout(()=>document.getElementById('as-reporter-phone').classList.remove('shake'),500);
    return;
  }
  if(!equip){ toast('장비번호를 입력하세요','err'); return; }
  // 장비마스터 유효성 검사 — 역할 무관, 보유 장비 아니면 확인 팝업
  const _asSiteId = S.siteId==='all' ? null : S.siteId;
  if(_asSiteId){
    const _asKnownNos = getEquipBySite(_asSiteId).map(e=>e.equipNo);
    if(_asKnownNos.length){
      const _asInvalid = equipList.filter(no=>!_asKnownNos.includes(no));
      if(_asInvalid.length){
        const _go = await _confirmUnknownEquip(_asInvalid);
        if(!_go) return;
      }
    }
  }
  if(!locationSel){ toast('장비 위치를 선택하세요','err'); document.getElementById('as-location')?.focus(); return; }
  if(!desc){ toast('접수 내용을 입력하세요','err'); return; }
  const req = {
    id: `as-${Date.now().toString(36)}`,
    siteId: S.siteId==='all' ? (getSites()[0]?.id||'') : S.siteId,
    siteName: S.siteId==='all' ? (getSites()[0]?.name||'') : (S.siteName||''),
    date: today(), company, equip, location,
    type, desc,
    reporterName: repName, reporterPhone: repPhone,
    workerName, workerPhone,
    requestedAt: Date.now(),
    status: '대기',
    techName: '', techPhone: '', techNote: '',
    resolvedAt: null, resolvedNote: '',
    // 사진: 썸네일은 record에 보존, 원본은 메모리 캐시
    photoThumb: _pendingAsPhoto?.thumb || null,
    ts: Date.now(), synced: false,
    submitterMemberId: S?.memberId || '',
  };
  // 원본 사진 메모리 캐시 등록
  if(_pendingAsPhoto?.full) _asPhotoCache.set(req.id, _pendingAsPhoto.full);
  _pendingAsPhoto = null;
  _clearAsPhotoPendingUnload();

  const reqs = getAsReqs(); reqs.unshift(req); saveAsReqs(reqs);
  addNotif({icon:'🔧', title:`AS신청: ${equip}`, desc:`${company} — ${desc.slice(0,30)}`});
  pushSBNotif({target_aj_type:'정비기사', type:'as_new', title:`🔧 AS신청: ${equip}`, body:`${company} — ${desc.slice(0,60)}`, ref_id:req.id, site_id:req.siteId}).catch(()=>{});
  spinner(true, 'AS 신청 등록 중...');
  try {
    await _directPushAS(req);
    toast('AS 신청이 등록되었습니다 ✓', 'ok');
  } catch(e) {
    console.warn('[submitAS push]', e);
    scheduleRetrySync();
    toast('로컬 저장됨 — 네트워크 복구 시 자동 재시도 (최대 5회)', 'warn', 3500);
  } finally {
    spinner(false);
  }
  updateASBadge();
  closeSheet('sh-as');
  if(curPg==='pg-as') renderASPage();
}

/* ═══════════════════════════════════════════
   이력/분석 서브탭
═══════════════════════════════════════════ */
function setLogSubTab(tab,el){
  document.querySelectorAll('.lst').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  const logPanel=document.getElementById('log-panel');
  const anaPanel=document.getElementById('ana-panel');
  if(tab==='log'){ logPanel.style.display=''; anaPanel.style.display='none'; }
  else{
    logPanel.style.display='none'; anaPanel.style.display='';
    renderAnalysis(); setTimeout(runAI,300);
  }
}

/* ═══════════════════════════════════════════
   둘러보기 (게스트 모드)
═══════════════════════════════════════════ */
function startBrowse(){
  // 읽기 전용 게스트 세션 - 데이터 변경 불가
  S={role:'guest',name:'게스트',company:'—',siteId:'all',siteName:'전체',loginAt:Date.now(),readOnly:true};
  const _ls=document.getElementById('loginScreen');
  if(_ls){
    _ls.style.pointerEvents='none'; // ← 즉시 클릭 차단 해제
    _ls.style.opacity='0';
    _ls.style.transition='opacity .3s';
    setTimeout(()=>{ _ls.style.display='none'; },300);
  }
  document.getElementById('app').classList.add('on');
  applyRole();
  renderHome();
  updateLogBadge();
  toast('둘러보기 모드 (데이터 변경 불가)','warn');
}

/* ═══════════════════════════════════════════
   LOG — 가상 스크롤 (청크 렌더링)
═══════════════════════════════════════════ */
let logFilter='all';
let floorFilter=[];
let _logDebTimer=null;

function setLF(f,el){
  logFilter=f;
  document.querySelectorAll('.fchips:not(#floor-filter-chips) .fc').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  renderLog();
}

function toggleFloorF(f){
  if(f===''){
    floorFilter=[];
  } else {
    const i=floorFilter.indexOf(f);
    if(i>=0) floorFilter.splice(i,1);
    else floorFilter.push(f);
  }
  document.querySelectorAll('#floor-filter-chips .floor-fc').forEach(c=>{
    const cf=c.dataset.floor||'';
    c.classList.toggle('on', cf===''?!floorFilter.length:floorFilter.includes(cf));
  });
  renderLog();
}
function setLFSel(v){ logFilter=v; renderLog(); }

// 검색 디바운스 (타이핑 중 불필요 렌더 방지)
function onLogSearch(){
  clearTimeout(_logDebTimer);
  _logDebTimer=setTimeout(renderLog, 200);
}

let _logFiltered=[];
let _logChunkIdx=0;
let _logLoadTimer=null;
const LOG_CHUNK=20;
const MAX_LOG_DOM=60; // DOM에 유지할 최대 로그카드 수 (2 chunk)

/* DOM 상단 노드 제거 — 스크롤 위치 유지하며 오래된 카드 제거
   - .lcard 개수가 MAX_LOG_DOM 초과 시 맨 위부터 삭제
   - 제거된 높이만큼 scrollTop 보정 → 화면 점프 없음 */
function _trimLogDOM(el){
  const cards = el.querySelectorAll('.lcard');
  const excess = cards.length - MAX_LOG_DOM;
  if(excess <= 0) return;
  const panel = document.getElementById('ops-log-panel');
  let removedH = 0;
  for(let i = 0; i < excess; i++){
    removedH += cards[i].offsetHeight || 82;
    cards[i].remove();
  }
  // 스크롤 위치 보정 (화면 점프 방지)
  if(panel) panel.scrollTop = Math.max(0, panel.scrollTop - removedH);
}
const LOG_PAGE_SIZE=200; // 서버에서 한 번에 가져올 최대 건수

function clearDateRange(){
  document.getElementById('log-date-from').value='';
  document.getElementById('log-date-to').value='';
  renderLog();
}
function clearAllFilters(){
  document.getElementById('log-date-from').value='';
  document.getElementById('log-date-to').value='';
  floorFilter=[];
  logFilter='all';
  const sel=document.getElementById('log-status-sel'); if(sel) sel.value='all';
  document.querySelectorAll('#floor-filter-chips .floor-fc').forEach((c,i)=>c.classList.toggle('on',i===0));
  renderLog();
}

// renderLog — IDB/Supabase 서버사이드 쿼리 기반
function renderLog(){
  const el=document.getElementById('log-body');
  if(!el) return;
  el.innerHTML=`<div style="padding:20px;text-align:center;color:var(--tx3);font-size:12px">
    <div style="width:20px;height:20px;border:2px solid var(--br);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px"></div>조회 중...</div>`;
  clearTimeout(_logLoadTimer);
  _logLoadTimer=setTimeout(_doRenderLog, 150); // 디바운스
}

async function _doRenderLog(){
  const el=document.getElementById('log-body');
  if(!el) return;
  const q=(document.getElementById('log-q')?.value||'').toLowerCase();
  const siteId=S?.siteId==='all'?null:S?.siteId;
  const td=today();
  const dateFrom=document.getElementById('log-date-from')?.value || (()=>{
    // 기본: 최근 7일 (로컬 날짜 기준)
    const [y,m,dy]=today().split('-').map(Number);
    const d=new Date(y,m-1,dy-7);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  })();
  const dateTo=document.getElementById('log-date-to')?.value||td;

  try {
    // Supabase 또는 IDB에서 범위 조회
    let f = await getLogsByRange(dateFrom, dateTo, siteId, LOG_PAGE_SIZE);

    // 클라이언트 사이드 추가 필터 (검색어 / 상태 필터)
    if(q) f=f.filter(l=>(l.company||'').toLowerCase().includes(q)||(l.equip||'').toLowerCase().includes(q)||(l.name||'').toLowerCase().includes(q));
    if(logFilter==='open')  f=f.filter(l=>l.status==='start');
    if(logFilter==='done')  f=f.filter(l=>l.status==='end');
    if(logFilter==='today') f=f.filter(l=>l.date===td);
    if(logFilter==='mine'&&S) f=f.filter(l=>l.name===S.name&&l.company===S.company);
    if(floorFilter.length) f=f.filter(l=>floorFilter.some(ff=>(l.floor||'').includes(ff)));
    f=f.filter(l=>l.type!=='idle');

    _logFiltered=f; _logChunkIdx=0;

    if(!f.length){
      el.innerHTML=`<div class="empty"><div class="empty-ico" style="font-size:32px;margin-bottom:10px">—</div><div class="empty-txt">이력이 없습니다</div></div>`;
      return;
    }
    // DOM 완전 초기화 — 이전 청크 노드 누적 방지
    while(el.firstChild) el.removeChild(el.firstChild);
    // 1,000건 초과 시 상단 안내 (날짜 범위 축소 권장)
    if(f.length >= 1000){
      const warn = document.createElement('div');
      warn.style.cssText = 'padding:6px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--rs);font-size:10px;color:#f59e0b;margin-bottom:6px;text-align:center';
      warn.textContent = `⚠️ ${f.length.toLocaleString()}건 — 날짜 범위를 좁히면 더 빠릅니다`;
      el.appendChild(warn);
    }
    _renderLogChunk(el);
  } catch(e){
    el.innerHTML=`<div class="empty"><div class="empty-txt">조회 오류: ${e.message}</div></div>`;
  }
}

function _renderLogChunk(el){
  const chunk=_logFiltered.slice(_logChunkIdx, _logChunkIdx+LOG_CHUNK);
  if(!chunk.length) return;

  const frag=document.createDocumentFragment();
  for(const l of chunk){
    const col=gCoCol(l.siteId,l.company);
    const sCls=l.status==='start'?'s-start':l.status==='end'?'s-end':'s-off';
    const sTxt=l.status==='start'?'사용중':l.status==='end'?'완료':'미사용';
    const div=document.createElement('div');
    div.className='lcard';
    // status colors per spec
    const stColor=l.status==='start'?'#15803D':l.status==='end'?'#374151':
      l.reason==='휴무'?'#1D4ED8':
      (l.reason==='작동불량'||l.reason==='AS대기')?'#DC2626':'#6b7280';
    const stLabel=l.status==='start'?'START':l.status==='end'?'FINISH':'미사용';
    const teamTag = l.team ? ` <span style="font-size:9px;color:var(--tx3)">(${esc(l.team)}팀)</span>`
      : (l.team===''||l.team==null) && l.status!=='off' ? '' : '';
    // 상세위치 + 프로젝트 조합
    const _locParts = [l.locationDetail||'', l.project||''].filter(Boolean);
    const _locStr = _locParts.length ? _locParts.join(' · ') : '—';
    div.innerHTML=`<div class="lc-top">
        <div class="lc-co" style="flex:1;min-width:0">
          <div class="lc-dot" style="background:${col};flex-shrink:0"></div>
          <div class="lc-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.company)}${teamTag}</div>
          <span style="font-size:9px;font-weight:800;margin-left:5px;padding:1px 5px;border-radius:4px;background:${stColor}22;color:${stColor};flex-shrink:0">${stLabel}</span>
          <span style="font-size:8px;color:var(--tx3);margin-left:4px;flex-shrink:0">${l.synced?'●':'○'}</span>
        </div>
        <div class="lc-time" style="flex-shrink:0;white-space:nowrap">${l.date||''} ${fmtTS(l.ts)}</div>
      </div>
      <div style="font-size:11px;color:var(--tx2);padding:4px 0 2px;line-height:1.6">
        <span style="font-family:monospace;font-weight:700;color:var(--tx)">${esc(l.equip)||'—'}</span>
        <span style="color:var(--tx3);margin:0 4px">/</span>
        <span>${esc(l.floor)||'—'}</span>
        <span style="color:var(--tx3);margin:0 4px">/</span>
        <span style="color:var(--tx2)">${esc(_locStr)}</span>
        <span style="color:var(--tx3);margin:0 4px">/</span>
        <span>${esc(l.name)||'—'}</span>
        ${l.startTime?`<span style="color:var(--tx3);margin:0 4px">·</span><span style="color:var(--tx3)">${l.startTime}${l.endTime?'~'+l.endTime:''}</span>`:''}
      </div>
      ${(()=>{
        // 타임스탬프 기반 실제 경과시간 (endTs-ts) 우선, 없으면 저장된 duration 사용
        const _realDur = (l.endTs && l.ts) ? +((l.endTs - l.ts)/3600000).toFixed(2) : l.duration;
        return _realDur!=null ? `<div class="lc-dur">사용시간: <b>${fH(_realDur)}</b>${(l.endTs&&l.ts)?'<span style="font-size:9px;color:var(--tx3);margin-left:4px">(실측)</span>':''}${l.meterStart?` · 계기 ${l.meterStart}h → ${l.meterEnd}h`:''}</div>` : '';
      })()}
      ${l.reason?`<div class="lc-dur" style="color:${stColor};font-weight:600">${l.reason}</div>`:''}`;
    frag.appendChild(div);
  }
  el.appendChild(frag);
  _logChunkIdx+=LOG_CHUNK;

  // 기존 sentinel 제거
  const oldSentinel = el.querySelector('.log-sentinel');
  if(oldSentinel) oldSentinel.remove();

  if(_logChunkIdx < _logFiltered.length){
    // IntersectionObserver 지원 시 — 스크롤 끝에 도달하면 자동 로드 (DOM 클릭 불필요)
    const sentinel = document.createElement('div');
    sentinel.className = 'log-sentinel';
    sentinel.style.cssText = 'height:20px;text-align:center;padding:8px;color:var(--tx3);font-size:11px';
    sentinel.textContent = `▾ ${_logFiltered.length - _logChunkIdx}건 더`;
    el.appendChild(sentinel);

    if('IntersectionObserver' in window){
      const io = new IntersectionObserver(entries => {
        if(entries[0].isIntersecting){
          io.disconnect();
          sentinel.remove();
          _trimLogDOM(el);   // 상단 오래된 노드 제거 → DOM ≤ 60 유지
          _renderLogChunk(el);
        }
      }, { root: document.getElementById('ops-log-panel'), threshold: 0.1 });
      io.observe(sentinel);
    } else {
      // 폴백: 클릭으로 더보기
      sentinel.style.cursor = 'pointer';
      sentinel.style.color  = 'var(--blue)';
      sentinel.style.fontWeight = '700';
      sentinel.onclick = () => { sentinel.remove(); _renderLogChunk(el); };
    }
  }
}

/* ═══════════════════════════════════════════
   ANALYSIS
═══════════════════════════════════════════ */
let anaP='week';
function setPeriod(p,el){ anaP=p; document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('on')); el?.classList.add('on'); renderRank(); }

function renderAnalysis(){
  if(!S||S.role==='tech'){
    document.getElementById('ana-content').innerHTML=`<div class="locked-page"><div class="lp-ico"></div><div class="lp-title">협력사관리자 이상 접근 가능</div><div class="lp-desc">자동 분석은 협력사관리자 또는<br>AJ관리자만 이용할 수 있습니다.</div></div>`;
    return;
  }
  document.getElementById('ana-content').innerHTML=`
    <div style="padding:14px 14px 0">
    <!-- 미사용 장비 -->
    <div id="unused-equip-panel"></div>
    <div class="usage-card">
      <div class="chart-label" style="margin-bottom:4px">장비 사용시간 집계</div>
      <div class="usage-grid" id="usage-grid"></div>
    </div>
    <div class="ptabs">
      <div class="ptab on" onclick="setPeriod('week',this)">일주일</div>
      <div class="ptab"    onclick="setPeriod('month',this)">이번달</div>
      <div class="ptab"    onclick="setPeriod('3m',this)">3개월</div>
    </div>
    <div class="shd" style="display:flex;align-items:center;gap:6px"><span class="shd-title">업체별 가동률 순위</span><span style="font-size:10px;color:var(--tx3)">(업체명 클릭 시 장비별 가동율 확인)</span></div>
    <div class="rank-list" id="rank-list"></div>
    <div class="hmap">
      <div class="chart-label">일별 가동 현황 (최근 5주)</div>
      <div class="hm-grid" id="hm-grid"></div>
      <div class="hm-leg"><span>낮음</span>
        <div class="hm-lc" style="background:rgba(239,68,68,.7)"></div>
        <div class="hm-lc" style="background:rgba(234,179,8,.6)"></div>
        <div class="hm-lc" style="background:rgba(34,197,94,.5)"></div>
        <div class="hm-lc" style="background:rgba(34,197,94,.9)"></div>
        <span>높음</span></div>
    </div>
    <div style="height:16px"></div></div>`;
  renderRank();
  renderUsage();
  renderHeatmap();
}

function renderRank(){
  _renderRankAsync().catch(()=>{});
}
async function _renderRankAsync(){
  const rl=document.getElementById('rank-list'); if(!rl)return;
  const siteId=S.siteId==='all'?null:S.siteId;
  const now=new Date();
  const cutStr = anaP==='week'
    ? (() => { const d=new Date(now); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })()
    : anaP==='month'
    ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    : new Date(now.getFullYear(), now.getMonth()-3, now.getDate()).toISOString().split('T')[0];
  const toStr = today();

  // IDB/Supabase 범위 조회 — 전체 로드 없음
  const logs = await getLogsByRange(cutStr, toStr, siteId, 5000);

  const sites=siteId?[{id:siteId}]:getSites();
  const ranks=[];
  for(const site of sites){
    for(const co of getCos(site.id)){
      const cl=logs.filter(l=>l.siteId===site.id&&l.company===co.name);
      if(!cl.length) continue;
      const done=cl.filter(l=>l.status==='end');
      const r=done.length/cl.length;
      const hrs=done.reduce((s,l)=>s+(+l.duration||0),0);
      ranks.push({...co,rate:r,cnt:cl.length,hrs,siteId:site.id});
    }
  }
  ranks.sort((a,b)=>(b.rate||0)-(a.rate||0));
  const medals=['1위','2위','3위'];
  rl.innerHTML=ranks.length ? ranks.map((c,i)=>{
    const col=rCol(c.rate);
    return `<div class="rc" style="cursor:pointer" onclick="_showCoDetailPopup('${(c.name||'').replace(/'/g,"\\'")}','${c.siteId||''}')">
      <div class="rk-n ${i===0?'rk-1':i===1?'rk-2':i===2?'rk-3':''}">${medals[i]||i+1}</div>
      <div class="rk-i"><div class="rk-nm">${c.name}</div><div class="rk-mt">${c.cnt}건 · ${fH(c.hrs)}</div></div>
      <div class="rk-r">
        <div class="rk-pct" style="color:${col}">${fPct(c.rate)}</div>
        <div class="rk-bar"><div class="rk-bf" style="width:${c.rate*100}%;background:${col}"></div></div>
      </div>
      <span style="font-size:13px;color:var(--tx3);flex-shrink:0">›</span>
    </div>`;
  }).join('') : '<div class="empty"><div class="empty-txt">데이터 없음</div></div>';
}

function renderUsage(){
  _renderUsageAsync().catch(()=>{});
}
async function _renderUsageAsync(){
  const ug=document.getElementById('usage-grid'); if(!ug) return;
  const siteId=S.siteId==='all'?null:S.siteId;
  const td=today();
  const now=new Date();
  const monthCutStr=new Date(now.getFullYear(),now.getMonth()-1,now.getDate()).toISOString().split('T')[0];
  const [todayAll, monthAll] = await Promise.all([
    getTodayLogs(),
    getLogsByRange(monthCutStr, td, siteId, 10000)
  ]);
  const todayDone=todayAll.filter(l=>l.status==='end'&&(siteId?l.siteId===siteId:true));
  const monthDone=monthAll.filter(l=>l.status==='end');
  const hrsToday=todayDone.reduce((s,l)=>s+(+l.duration||0),0);
  const hrsMonth=monthDone.reduce((s,l)=>s+(+l.duration||0),0);
  const avg=monthDone.length?hrsMonth/monthDone.length:0;
  ug.innerHTML=`
    <div class="usage-item"><div class="usage-val">${fH(hrsToday)}</div><div class="usage-lbl">오늘 누적</div></div>
    <div class="usage-item"><div class="usage-val">${fH(hrsMonth)}</div><div class="usage-lbl">이달 누적</div></div>
    <div class="usage-item"><div class="usage-val">${fH(avg)}</div><div class="usage-lbl">평균/대</div></div>`;
}

function renderHeatmap(){
  _renderHeatmapAsync().catch(()=>{});
}
async function _renderHeatmapAsync(){
  const hg=document.getElementById('hm-grid'); if(!hg) return;
  const siteId=S.siteId==='all'?null:S.siteId;
  const now=new Date(), td=today();
  const days=['일','월','화','수','목','금','토'];
  const startDt=new Date(now); startDt.setDate(startDt.getDate()-34);
  const fromStr=`${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')}`;

  // IDB 범위 조회 — 최근 35일치만
  const logs = await getLogsByRange(fromStr, td, siteId, 20000);
  const byDate = new Map();
  for(const l of logs){
    if(!byDate.has(l.date)) byDate.set(l.date,[]);
    byDate.get(l.date).push(l);
  }
  // 장비마스터 — 현장 필터 (날짜별 전체장비 집계용)
  const masterAll = getEquipMaster().filter(e => siteId ? e.siteId===siteId : true);

  let html=days.map(d=>`<div class="hm-hd">${d}</div>`).join('');
  const start=new Date(now); start.setDate(start.getDate()-34);
  for(let i=0;i<start.getDay();i++) html+=`<div></div>`;
  for(let d=0;d<35-start.getDay();d++){
    const dt=new Date(start); dt.setDate(dt.getDate()+d+start.getDay());
    if(dt>now){ html+=`<div></div>`; continue; }
    const ds=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const dl=(byDate.get(ds)||[]);
    // 전체장비: 해당 날짜 기준 반입 완료 & 반출 전 장비마스터 수
    const totalEquip = masterAll.filter(e => e.inDate && e.inDate<=ds && (!e.outDate||e.outDate>=ds)).length;
    // 가동장비: 해당 날짜 종료 로그의 unique 장비번호
    const opSet = new Set(dl.filter(l=>l.status==='end').map(l=>l.equip).filter(Boolean));
    const opCount = opSet.size;
    let col='rgba(255,255,255,.03)';
    if(dl.length){
      const r = totalEquip>0 ? opCount/totalEquip : dl.filter(l=>l.status==='end').length/dl.length;
      col=r>=.9?'rgba(34,197,94,.85)':r>=.7?'rgba(34,197,94,.5)':r>=.5?'rgba(234,179,8,.6)':'rgba(239,68,68,.7)';
    }
    const ratioStr = dl.length ? `${opCount}/${totalEquip||'?'}` : '';
    html+=`<div class="hm-c" style="background:${col}${ds===td?';outline:2px solid var(--blue);outline-offset:-1px':''}">
      <span style="font-size:14px;font-weight:800;line-height:1.2;color:rgba(255,255,255,.95)">${dt.getDate()}</span>
      ${ratioStr?`<span style="font-size:11px;font-weight:700;line-height:1.2;color:rgba(255,255,255,.85)">${ratioStr}</span>`:''}
    </div>`;
  }
  hg.innerHTML=html;
}

/* ── 업체 상세 팝업 ────────────────────────────────────────── */
async function _showCoDetailPopup(coName, siteId){
  const _rc = r => r>=.9?'#4ade80':r>=.7?'#86efac':r>=.5?'#fbbf24':'#f87171';
  const _fp = r => r===null||r===undefined ? '—' : Math.round(r*100)+'%';

  // 오버레이 생성 (로딩 상태)
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:0';
  overlay.onclick = e => { if(e.target===overlay) document.body.removeChild(overlay); };
  const pop = document.createElement('div');
  pop.style.cssText = 'width:100%;max-width:540px;max-height:88vh;overflow-y:auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;box-shadow:0 -8px 32px rgba(0,0,0,.4)';
  pop.innerHTML = `<div style="text-align:center;padding:24px;color:var(--tx3);font-size:13px"><div style="width:18px;height:18px;border:2px solid var(--br);border-top-color:#60a5fa;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px"></div>불러오는 중...</div>`;
  overlay.appendChild(pop);
  document.body.appendChild(overlay);

  const now = new Date(), td = today();
  const week7 = (() => { const d=new Date(now); d.setDate(d.getDate()-7); return d.toISOString().split('T')[0]; })();
  const month1 = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const sid = siteId || null;

  // 1주일 + 이번달 로그 병렬 로드
  const [wLogs, mLogs] = await Promise.all([
    getLogsByRange(week7, td, sid, 5000),
    getLogsByRange(month1, td, sid, 5000)
  ]);
  const wCo = wLogs.filter(l=>l.company===coName);
  const mCo = mLogs.filter(l=>l.company===coName);

  const wRate = wCo.length ? wCo.filter(l=>l.status==='end').length/wCo.length : null;
  const mRate = mCo.length ? mCo.filter(l=>l.status==='end').length/mCo.length : null;

  // 장비마스터에서 해당 업체 반입 중 장비 목록
  const equips = getEquipMaster().filter(e => e.company===coName && (sid ? e.siteId===sid : true) && e.status==='active');

  // 장비별 상세: 층수/프로젝트는 최근 로그에서 추출
  const equipRows = equips.map(e => {
    const eLogs = mCo.filter(l => (l.equip||'').toUpperCase()===(e.equipNo||'').toUpperCase());
    const latest = [...eLogs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).find(l=>l.floor||l.project);
    const floor   = latest?.floor   || '—';
    const project = latest?.project || '—';
    const eWLogs  = wCo.filter(l=>(l.equip||'').toUpperCase()===(e.equipNo||'').toUpperCase());
    const ewRate  = eWLogs.length ? eWLogs.filter(l=>l.status==='end').length/eWLogs.length : null;
    const emRate  = eLogs.length  ? eLogs.filter(l=>l.status==='end').length/eLogs.length   : null;
    return { equipNo:e.equipNo, spec:e.spec||'', floor, project, ewRate, emRate };
  });

  // 로그에는 있지만 마스터에 없는 장비 (반출 장비 등)
  const masterNos = new Set(equips.map(e=>(e.equipNo||'').toUpperCase()));
  const extraNos = [...new Set(mCo.map(l=>(l.equip||'').toUpperCase()).filter(n=>n&&!masterNos.has(n)))];
  const extraRows = extraNos.map(no => {
    const eLogs = mCo.filter(l=>(l.equip||'').toUpperCase()===no);
    const latest = [...eLogs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).find(l=>l.floor||l.project);
    const eWLogs = wCo.filter(l=>(l.equip||'').toUpperCase()===no);
    const ewRate = eWLogs.length ? eWLogs.filter(l=>l.status==='end').length/eWLogs.length : null;
    const emRate = eLogs.length  ? eLogs.filter(l=>l.status==='end').length/eLogs.length   : null;
    return { equipNo:no, spec:'', floor:latest?.floor||'—', project:latest?.project||'—', ewRate, emRate };
  });

  const allRows = [...equipRows, ...extraRows];

  const rowHtml = r => `
    <div style="padding:8px 10px;background:var(--bg2);border:1px solid var(--br);border-radius:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-family:monospace;font-size:13px;font-weight:800;color:#60a5fa;flex-shrink:0">${r.equipNo}</span>
        ${r.spec?`<span style="font-size:10px;padding:1px 6px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);border-radius:4px;color:var(--tx2)">${r.spec}</span>`:''}
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:var(--tx3)">${r.floor}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${r.project&&r.project!=='—'?`<span style="font-size:10px;color:#14b8a6;font-weight:600">📂 ${r.project}</span>`:''}
        <span style="font-size:10px;color:var(--tx3)">1주: <strong style="color:${r.ewRate!==null?_rc(r.ewRate):'var(--tx3)'}">${_fp(r.ewRate)}</strong></span>
        <span style="font-size:10px;color:var(--tx3)">이달: <strong style="color:${r.emRate!==null?_rc(r.emRate):'var(--tx3)'}">${_fp(r.emRate)}</strong></span>
      </div>
    </div>`;

  pop.innerHTML = `
    <div style="width:40px;height:4px;background:var(--br);border-radius:2px;margin:0 auto 16px"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="font-size:17px;font-weight:900;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${coName}</div>
      <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;color:var(--tx3);cursor:pointer;line-height:1;padding:0 4px;flex-shrink:0">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <div class="kpi" style="text-align:center;padding:10px">
        <div style="font-size:24px;font-weight:900;color:${wRate!==null?_rc(wRate):'var(--tx3)'}">${_fp(wRate)}</div>
        <div style="font-size:10px;color:var(--tx2);margin-top:2px">최근 1주일 가동률</div>
        <div style="font-size:9px;color:var(--tx3);margin-top:1px">${wCo.filter(l=>l.status==='end').length}/${wCo.length}건</div>
      </div>
      <div class="kpi" style="text-align:center;padding:10px">
        <div style="font-size:24px;font-weight:900;color:${mRate!==null?_rc(mRate):'var(--tx3)'}">${_fp(mRate)}</div>
        <div style="font-size:10px;color:var(--tx2);margin-top:2px">이번달 가동률</div>
        <div style="font-size:9px;color:var(--tx3);margin-top:1px">${mCo.filter(l=>l.status==='end').length}/${mCo.length}건</div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--tx3);margin-bottom:8px">장비 현황 (${allRows.length}대)</div>
    ${allRows.length
      ? `<div style="display:flex;flex-direction:column;gap:6px">${allRows.map(rowHtml).join('')}</div>`
      : '<div class="empty"><div class="empty-txt">이달 가동 이력 없음</div></div>'}
    <div style="height:8px"></div>`;
}

/* ── 데이터 기반 분석 (Open-Meteo 날씨 연동) ────────────────── */
function _askAIHome(type){ _askAI(type,'home-analysis-result'); }

async function _askAI(type, targetId='ai-query-result'){
  const el = document.getElementById(targetId);
  if(!el) return;
  el.innerHTML = `<div class="ai-qres" style="display:flex;align-items:center;gap:8px"><div style="width:13px;height:13px;border:2px solid var(--br);border-top-color:#60a5fa;border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0"></div><span style="font-size:11px;color:var(--tx3)">분석 중...</span></div>`;

  const siteId  = S?.siteId==='all' ? null : S?.siteId;
  const site    = S?.siteName || '현장';
  const allLogs = getLogs().filter(l => siteId ? l.siteId===siteId : true);
  const allTr   = getTransit().filter(r => siteId ? r.siteId===siteId : true);
  const now     = new Date();

  // 공통 통계
  const logDone = allLogs.filter(l=>l.status==='end');
  const cut7    = new Date(now); cut7.setDate(cut7.getDate()-7);
  const cut7S   = cut7.toISOString().split('T')[0];
  const logs7   = allLogs.filter(l=>l.date>=cut7S);
  // 실내/실외 분리
  const OUTDOOR_FLOORS=['모듈동','1F외곽'];
  const isOutdoorLog=l=>OUTDOOR_FLOORS.some(f=>(l.floor||'').includes(f)||(l.locationDetail||'').includes(f));
  const outdoorLogs2=allLogs.filter(isOutdoorLog);
  const indoorLogs2=allLogs.filter(l=>!isOutdoorLog(l));
  const rate7d  = logs7.length ? Math.round(logs7.filter(l=>l.status==='end').length/logs7.length*100) : 0;
  const hrs     = logDone.reduce((s,l)=>s+(+l.duration||0),0);

  // 업체별 집계
  const coMap = {};
  allLogs.forEach(l=>{ if(!l.company) return; if(!coMap[l.company]) coMap[l.company]={tot:0,done:0,hrs:0}; coMap[l.company].tot++; if(l.status==='end'){coMap[l.company].done++;coMap[l.company].hrs+=(+l.duration||0);} });
  const coEntries = Object.entries(coMap).sort((a,b)=>b[1].done-a[1].done);

  // 장비별 집계
  const eqMap = {};
  allLogs.forEach(l=>{ if(!l.equip) return; if(!eqMap[l.equip]) eqMap[l.equip]={tot:0,done:0,hrs:0,company:l.company}; eqMap[l.equip].tot++; if(l.status==='end'){eqMap[l.equip].done++;eqMap[l.equip].hrs+=(+l.duration||0);} });
  const eqEntries = Object.entries(eqMap).sort((a,b)=>b[1].hrs-a[1].hrs);

  // 반입반출
  const trIn  = allTr.filter(r=>r.type==='in');
  const trOut = allTr.filter(r=>r.type==='out');

  // 위치별
  const locMap = {};
  allLogs.forEach(l=>{ const loc=l.floor||l.location||'미상'; locMap[loc]=(locMap[loc]||0)+1; });
  const locEntries = Object.entries(locMap).sort((a,b)=>b[1]-a[1]);

  // Open-Meteo 날씨 (필요한 타입만)
  let weatherLines = [];
  if(['weekly','overload','as-heavy'].includes(type)){
    try{
      const lat=DB.g('site_lat','37.0505'); const lng=DB.g('site_lng','127.0752');
      const wr=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,wind_speed_10m_max,weathercode&timezone=Asia%2FSeoul&past_days=7&forecast_days=1`);
      const wd=await wr.json();
      if(wd.daily){
        const rainDays=wd.daily.precipitation_sum.filter(r=>r>1).length;
        const windDays=wd.daily.wind_speed_10m_max.filter(w=>w>10).length;
        if(rainDays>2) weatherLines.push(`🌧 최근 7일 중 <b>${rainDays}일 우천</b> — 날씨 영향으로 가동 저조 가능성`);
        if(windDays>1) weatherLines.push(`💨 최근 7일 중 <b>${windDays}일 강풍</b>(10m/s↑) — 고소작업 제한 요인`);
      }
    }catch(_){}
  }

  // 타입별 분석 생성
  let lines = [];
  const fH2 = h => h>=1 ? `${h.toFixed(1)}h` : `${Math.round(h*60)}분`;

  if(type==='weekly'){
    lines.push(`📋 <b>${site}</b> 주간 운영 리포트`);
    lines.push(`• 최근 7일 가동률 <b>${rate7d}%</b> ${rate7d>=70?'— 목표 달성 ✓':'— 목표(70%) 미달 ⚠'}`);
    lines.push(`• 누적 가동시간 <b>${fH2(hrs)}</b> · 총 기록 <b>${allLogs.length}건</b>`);
    if(coEntries.length) lines.push(`• 최다 가동 업체: <b>${coEntries[0][0]}</b> ${coEntries[0][1].done}건 완료`);
    if(eqEntries.length) lines.push(`• 최다 사용 장비: <b>${eqEntries[0][0]}</b> ${fH2(eqEntries[0][1].hrs)}`);
    if(indoorLogs2.length>0||outdoorLogs2.length>0){
      const inHrs=indoorLogs2.filter(l=>l.status==='end').reduce((s,l)=>s+(+l.duration||0),0);
      const outHrs=outdoorLogs2.filter(l=>l.status==='end').reduce((s,l)=>s+(+l.duration||0),0);
      lines.push(`• 실내 ${fH2(inHrs)} / 실외(모듈동·1F외곽) ${fH2(outHrs)}`);
    }
    lines.push(...weatherLines);
  } else if(type==='top-equip'){
    lines.push(`🏆 <b>${site}</b> 장비별 사용시간 TOP ${Math.min(eqEntries.length,7)}`);
    eqEntries.slice(0,7).forEach(([eq,v],i)=>lines.push(`${i+1}. <b>${eq}</b> ${fH2(v.hrs)} · ${v.done}완료/${v.tot}건 · ${v.company}`));
    if(!eqEntries.length) lines.push('• 장비 사용 기록이 없습니다');
  } else if(type==='as-heavy'){
    // 가동률 낮은 장비 (AS 의심)
    const lowRate = eqEntries.filter(([,v])=>v.tot>=2&&v.done/v.tot<0.6).sort((a,b)=>(a[1].done/a[1].tot)-(b[1].done/b[1].tot));
    lines.push(`🔧 <b>${site}</b> AS 주의 장비 분석`);
    if(lowRate.length){
      lowRate.slice(0,5).forEach(([eq,v])=>lines.push(`• <b>${eq}</b> 가동률 ${Math.round(v.done/v.tot*100)}%(${v.done}/${v.tot}) — ${v.company}`));
    } else {
      lines.push('• 가동률 60% 미만 장비 없음 — 양호한 상태입니다');
    }
    lines.push(...weatherLines);
  } else if(type==='location'){
    lines.push(`📍 <b>${site}</b> 위치별 가동 현황`);
    locEntries.slice(0,7).forEach(([loc,cnt])=>lines.push(`• <b>${loc}</b> — ${cnt}건`));
    lines.push(`• 반입 <b>${trIn.length}건</b> · 반출 <b>${trOut.length}건</b>`);
    if(!locEntries.length) lines.push('• 위치 기록이 없습니다');
  } else if(type==='overload'){
    lines.push(`⚡ <b>${site}</b> 장비 과부하 분석`);
    const heavy = eqEntries.filter(([,v])=>v.hrs>50);
    if(heavy.length){
      heavy.slice(0,5).forEach(([eq,v])=>lines.push(`• <b>${eq}</b> <span style="color:#f87171;font-weight:700">${fH2(v.hrs)}</span> — 정기점검 권고 (${v.company})`));
    } else {
      const avg = eqEntries.length ? hrs/eqEntries.length : 0;
      lines.push(`• 50h 초과 장비 없음. 장비별 평균 ${fH2(avg)}`);
    }
    lines.push(...weatherLines);
  } else if(type==='shortage'){
    lines.push(`🚨 <b>${site}</b> 장비 부족 분석`);
    // 업체별 가동률 낮은 곳 = 장비 부족 가능성
    const lowCo = coEntries.filter(([,v])=>v.tot>=3&&v.done/v.tot<0.5);
    if(lowCo.length){
      lowCo.slice(0,4).forEach(([co,v])=>lines.push(`• <b>${co}</b> 완료율 ${Math.round(v.done/v.tot*100)}% — 장비 보충 검토`));
    } else {
      lines.push('• 업체별 가동률 양호 — 장비 부족 징후 없음');
    }
    if(locEntries.length) lines.push(`• 집중 위치: <b>${locEntries[0][0]}</b> ${locEntries[0][1]}건`);
  } else if(type==='pattern'){
    lines.push(`👥 <b>${site}</b> 업체별 사용 패턴`);
    coEntries.slice(0,6).forEach(([co,v])=>{
      const r=Math.round(v.done/v.tot*100);
      lines.push(`• <b>${co}</b> 가동률 ${r}%(${v.done}/${v.tot}) ${fH2(v.hrs)} — ${r>=80?'우수':r>=60?'보통':'개선필요'}`);
    });
    if(!coEntries.length) lines.push('• 업체 기록이 없습니다');
  } else if(type==='inefficient'){
    lines.push(`💤 <b>${site}</b> 비효율 장비 분석`);
    const ineff = eqEntries.filter(([,v])=>v.hrs<5&&v.tot>=2).sort((a,b)=>a[1].hrs-b[1].hrs);
    if(ineff.length){
      ineff.slice(0,5).forEach(([eq,v])=>lines.push(`• <b>${eq}</b> ${fH2(v.hrs)} (${v.tot}건) — 재배치 또는 반출 검토 (${v.company})`));
    } else {
      lines.push('• 5h 미만 저사용 장비 없음');
    }
  } else if(type==='transit'){
    lines.push(`🚛 <b>${site}</b> 반입/반출 현황`);
    lines.push(`• 반입 <b>${trIn.length}건</b> (완료 ${trIn.filter(r=>r.status==='반입완료').length}건)`);
    lines.push(`• 반출 <b>${trOut.length}건</b> (완료 ${trOut.filter(r=>r.status==='반출완료').length}건)`);
    const trCoMap={};
    allTr.forEach(r=>{if(!r.company)return;if(!trCoMap[r.company])trCoMap[r.company]={in:0,out:0};if(r.type==='in')trCoMap[r.company].in++;else trCoMap[r.company].out++;});
    Object.entries(trCoMap).sort((a,b)=>(b[1].in+b[1].out)-(a[1].in+a[1].out)).slice(0,3)
      .forEach(([co,v])=>lines.push(`• ${co}: 반입 ${v.in}건 / 반출 ${v.out}건`));
  } else if(type==='missing'){
    // ── 업체별 금일 장비 사용 현황 ──
    const tdStr = today();
    const todayLogs2 = allLogs.filter(l=>l.date===tdStr);
    const sites2 = siteId ? [{id:siteId}] : getSites();
    // 장비마스터에서 현장별 active 장비를 회사별로 집계
    const allEquip = typeof getEquipMaster==='function' ? getEquipMaster() : [];
    const activeEquip = allEquip.filter(e=>e.status==='active'&&(siteId?e.siteId===siteId:true));
    // 회사별 보유장비 Set
    const coEquipMap = {};
    activeEquip.forEach(e=>{
      if(!coEquipMap[e.company]) coEquipMap[e.company] = new Set();
      coEquipMap[e.company].add(e.equipNo);
    });
    // 회사 목록: 장비마스터 보유사 + 등록된 협력사 (합집합)
    const coNames = new Set([...Object.keys(coEquipMap)]);
    for(const s of sites2) for(const co of getCos(s.id)) coNames.add(co.name);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    lines.push(`📊 <b>${site}</b> 금일 장비 사용현황 <span style="color:var(--tx3);font-size:10px">(${tdStr} ${hhmm} 기준)</span>`);
    const sortedCos = [...coNames].sort();
    let allDone = true;
    sortedCos.forEach(coName=>{
      const coLogs = todayLogs2.filter(l=>l.company===coName);
      const startEquips = new Set(coLogs.filter(l=>l.status==='start').map(l=>l.equip));
      const endEquips   = new Set(coLogs.filter(l=>l.status==='end').map(l=>l.equip));
      const usedEquips  = new Set([...startEquips,...endEquips]);
      const totalEquip  = coEquipMap[coName]?.size || 0;
      const unusedCnt   = Math.max(0, totalEquip - usedEquips.size);
      if(unusedCnt > 0) allDone = false;
      const usingStr  = startEquips.size > 0 ? `<span style="color:#fbbf24">사용중 ${startEquips.size}대</span>` : '';
      const doneStr   = endEquips.size   > 0 ? `<span style="color:#4ade80">종료 ${endEquips.size}대</span>`   : '';
      const unusedStr = unusedCnt        > 0 ? `<span style="color:#f87171">미사용 ${unusedCnt}대</span>`      : '';
      const parts = [usingStr,doneStr,unusedStr].filter(Boolean).join(' / ');
      const total = totalEquip > 0 ? `<span style="color:var(--tx3);font-size:10px"> (보유 ${totalEquip}대)</span>` : '';
      lines.push(`<b>${coName}</b>${total} — ${parts||'<span style="color:var(--tx3)">로그 없음</span>'}`);
    });
    if(!sortedCos.length) lines.push('<span style="color:var(--tx3)">장비 보유 업체 없음</span>');
    else if(allDone) lines.push(`✅ 모든 업체 장비 운영 완료`);

  } else {
    lines.push(`• 분석 타입을 인식할 수 없습니다`);
  }

  const _lineDiv = l => `<div style="font-size:11px;line-height:1.7;padding:1px 0">${l}</div>`;
  const ANALYSIS_FOLD = 5;
  if(targetId === 'home-analysis-result' && lines.length > ANALYSIS_FOLD){
    const visH  = lines.slice(0, ANALYSIS_FOLD).map(_lineDiv).join('');
    const hidH  = lines.slice(ANALYSIS_FOLD).map(_lineDiv).join('');
    const extra = lines.length - ANALYSIS_FOLD;
    const accBtn = `<button id="home-acc-btn-analysis" data-extra="${extra}"
      onclick="_toggleHomeAcc('analysis')"
      style="width:100%;margin-top:4px;padding:3px 0;font-size:10px;font-weight:700;color:var(--tx3);background:none;border:none;border-top:1px solid var(--br);cursor:pointer;text-align:center">
      ${_homeAcc.analysis?'▲ 접기':`▼ 더보기 <span style="opacity:.7">(+${extra}건)</span>`}
    </button>`;
    el.innerHTML = `<div class="ai-qres">
      <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:7px">📊 분석 결과</div>
      ${visH}
      <div id="home-acc-body-analysis" style="display:${_homeAcc.analysis?'block':'none'}">${hidH}</div>
      ${accBtn}
    </div>`;
  } else {
    const html = lines.map(_lineDiv).join('');
    el.innerHTML = `<div class="ai-qres"><div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:7px">📊 분석 결과</div>${html}</div>`;
  }
}

async function runAI(){
  const el=document.getElementById('unused-equip-panel'); if(!el) return;
  const siteId=S.siteId==='all'?null:S.siteId;
  const allLogs=getLogs().filter(l=>siteId?l.siteId===siteId:true);

  // ── 최근 1개월 내 1주일 미사용 장비 ──
  const now7=new Date();
  const cut7=new Date(now7); cut7.setDate(cut7.getDate()-7);
  const cut1m=new Date(now7); cut1m.setMonth(cut1m.getMonth()-1);
  const cut7Str=cut7.toISOString().split('T')[0];
  const cut1mStr=cut1m.toISOString().split('T')[0];
  const recentLogs=allLogs.filter(l=>l.date>=cut1mStr);
  const lastUsed=new Map();
  for(const l of recentLogs){
    if(!l.equip) continue;
    const prev=lastUsed.get(l.equip);
    if(!prev||l.date>prev.date) lastUsed.set(l.equip,{date:l.date,company:l.company});
  }
  const unused7=[];
  for(const [equip,info] of lastUsed){
    if(info.date<cut7Str) unused7.push({equip,company:info.company,lastDate:info.date});
  }
  unused7.sort((a,b)=>a.lastDate.localeCompare(b.lastDate));

  el.innerHTML=unused7.length>0
    ?`<div style="margin-bottom:12px;padding:10px 12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px">
        <div style="font-size:11px;font-weight:800;color:#f87171;margin-bottom:6px">⚠ 최근 1개월 내 1주일 미사용 장비 (${unused7.length}대)</div>
        ${unused7.slice(0,15).map(u=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--br)">
          <span style="font-size:11px;font-weight:700;color:var(--tx);font-family:'JetBrains Mono',monospace">${u.equip}</span>
          <span style="font-size:10px;color:var(--tx2)">${u.company}</span>
          <span style="font-size:10px;color:var(--tx3)">마지막 ${u.lastDate.slice(5)}</span>
        </div>`).join('')}
        ${unused7.length>15?`<div style="font-size:10px;color:var(--tx3);margin-top:4px;text-align:right">외 ${unused7.length-15}대 더</div>`:''}
      </div>`
    :`<div style="margin-bottom:12px;padding:8px 12px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);border-radius:8px;font-size:11px;color:#4ade80">✓ 최근 1개월 내 1주일 이상 미사용 장비 없음</div>`;
}

/* ═══════════════════════════════════════════
   NOTICE BOARD
═══════════════════════════════════════════ */
function getNotices(){ return DB.g(K.NOTICE,[]); }
function saveNotices(arr){ DB.s(K.NOTICE,arr); _pushNoticesToSB(arr).catch(()=>{}); }

function renderNoticeBar(){
  const el = document.getElementById('notice-bar');
  if(!el||!S) return;
  const notices = getNotices();
  const siteId = S.siteId==='all'?null:S.siteId;
  const active = notices.filter(n=>n.active&&(siteId?n.siteId===siteId:true));
  if(!active.length){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML = active.map(n=>
    `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:${active.length>1?'6px':'0'}">
      <span style="font-size:13px;flex-shrink:0">📢</span>
      <span style="flex:1;line-height:1.4">${n.text}</span>
      <span style="font-size:10px;color:#60a5fa;flex-shrink:0">${n.createdBy||''}</span>
    </div>`
  ).join('');
}

function saveNotice(siteId, text){
  if(!text.trim()){ toast('공지 내용을 입력하세요','err'); return; }
  const notices = getNotices();
  notices.unshift({id:'notice-'+Date.now().toString(36), siteId, text:text.trim(), createdBy:S.name, createdAt:Date.now(), active:true});
  saveNotices(notices);
  renderNoticeBar();
  addNotif({icon:'📢', title:'공지 등록', desc:text.trim().slice(0,60), ts:Date.now()});
  toast('공지가 등록되었습니다','ok');
  renderAdmin();
}

function deleteNotice(id){
  const all = getNotices();
  const target = all.find(n=>n.id===id);
  // M3: 협력사 관리자는 자신의 현장 공지만 삭제 가능
  if(target && S?.role==='sub' && target.siteId !== S?.siteId){
    toast('자신의 현장 공지만 삭제할 수 있습니다','err'); return;
  }
  const notices = all.filter(n=>n.id!==id);
  saveNotices(notices);
  renderNoticeBar();
  renderAdmin();
  toast('공지가 삭제되었습니다','warn');
}

function toggleNotice(id){
  const notices = getNotices();
  const n = notices.find(x=>x.id===id);
  if(n) n.active = !n.active;
  saveNotices(notices);
  renderNoticeBar();
  renderAdmin();
}

/* ═══════════════════════════════════════════
   ADMIN
═══════════════════════════════════════════ */
function _saveSiteCoords(){
  const lat=document.getElementById('site-lat-input')?.value.trim();
  const lng=document.getElementById('site-lng-input')?.value.trim();
  const latN=parseFloat(lat); const lngN=parseFloat(lng);
  if(isNaN(latN)||isNaN(lngN)||latN<33||latN>39||lngN<124||lngN>132){
    toast('유효한 좌표를 입력하세요 (위도 33~39, 경도 124~132)','err'); return;
  }
  DB.s('site_lat', latN.toFixed(4));
  DB.s('site_lng', lngN.toFixed(4));
  toast('현장 위치 저장 완료 — 날씨 연동에 반영됩니다','ok');
  renderAdmin();
}

function renderAdmin(){
  const role=S?.role;
  if(role==='tech'){
    document.getElementById('adm-content').innerHTML=`<div style="padding:14px">
      <div style="font-size:15px;font-weight:900;margin-bottom:14px">내 정보 수정</div>
      <div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="fg" style="margin:0"><label class="fg-lbl">이름 <span class="req">*</span></label>
            <input type="text" class="fg-input" id="prof-name" value="${S.name||''}">
          </div>
          <div class="fg" style="margin:0"><label class="fg-lbl">연락처</label>
            <input type="tel" class="fg-input phone-input" id="prof-phone" value="${S.phone||''}" placeholder="숫자만 입력" maxlength="11">
          </div>
        </div>
        <div class="fg" style="margin-bottom:0"><label class="fg-lbl">소속 업체</label>
          <div class="fg-display" style="padding:8px 10px;background:var(--bg3);border-radius:6px;font-size:12px">${S.company||'—'} · ${S.siteName||'—'}</div>
        </div>
      </div>
      <button class="btn-full" style="margin-top:12px" onclick="saveMyProfile()">저장</button>
      <!-- 캐시 삭제 (모든 역할 공통) -->
      <div style="margin-top:16px;padding:12px;background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.2);border-radius:12px;display:flex;align-items:center;gap:12px">
        <div style="font-size:22px;flex-shrink:0">🗑️</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:800;margin-bottom:2px">모든 캐시 삭제</div>
          <div style="font-size:10px;color:var(--tx3)">화면 오류·구버전 증상 시 로컬 캐시를 전부 삭제 후 서버에서 새로 로드합니다</div>
        </div>
        <button onclick="clearAppCache()"
          style="padding:7px 12px;font-size:11px;font-weight:800;background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);border-radius:8px;color:#a5b4fc;cursor:pointer;flex-shrink:0;white-space:nowrap">
          모든 캐시 삭제
        </button>
      </div>
    </div>`; return;
  }
  const isSub=role==='sub';
  const isAJ =role==='aj';
  const logs=getLogs(); const sites=getSites();
  const siteId=S.siteId==='all'?null:S.siteId;
  const siteLogs=siteId?logs.filter(l=>l.siteId===siteId):logs;
  const td=today();
  const tl=getLogsByDate(td).filter(l=>siteId?l.siteId===siteId:true);
  const r=tl.length>0?tl.filter(l=>l.status==='end').length/tl.length:0;
  const lastSync=DB.g('last_sync','');
  const gsUrl=DB.g(K.GS_URL,'');

  document.getElementById('adm-content').innerHTML=`
    <div style="padding:14px">
    <div class="admin-profile ${role}">
      <div class="ap-avi ${role}">${role==='aj'?'AJ':'담당'}</div>
      <div style="flex:1"><div class="ap-name">${S.name}${(S.role==='sub'&&S.title)?`<span style="font-size:11px;font-weight:500;color:var(--tx3);margin-left:6px">${S.title}</span>`:''}</div><div class="ap-role ${role}">${role==='aj'?'AJ 관리자 · 전체 현장':'협력사 관리자 · '+S.company+' · '+S.siteName}</div></div>
      ${''}
    </div>

    ${(isSub||isAJ)?(()=>{
      const noticeList=getNotices().filter(n=>isAJ||(n.siteId===S.siteId));
      const noticeCnt=noticeList.filter(n=>n.active).length;
      return `<div style="background:var(--bg2);border:1px solid var(--br);border-radius:12px;margin-bottom:14px;overflow:hidden">
        <div onclick="(()=>{const b=document.getElementById('notice-acc-body');const a=document.getElementById('notice-acc-arrow');if(b){const o=b.style.display!=='none';b.style.display=o?'none':'block';a.style.transform=o?'':'rotate(180deg)';}})()" style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer">
          <span style="font-size:13px;font-weight:800;flex:1">📢 공지사항 관리</span>
          ${noticeCnt>0?`<span style="font-size:10px;background:rgba(34,197,94,.15);color:#22c55e;padding:2px 8px;border-radius:6px;font-weight:700">활성 ${noticeCnt}건</span>`:''}
          <span id="notice-acc-arrow" style="font-size:12px;color:var(--tx3);transition:transform .2s">▼</span>
        </div>
        <div id="notice-acc-body" style="display:none;padding:0 14px 14px;border-top:1px solid var(--br)">
          ${isAJ?`
          <div class="fg" style="margin-top:10px;margin-bottom:8px">
            <label class="fg-lbl">대상 현장</label>
            <select class="fg-input" id="notice-site-sel" style="width:100%">
              ${getSites().map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>`:'<div style="height:10px"></div>'}
          <div class="fg" style="margin-bottom:8px">
            <label class="fg-lbl">공지 내용</label>
            <textarea class="fg-input" id="notice-text" rows="2" placeholder="공지할 내용을 입력하세요..." style="resize:none"></textarea>
          </div>
          <button class="btn-full teal" onclick="saveNotice(${isAJ?`document.getElementById('notice-site-sel')?.value||'${S.siteId}'`:`'${S.siteId}'`}, document.getElementById('notice-text').value)" style="margin-bottom:10px">공지 등록</button>
          <div style="max-height:200px;overflow-y:auto">
            ${noticeList.map(n=>`
            <div style="display:flex;align-items:flex-start;gap:6px;padding:8px;background:var(--bg3);border-radius:8px;margin-bottom:5px">
              <div style="flex:1">
                <div style="font-size:11px;color:var(--tx2);margin-bottom:2px">${getSites().find(s=>s.id===n.siteId)?.name||n.siteId} · ${n.createdBy}</div>
                <div style="font-size:12px">${n.text}</div>
              </div>
              <button onclick="toggleNotice('${n.id}')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1px solid var(--br);background:${n.active?'rgba(34,197,94,.15)':'var(--bg2)'};color:${n.active?'#22c55e':'var(--tx3)'};cursor:pointer;flex-shrink:0">${n.active?'ON':'OFF'}</button>
              <button onclick="deleteNotice('${n.id}')" style="font-size:12px;background:none;border:none;color:var(--red);cursor:pointer;flex-shrink:0;padding:0 4px">×</button>
            </div>`).join('')||'<div style="font-size:11px;color:var(--tx3);text-align:center;padding:10px">등록된 공지가 없습니다</div>'}
          </div>
        </div>
      </div>`;
    })():''}

    ${isSub?`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:800;color:var(--tx2);margin-bottom:8px">내 정보 수정</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="fg" style="margin:0"><label class="fg-lbl">이름</label>
          <input type="text" class="fg-input" id="prof-name" value="${S.name||''}">
        </div>
        <div class="fg" style="margin:0"><label class="fg-lbl">연락처</label>
          <input type="tel" class="fg-input phone-input" id="prof-phone" value="${S.phone||''}" placeholder="숫자만 입력" maxlength="11">
        </div>
      </div>
      <div class="fg" style="margin-bottom:8px"><label class="fg-lbl">직함</label>
        <input type="text" class="fg-input" id="prof-title" value="${S.title||''}" placeholder="예: 안전관리자">
      </div>
      <button class="btn-full" onclick="saveMyProfile()">저장</button>
    </div>`:''}

    <div class="stat2">
      <div class="sbox"><div class="sbox-lbl">총 입력건수</div><div class="sbox-val">${siteLogs.length}</div></div>
      <div class="sbox"><div class="sbox-lbl">오늘 가동률</div><div class="sbox-val">${tl.length>0?fPct(r):'—'}</div></div>
      ${isAJ?`<div class="sbox"><div class="sbox-lbl">등록 현장</div><div class="sbox-val">${sites.length}</div></div>`:''}
      <div class="sbox"><div class="sbox-lbl">마지막 동기화</div><div class="sbox-val" style="font-size:13px">${lastSync?new Date(lastSync).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'미동기화'}</div></div>
    </div>

    <div class="menu-list">
      ${(isAJ||isSub)?`
      <div class="mrow" onclick="openSheet('sh-qr-gen');document.getElementById('qr-equip-input').value=''">
        <div class="mrow-ico" style="background:rgba(139,92,246,.12);color:rgb(139,92,246)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">QR 코드 생성</div><div class="mrow-desc">장비번호별 QR 코드 PDF 출력</div></div>
        <div class="mrow-arr">›</div>
      </div>
      `:''}
      ${isAJ?`
      <div class="mrow" onclick="openEquipMasterSheet()">
        <div class="mrow-ico" style="background:rgba(96,165,250,.12);color:rgb(96,165,250)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">가동 장비 내역</div><div class="mrow-desc">현재 현장 반입 중 장비 목록 · 자동완성 데이터 관리</div></div>
        <div class="mrow-arr">›</div>
      </div>
      <div class="mrow" onclick="openSheet('sh-admin-hub');setTimeout(()=>{renderSiteMgr();renderCoMgr();},30)">
        <div class="mrow-ico" style="background:rgba(245,158,11,.12);color:rgb(245,158,11)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">현장 관리</div><div class="mrow-desc">현장 · 협력사 · 계정 통합 관리</div></div>
        <div class="mrow-arr">›</div>
      </div>
      <div class="mrow" onclick="openSheet('sh-alert');setTimeout(renderCustomAlertList,30)">
        <div class="mrow-ico" style="background:rgba(239,68,68,.12);color:rgb(239,68,68)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">알림 설정</div><div class="mrow-desc">오후 3시 미입력 알림 기준 설정</div></div>
        <div class="mrow-arr">›</div>
      </div>
      `:''}
      ${isSub?`
      <div class="mrow" onclick="openSubEquipSheet()">
        <div class="mrow-ico" style="background:rgba(59,139,255,.12);color:rgb(59,139,255)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">장비 대수 수정</div><div class="mrow-desc">내 업체(${S.company}) 장비 대수 변경</div></div>
        <div class="mrow-arr">›</div>
      </div>
      `:''}
      <div class="mrow" onclick="openExportSheet()">
        <div class="mrow-ico" style="background:rgba(34,197,94,.12);color:rgb(34,197,94)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">데이터 내보내기</div><div class="mrow-desc">CSV / JSON 다운로드</div></div>
        <div class="mrow-arr">›</div>
      </div>
      ${isAJ?`
      <div class="mrow" onclick="openASAnalysis()">
        <div class="mrow-ico" style="background:rgba(220,38,38,.12);color:rgb(220,38,38)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><polyline points="9 11 12 14 16 10"/></svg></div>
        <div class="mrow-inf"><div class="mrow-title">AS 현황 분석</div><div class="mrow-desc">AS 요청 통계 · 유형별 분석</div></div>
        <div class="mrow-arr">›</div>
      </div>
      `:''}
    </div>


    <!-- 카카오 오픈채팅 지원 -->
    <div style="margin-top:12px;padding:12px;background:rgba(254,229,0,.08);border:1px solid rgba(254,229,0,.25);border-radius:12px;display:flex;align-items:center;gap:12px">
      <div style="font-size:22px;flex-shrink:0">💬</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:800;margin-bottom:2px">앱 오류 문의 / 카카오 오픈채팅</div>
        <div style="font-size:10px;color:var(--tx3)">오류가 발생하면 오픈채팅으로 문의하세요</div>
      </div>
      <button onclick="window.open('https://open.kakao.com/o/sGpAMVjf','_blank')"
        style="padding:7px 12px;font-size:11px;font-weight:800;background:rgba(254,229,0,.9);border:none;border-radius:8px;color:#1a1a1a;cursor:pointer;flex-shrink:0;white-space:nowrap">
        채팅 열기
      </button>
    </div>

    <!-- 캐시 삭제 -->
    <div style="margin-top:10px;padding:12px;background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.2);border-radius:12px;display:flex;align-items:center;gap:12px">
      <div style="font-size:22px;flex-shrink:0">🗑️</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:800;margin-bottom:2px">앱 캐시 삭제</div>
        <div style="font-size:10px;color:var(--tx3)">화면 오류·구버전 증상 시 캐시를 삭제하고 새로 로드합니다</div>
      </div>
      <button onclick="clearAppCache()"
        style="padding:7px 12px;font-size:11px;font-weight:800;background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);border-radius:8px;color:#a5b4fc;cursor:pointer;flex-shrink:0;white-space:nowrap">
        캐시 삭제
      </button>
    </div>

    <div style="height:16px"></div>
    </div>`;
}

// ── 가동현황 로그 날짜 기준 삭제 (AJ 전용) ────────────────────
async function _clearLogsBefore(){
  if(S?.role !== 'aj'){ toast('AJ 관리자만 사용 가능합니다','err'); return; }
  const cutDate = prompt('이 날짜 이전(미포함) 로그를 삭제합니다.\n형식: YYYY-MM-DD\n(예: 전체 삭제는 내일 날짜 입력)', today());
  if(!cutDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutDate)) return;
  if(!confirm(`${cutDate} 이전 가동현황 로그를 모두 삭제합니다.\n이 작업은 되돌릴 수 없습니다.\n계속하시겠습니까?`)) return;
  const all = getLogs();
  const kept = all.filter(l => (l.date||'') >= cutDate);
  const removed = all.length - kept.length;
  await saveLogs(kept);
  _cache.logs = null; _cache.logsByDate = null; _cache.todayLogs = null;
  toast(`${removed}건 삭제 완료`, 'ok', 3000);
  if(curOpsTab==='log') renderLog();
  if(curOpsTab==='ana') renderAnalysis();
}

// ── 모든 캐시 삭제 (전 사용자 접근 가능) ──────────────────────
async function clearAppCache(){
  if(!confirm(
    '모든 캐시를 삭제하고 서버에서 새로 로드합니다.\n\n' +
    '⚠ 로컬에 저장된 데이터(로그·반입반출·AS 등)가\n' +
    '모두 삭제되며 서버 데이터로 교체됩니다.\n' +
    '(서버에 동기화된 데이터는 보존됩니다)\n\n' +
    '로그아웃 후 다시 로그인이 필요합니다.\n계속하시겠습니까?'
  )) return;

  try {
    // 1. Service Worker 캐시 전체 삭제
    if('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // 2. Service Worker 등록 해제 (다음 로드 시 최신 버전 재등록)
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // 3. IndexedDB 전체 삭제 (aj_v3)
    await new Promise((res, rej) => {
      const req = indexedDB.deleteDatabase('aj_v3');
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
      req.onblocked = () => { console.warn('[clearCache] IDB delete blocked'); res(); };
    });
    // 4. localStorage 전체 삭제
    localStorage.clear();
  } catch(e) {
    console.warn('[clearAppCache]', e);
    // 오류가 있어도 LS는 확실히 삭제 후 reload
    try { localStorage.clear(); } catch(_) {}
  } finally {
    // 5. 서버에서 새로 로드
    location.reload(true);
  }
}

// ── 장비 마스터 관리 시트 ────────────────────────────────────
function openEquipMasterSheet() {
  let sh = document.getElementById('sh-equip-master');
  if (!sh) {
    sh = document.createElement('div');
    sh.className = 'soverlay';
    sh.id = 'sh-equip-master';
    sh.onclick = function(e) { if (e.target === sh) closeSheet('sh-equip-master'); };
    document.body.appendChild(sh);
  }
  _renderEquipMasterSheet(sh);
  openSheet('sh-equip-master');
}

function _renderEquipMasterSheet(sh) {
  const isAJ     = S?.role === 'aj';
  const siteId   = S?.siteId === 'all' ? null : S?.siteId;
  const allEquip = getEquipMaster();
  const active   = allEquip.filter(e => e.status === 'active' && (!siteId || e.siteId === siteId));
  const outed    = allEquip.filter(e => e.status === 'out'    && (!siteId || e.siteId === siteId));
  const sites    = getSites();
  // 현장 프로젝트 목록 (수동 등록 폼 용)
  const siteProjects = siteId
    ? (sites.find(s=>s.id===siteId)?.projects || [])
    : [...new Set(sites.flatMap(s=>s.projects||[]))];

  // 업체별 그룹
  const byCompany = {};
  for (const e of active) {
    if (!byCompany[e.company]) byCompany[e.company] = [];
    byCompany[e.company].push(e);
  }

  const coHtml = Object.entries(byCompany).map(([co, list]) => `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:800;color:var(--blue);margin-bottom:4px;padding:4px 8px;background:rgba(59,130,246,.08);border-radius:6px">${co} (${list.length}대)</div>
      ${list.map(e => {
        const _eProjs = getSites().find(s=>s.id===e.siteId)?.projects||[];
        const _allProjs = (e.project && !_eProjs.includes(e.project)) ? [..._eProjs, e.project] : _eProjs;
        const _projEl = _allProjs.length
          ? `<select style="font-size:9px;padding:2px 5px;max-width:72px;border-radius:4px;border:1px solid var(--br);background:var(--bg2);color:${e.project?'#14b8a6':'var(--tx3)'}" onchange="_equipSetProject('${e.id}',this.value)"><option value="">구분없음</option>${_allProjs.map(p=>`<option value="${p}"${e.project===p?' selected':''}>${p}</option>`).join('')}</select>`
          : (e.project?`<span style="font-size:9px;padding:2px 5px;background:rgba(20,184,166,.1);border-radius:4px;color:#14b8a6">${e.project}</span>`:'');
        const _pendingBadge = e.pendingApproval
          ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3);margin-left:4px">⏳승인대기</span>`
          : '';
        const _approveBtn = (e.pendingApproval && isAJ)
          ? `<button onclick="_approveEquipEntry('${e.id}')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#4ade80;cursor:pointer">✅승인</button>`
          : '';
        const _eModels = EQUIP_MODELS[e.spec] || [];
        const _allModels = (e.model && !_eModels.includes(e.model)) ? [..._eModels, e.model] : _eModels;
        const _modelEl = `<select style="font-size:9px;padding:2px 5px;max-width:72px;border-radius:4px;border:1px solid var(--br);background:var(--bg2);color:${e.model?'#a78bfa':'var(--tx3)'}" onchange="_equipSetModel('${e.id}',this.value)"><option value="">모델(선택)</option>${_allModels.map(m=>`<option value="${m}"${e.model===m?' selected':''}>${m}</option>`).join('')}</select>`;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--br)">
          <div style="flex:1;min-width:0">
            <span style="font-family:monospace;font-weight:700;font-size:12px;color:#60a5fa">${e.equipNo}</span>
            ${e.spec?`<span style="font-size:10px;color:var(--tx3);margin-left:5px">${e.spec}</span>`:''}
            ${e.serialNo?`<span style="font-size:9px;color:var(--tx3);margin-left:5px;font-family:monospace">S/N:${e.serialNo}</span>`:''}
            ${_pendingBadge}
          </div>
          ${_modelEl}
          ${_projEl}
          <span style="font-size:10px;color:var(--tx3)">${e.inDate||''}</span>
          ${_approveBtn}
          <button onclick="_equipMasterEdit('${e.id}')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.3);color:#a78bfa;cursor:pointer">수정</button>
          <button onclick="_equipMasterOut('${e.id}')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(251,146,60,.12);border:1px solid rgba(251,146,60,.3);color:#fb923c;cursor:pointer">반출처리</button>
          <button onclick="_equipMasterDel('${e.id}')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);color:#f87171;cursor:pointer">삭제</button>
        </div>`;
      }).join('')}
    </div>`).join('') || '<div style="color:var(--tx3);font-size:12px;padding:8px">등록된 반입 장비 없음</div>';

  sh.innerHTML = `<div class="sheet">
    <div class="sh-handle"></div>
    <div class="sh-title">🏗 가동 장비 내역 (${active.length}대)</div>
    <div style="padding:4px 4px 0;display:flex;gap:6px;margin-bottom:8px">
      <button onclick="_equipSyncFromSB()" style="flex:1;padding:6px 10px;font-size:11px;font-weight:700;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);border-radius:7px;color:#4ade80;cursor:pointer">☁️ Supabase에서 불러오기</button>
      <button onclick="_equipSyncToSB()" style="flex:1;padding:6px 10px;font-size:11px;font-weight:700;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);border-radius:7px;color:#60a5fa;cursor:pointer">⬆️ Supabase에 저장</button>
    </div>
    <div style="padding:0 4px 8px">

      <!-- 일괄 CSV/엑셀 등록 -->
      <details style="margin-bottom:12px">
        <summary style="font-size:11px;font-weight:700;color:var(--tx3);cursor:pointer;padding:6px 8px;background:var(--bg2);border-radius:6px;user-select:none">📋 CSV / 엑셀 일괄 등록</summary>
        <div style="padding:8px 4px 4px">
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button onclick="_equipExcelDownload()" style="flex:1;padding:6px 8px;font-size:11px;font-weight:700;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:6px;color:#4ade80;cursor:pointer">📥 양식 다운</button>
            <label style="flex:1;display:flex;align-items:center;justify-content:center;padding:6px 8px;font-size:11px;font-weight:700;background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.3);border-radius:6px;color:#a78bfa;cursor:pointer">
              📊 엑셀 파일로 등록
              <input type="file" accept=".xlsx,.xls" style="display:none" onchange="_equipExcelImport(this)">
            </label>
          </div>
          <div style="font-size:10px;color:var(--tx3);margin-bottom:6px">CSV 직접 입력: <code style="background:rgba(59,130,246,.1);padding:1px 5px;border-radius:3px">현장명,프로젝트명,업체명,장비제원,모델명,장비번호,반입일</code><br>예) P4복합동,Ph2,AJ네트웍스,10M,GS2636,GF123,2026-03-01</div>
          <textarea id="eq-csv-input" rows="4" placeholder="P4복합동,Ph2,AJ네트웍스,10M,GS2636,GF123,2026-03-01" style="width:100%;padding:8px;font-size:12px;font-family:monospace;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx);resize:vertical;box-sizing:border-box"></textarea>
          <button onclick="_equipMasterBulkAdd()" style="width:100%;margin-top:6px;padding:7px;font-size:12px;font-weight:700;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:6px;color:#60a5fa;cursor:pointer">CSV 일괄 등록</button>
        </div>
      </details>

      <!-- 반입 등록 (아코디언) -->
      <details style="margin-bottom:10px">
        <summary style="font-size:11px;font-weight:700;color:var(--blue);cursor:pointer;padding:8px 10px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);border-radius:10px;user-select:none;list-style:none;display:flex;align-items:center;justify-content:space-between">
          <span>➕ 반입 등록${!isAJ?' <span style="font-size:9px;color:#f59e0b;font-weight:400">(AJ관리자 승인 후 반영)</span>':''}</span>
          <span style="font-size:10px;color:var(--tx3)">▼</span>
        </summary>
        <div style="background:rgba(59,130,246,.04);border:1px solid rgba(59,130,246,.12);border-top:none;border-radius:0 0 10px 10px;padding:10px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <input type="text" id="eq-add-no" placeholder="장비번호 * (예: GK228)" style="text-transform:uppercase;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            <input type="text" id="eq-add-co" placeholder="업체명 *" value="${esc(S?.company||'')}" style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <input type="text" id="eq-add-serial" placeholder="시리얼번호 (선택)" style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            <select id="eq-add-model" style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx3)">
              <option value="">모델명 (선택)</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <select id="eq-add-spec" onchange="_equipUpdateModelOptions(this.value)" style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
              <option value="">장비제원 선택 *</option>
              ${TR_SPECS.map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="date" id="eq-add-indate" value="${today()}" style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
          </div>
          ${S?.siteId === 'all' ? `<select id="eq-add-site" style="width:100%;margin-bottom:6px;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            ${sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
          </select>` : `<input type="hidden" id="eq-add-site" value="${siteId||''}">`}
          ${siteProjects.length ? `<select id="eq-add-proj" style="width:100%;margin-bottom:6px;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)"><option value="">프로젝트 구분 (선택)</option>${siteProjects.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>` : `<input type="hidden" id="eq-add-proj" value="">`}
          <button id="eq-add-btn" onclick="_equipMasterAdd()" style="width:100%;padding:8px;font-size:12px;font-weight:700;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:6px;color:#60a5fa;cursor:pointer">${isAJ?'반입 등록':'반입 등록 요청'}</button>
        </div>
      </details>

      <!-- 반출 처리 (아코디언) -->
      <details style="margin-bottom:12px">
        <summary style="font-size:11px;font-weight:700;color:#fb923c;cursor:pointer;padding:8px 10px;background:rgba(251,146,60,.06);border:1px solid rgba(251,146,60,.15);border-radius:10px;user-select:none;list-style:none;display:flex;align-items:center;justify-content:space-between">
          <span>➖ 반출 처리${!isAJ?' <span style="font-size:9px;color:#f59e0b;font-weight:400">(AJ관리자 승인 후 반영)</span>':''}</span>
          <span style="font-size:10px;color:var(--tx3)">▼</span>
        </summary>
        <div style="background:rgba(251,146,60,.04);border:1px solid rgba(251,146,60,.12);border-top:none;border-radius:0 0 10px 10px;padding:10px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <input type="text" id="eq-out-no" placeholder="장비번호 검색 *" autocomplete="off"
              style="text-transform:uppercase;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            <input type="date" id="eq-out-date" value="${today()}"
              style="padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
          </div>
          <button id="eq-out-btn" onclick="_equipMasterOutByNo()" style="width:100%;padding:8px;font-size:12px;font-weight:700;background:rgba(251,146,60,.15);border:1px solid rgba(251,146,60,.3);border-radius:6px;color:#fb923c;cursor:pointer">${isAJ?'반출 처리':'반출 요청'}</button>
        </div>
      </details>

      <!-- 현재 반입 장비 목록 -->
      <div style="font-size:11px;font-weight:800;margin-bottom:6px">현재 반입 중 (${active.length}대)</div>
      ${coHtml}

      ${outed.length ? `<div style="margin-top:12px">
        <div style="font-size:11px;font-weight:800;color:var(--tx3);margin-bottom:4px">반출 처리된 장비 (${outed.length}대)</div>
        ${outed.slice(0,10).map(e=>`
          <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--br);opacity:.6">
            <span style="font-family:monospace;font-size:11px;flex:1">${e.equipNo}</span>
            <span style="font-size:10px;color:var(--tx3)">${e.company}</span>
            <span style="font-size:10px;color:var(--tx3)">${e.outDate||''}</span>
            <button onclick="_equipMasterReactivate('${e.id}')" style="font-size:9px;padding:2px 8px;border-radius:4px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);color:#4ade80;cursor:pointer">재반입</button>
          </div>`).join('')}
      </div>` : ''}
    </div>
    <div style="padding:4px 4px 8px">
      <button class="btn-ghost" onclick="closeSheet('sh-equip-master')">닫기</button>
    </div>
  </div>`;
  // 반출 폼 장비번호 자동완성 설정
  setTimeout(()=>{
    const outInp = document.getElementById('eq-out-no');
    if (outInp && !outInp._acSetup) {
      setupEquipAutocomplete('eq-out-no',{
        siteIdFn:()=>S?.siteId==='all'?null:S?.siteId,
      });
    }
  }, 50);
}

// 장비 마스터 Supabase 동기화 함수들
async function _equipSyncFromSB() {
  toast('Supabase에서 불러오는 중...', 'info');
  const n = await loadEquipFromSupabase();
  if (n == null) { toast('Supabase 설정을 확인하세요', 'err'); return; }
  _cache.equipment = null;
  toast(`장비 ${n}대 불러오기 완료`, 'ok');
  openEquipMasterSheet(); // 시트 새로고침
}

async function _equipSyncToSB() {
  const arr = getEquipMaster();
  if (!arr.length) { toast('등록된 장비가 없습니다', 'warn'); return; }
  const sbUrl = DB.g(K.SB_URL,'');
  if (!sbUrl) { toast('Supabase 설정이 필요합니다', 'err'); return; }
  // 전체를 unsynced로 표시 후 syncNow
  arr.forEach(e => e.synced = false);
  await saveEquipMaster(arr);
  await syncNow();
  toast(`장비 ${arr.length}대 Supabase 저장 완료`, 'ok');
}

async function _equipMasterBulkAdd() {
  const raw = document.getElementById('eq-csv-input')?.value.trim();
  if (!raw) { toast('CSV 내용을 입력하세요', 'err'); return; }
  const siteId = S?.siteId === 'all'
    ? (document.getElementById('eq-add-site')?.value || '')
    : (S?.siteId || '');
  const siteName = getSites().find(s => s.id === siteId)?.name || siteId;
  const arr = getEquipMaster();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let added = 0, duped = 0;
  const errLines = []; // M7: 어떤 행이 오류인지 추적
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const parts = line.split(/,|\t/).map(p => p.trim());
    // 7열 신규: 현장명,프로젝트명,업체명,장비제원,모델명,장비번호,반입일
    // 6열 구형식: 현장명,프로젝트명,업체명,장비제원,장비번호,반입일
    // 구형식1: 업체명,장비제원,장비번호,반입일[,프로젝트]
    // 구형식2: 업체명,장비번호
    let company, spec, equipNo, inDate, project, model, effectiveSiteId, effectiveSiteName;
    if (parts.length >= 7) {
      // 7열 신규: 현장명,프로젝트명,업체명,장비제원,모델명,장비번호,반입일
      const _csvSite = getSites().find(s=>s.name===parts[0]||s.id===parts[0]);
      effectiveSiteId   = _csvSite?.id   || siteId;
      effectiveSiteName = _csvSite?.name || siteName;
      project = parts[1]; company = parts[2]; spec = parts[3]; model = _nh(parts[4]);
      equipNo = _nh((parts[5]||'').toUpperCase()); inDate = parts[6] || today();
    } else if (parts.length >= 5 && !/^\d{4}-/.test(parts[3]) && /^\d{4}-/.test(parts[5]||'x')) {
      // 6열 구형식: 현장명,프로젝트명,업체명,장비제원,장비번호,반입일
      const _csvSite = getSites().find(s=>s.name===parts[0]||s.id===parts[0]);
      effectiveSiteId   = _csvSite?.id   || siteId;
      effectiveSiteName = _csvSite?.name || siteName;
      project = parts[1]; company = parts[2]; spec = parts[3];
      equipNo = _nh((parts[4]||'').toUpperCase()); inDate = parts[5] || today();
    } else if (parts.length >= 3 && parts[2] && !/^\d{4}-/.test(parts[1])) {
      // 구형식1: 업체명,장비제원,장비번호[,반입일,프로젝트]
      company = parts[0]; spec = parts[1]; equipNo = _nh((parts[2]||'').toUpperCase());
      inDate  = parts[3] || today(); project = parts[4] || '';
      effectiveSiteId = siteId; effectiveSiteName = siteName;
    } else {
      // 구형식2: 업체명,장비번호
      company = parts[0]; spec = ''; equipNo = _nh((parts[1]||'').toUpperCase());
      inDate  = today(); project = '';
      effectiveSiteId = siteId; effectiveSiteName = siteName;
    }
    if (!company || !equipNo) { errLines.push(`${li+1}행: "${line.slice(0,30)}"`); continue; }
    const exists = arr.find(e => e.equipNo === equipNo && e.siteId === effectiveSiteId);
    if (exists) {
      if (exists.status !== 'active') {
        exists.status = 'active'; exists.inDate = inDate; exists.outDate = null;
        if (spec) exists.spec = spec; if (project) exists.project = project; if (model) exists.model = model;
        exists.synced = false; added++;
      } else { duped++; }
    } else {
      arr.push({
        id: 'eq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5),
        equipNo, siteId: effectiveSiteId, siteName: effectiveSiteName, company, spec, model: model||'', project,
        specs: [], transitId: null, status: 'active', inDate, outDate: null, synced: false,
      });
      added++;
    }
  }
  await saveEquipMaster(arr);
  if(added > 0) _syncToSupabase().catch(e=>console.warn('[equip csv sync]',e));
  // M7: 오류 행 상세 안내
  if(errLines.length){
    const errMsg = `오류 ${errLines.length}행 (업체명·장비번호 필수):\n` + errLines.slice(0,5).join('\n') + (errLines.length>5?`\n외 ${errLines.length-5}행`:'');
    toast(errMsg, 'warn', 8000);
  }
  toast(`${added}대 등록 완료${duped ? ' · ' + duped + '대 이미 존재' : ''}${errLines.length ? ' · ' + errLines.length + '행 오류' : ''}`, added > 0 ? 'ok' : 'warn');
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

function _equipExcelDownload() {
  if (typeof XLSX === 'undefined') { toast('엑셀 라이브러리 로딩 중... 잠시 후 다시 시도하세요', 'warn'); return; }
  const ws = XLSX.utils.aoa_to_sheet([
    ['현장명','프로젝트명','업체명','장비제원','모델명','장비번호','반입일'],
    ['P4복합동','Ph2','AJ네트웍스','10M','GS2636','GF123', today()],
  ]);
  ws['!cols'] = [{wch:14},{wch:10},{wch:16},{wch:8},{wch:10},{wch:10},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '장비목록');
  XLSX.writeFile(wb, '장비등록양식.xlsx');
}

async function _equipExcelImport(input) {
  if (typeof XLSX === 'undefined') { toast('엑셀 라이브러리 로딩 중... 잠시 후 다시 시도하세요', 'warn'); input.value=''; return; }
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      // 첫 행이 헤더("현장명")이면 제외
      const dataRows = String(rows[0]?.[0]).trim() === '현장명' ? rows.slice(1) : rows;
      const csv = dataRows
        .filter(r => r.some(c => String(c).trim()))
        .map(r => r.slice(0, 7).map(c => {
          // 날짜: Excel 시리얼 숫자 → YYYY-MM-DD (epoch: 1899-12-30)
          if (typeof c === 'number' && c > 40000) {
            const dt = new Date(Math.round((c - 25569) * 86400000));
            const y = dt.getUTCFullYear();
            const mo = String(dt.getUTCMonth()+1).padStart(2,'0');
            const d  = String(dt.getUTCDate()).padStart(2,'0');
            return `${y}-${mo}-${d}`;
          }
          return String(c).trim();
        }).join(','))
        .join('\n');
      const ta = document.getElementById('eq-csv-input');
      if (ta) { ta.value = csv; await _equipMasterBulkAdd(); }
    } catch(err) {
      toast('엑셀 파일 읽기 오류: ' + err.message, 'err');
    }
    input.value = '';
  };
  reader.readAsBinaryString(file);
}

async function _equipMasterAdd() {
  const no       = _nh(document.getElementById('eq-add-no')?.value.toUpperCase());
  const co       = document.getElementById('eq-add-co')?.value.trim();
  const spec     = document.getElementById('eq-add-spec')?.value.trim();
  const inDate   = document.getElementById('eq-add-indate')?.value || today();
  const serialNo = document.getElementById('eq-add-serial')?.value.trim() || '';
  const model    = _nh(document.getElementById('eq-add-model')?.value);
  const si       = document.getElementById('eq-add-site')?.value || (S?.siteId === 'all' ? '' : S?.siteId);
  const proj     = document.getElementById('eq-add-proj')?.value || '';
  if (!no)   { toast('장비번호를 입력하세요', 'err'); return; }
  if (!co)   { toast('업체명을 입력하세요', 'err'); return; }
  if (!spec) { toast('장비 제원을 선택하세요', 'err'); return; }
  const arr = getEquipMaster();
  const exists = arr.find(e => e.equipNo === no && e.siteId === si);
  if (exists) {
    if (exists.status !== 'active') {
      exists.status  = 'active';
      exists.spec    = spec;
      exists.inDate  = inDate;
      exists.outDate = null;
      if (proj) exists.project = proj;
      if (serialNo) exists.serialNo = serialNo;
      if (model) exists.model = model;
      exists.synced  = false;
      await saveEquipMaster(arr);
      toast(`${no} 재반입 처리됨`, 'ok');
    } else {
      toast(`${no} 이미 등록되어 있습니다`, 'warn');
      return;
    }
  } else {
    const _needsApproval = S?.role !== 'aj';
    arr.push({
      id: 'eq-' + Date.now().toString(36),
      equipNo: no, serialNo, model, siteId: si,
      siteName: getSites().find(s=>s.id===si)?.name || si,
      company: co, spec: spec, project: proj, specs: [], transitId: null,
      status: 'active', inDate: inDate, outDate: null, synced: false,
      pendingApproval: _needsApproval,
      submitterMemberId: S?.memberId || '',
    });
    await saveEquipMaster(arr);
    if (_needsApproval) {
      pushSBNotif({target_aj_type:'관리자', type:'equip_add_request', title:`⏳ 반입 승인요청: ${no}`, body:`${co} · ${spec} · ${inDate}`, ref_id:no, site_id:si}).catch(()=>{});
      toast(`${no} 반입 등록 요청됨 (AJ관리자 승인 대기)`, 'warn');
    } else {
      toast(`${no} 반입 등록 완료`, 'ok');
    }
  }
  // 저장완료 버튼 상태 표시 후 1.2초 뒤 재렌더
  const btn = document.getElementById('eq-add-btn');
  if (btn) {
    btn.textContent = '✅ 저장완료';
    btn.style.background = 'rgba(34,197,94,.15)';
    btn.style.borderColor = 'rgba(34,197,94,.3)';
    btn.style.color = '#4ade80';
    btn.disabled = true;
  }
  setTimeout(() => {
    const sh = document.getElementById('sh-equip-master');
    if (sh) _renderEquipMasterSheet(sh);
  }, 1200);
}

async function _equipSetProject(id, project) {
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.project = project;
  await saveEquipMaster(arr);
  toast(e.equipNo + ' 프로젝트: ' + (project || '없음'), 'ok');
}

async function _equipSetModel(id, model) {
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.model = model; e.synced = false;
  await saveEquipMaster(arr);
  toast(e.equipNo + ' 모델: ' + (model || '없음'), 'ok');
}

function _equipMasterEdit(id) {
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  const existing = document.getElementById('_equip-edit-pop');
  if (existing) existing.remove();
  const sites = getSites();
  const pop = document.createElement('div');
  pop.id = '_equip-edit-pop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;display:flex;align-items:flex-end;justify-content:center;padding-bottom:env(safe-area-inset-bottom,0px)';
  const _models = EQUIP_MODELS[e.spec] || [];
  const _allM = (e.model && !_models.includes(e.model)) ? [..._models, e.model] : _models;
  const _siteProjs = sites.find(s=>s.id===e.siteId)?.projects || [];
  const _allP = (e.project && !_siteProjs.includes(e.project)) ? [..._siteProjs, e.project] : _siteProjs;
  pop.innerHTML = `
    <div style="width:100%;max-width:500px;background:var(--bg1);border-radius:16px 16px 0 0;padding:20px 16px 24px;box-sizing:border-box">
      <div style="font-size:13px;font-weight:800;margin-bottom:14px;color:var(--tx)">✏️ 장비 수정 — ${e.equipNo}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">장비번호</div>
          <input id="_ee-no" value="${e.equipNo||''}" style="width:100%;box-sizing:border-box;text-transform:uppercase;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)"></div>
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">업체명</div>
          <input id="_ee-co" value="${esc(e.company||'')}" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">장비제원</div>
          <select id="_ee-spec" style="width:100%;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)" onchange="(()=>{const m=document.getElementById('_ee-model');const ms=EQUIP_MODELS[this.value]||[];m.innerHTML='<option value=\\'\\'>모델(선택)</option>'+ms.map(x=>'<option value=\\''+x+'\\'>' +x+'</option>').join('')})()">
            <option value="">제원 선택</option>${TR_SPECS.map(s=>`<option value="${s}"${e.spec===s?' selected':''}>${s}</option>`).join('')}</select></div>
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">모델명</div>
          <select id="_ee-model" style="width:100%;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            <option value="">모델(선택)</option>${_allM.map(m=>`<option value="${m}"${e.model===m?' selected':''}>${m}</option>`).join('')}</select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">반입일</div>
          <input id="_ee-indate" type="date" value="${e.inDate||today()}" style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)"></div>
        <div><div style="font-size:10px;color:var(--tx3);margin-bottom:3px">프로젝트</div>
          <select id="_ee-proj" style="width:100%;padding:7px 10px;font-size:12px;border:1px solid var(--br);border-radius:6px;background:var(--bg2);color:var(--tx)">
            <option value="">구분없음</option>${_allP.map(p=>`<option value="${p}"${e.project===p?' selected':''}>${p}</option>`).join('')}</select></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('_equip-edit-pop').remove()"
          style="flex:1;padding:10px;font-size:13px;font-weight:700;background:var(--bg2);border:1px solid var(--br);border-radius:var(--rs);color:var(--tx2);cursor:pointer">취소</button>
        <button id="_ee-save"
          style="flex:2;padding:10px;font-size:13px;font-weight:800;background:rgba(167,139,250,.18);border:1px solid rgba(167,139,250,.4);border-radius:var(--rs);color:#a78bfa;cursor:pointer">저장</button>
      </div>
    </div>`;
  pop.querySelector('#_ee-save').addEventListener('click', async () => {
    const arr2 = getEquipMaster();
    const e2 = arr2.find(x => x.id === id);
    if (!e2) return;
    e2.equipNo  = _nh(pop.querySelector('#_ee-no').value.toUpperCase()) || e2.equipNo;
    e2.company  = pop.querySelector('#_ee-co').value.trim() || e2.company;
    e2.spec     = pop.querySelector('#_ee-spec').value || e2.spec;
    e2.model    = _nh(pop.querySelector('#_ee-model').value);
    e2.inDate   = pop.querySelector('#_ee-indate').value || e2.inDate;
    e2.project  = pop.querySelector('#_ee-proj').value;
    e2.synced   = false;
    await saveEquipMaster(arr2);
    pop.remove();
    toast(e2.equipNo + ' 수정 완료', 'ok');
    const sh = document.getElementById('sh-equip-master');
    if (sh) _renderEquipMasterSheet(sh);
  });
  pop.addEventListener('click', ev => { if (ev.target === pop) pop.remove(); });
  document.body.appendChild(pop);
}

async function _equipMasterOut(id) {
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  const _needsApproval = S?.role !== 'aj';
  if (_needsApproval) {
    e.pendingApproval = true;
    e.pendingOut = true;
    e.submitterMemberId = S?.memberId || '';
    e.synced = false;
    await saveEquipMaster(arr);
    pushSBNotif({target_aj_type:'관리자', type:'equip_out_request', title:`⏳ 반출 승인요청: ${e.equipNo}`, body:`${e.company} · ${e.spec||''}`, ref_id:e.id, site_id:e.siteId}).catch(()=>{});
    toast(`${e.equipNo} 반출 요청됨 (AJ관리자 승인 대기)`, 'warn');
  } else {
    e.status  = 'out';
    e.outDate = today();
    e.synced  = false;
    await saveEquipMaster(arr);
    toast(`${e.equipNo} 반출 처리됨`, 'ok');
  }
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

// 반출 처리 폼 — 장비번호 검색으로 반출 처리
async function _equipMasterOutByNo() {
  const no      = _nh(document.getElementById('eq-out-no')?.value.toUpperCase());
  const outDate = document.getElementById('eq-out-date')?.value || today();
  if (!no) { toast('장비번호를 입력하세요', 'err'); return; }
  const siteId = S?.siteId === 'all' ? null : S?.siteId;
  const arr = getEquipMaster();
  const e = arr.find(x => x.equipNo === no && x.status === 'active' && (!siteId || x.siteId === siteId));
  if (!e) { toast(`${no}: 반입 중인 장비를 찾을 수 없습니다`, 'warn'); return; }
  const _needsApproval = S?.role !== 'aj';
  if (_needsApproval) {
    e.pendingApproval = true;
    e.pendingOut = true;
    e.submitterMemberId = S?.memberId || '';
    e.synced = false;
    await saveEquipMaster(arr);
    pushSBNotif({target_aj_type:'관리자', type:'equip_out_request', title:`⏳ 반출 승인요청: ${no}`, body:`${e.company} · ${e.spec||''} · ${outDate}`, ref_id:e.id, site_id:e.siteId}).catch(()=>{});
    toast(`${no} 반출 요청됨 (AJ관리자 승인 대기)`, 'warn');
  } else {
    e.status  = 'out';
    e.outDate = outDate;
    e.synced  = false;
    await saveEquipMaster(arr);
    toast(`${no} 반출 처리됨 (${outDate})`, 'ok');
  }
  const inp = document.getElementById('eq-out-no'); if (inp) inp.value = '';
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

async function _equipMasterReactivate(id) {
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.status  = 'active';
  e.inDate  = today();
  e.outDate = null;
  await saveEquipMaster(arr);
  toast(`${e.equipNo} 재반입 처리됨`, 'ok');
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

async function _equipMasterDel(id) {
  if (!confirm('장비 마스터에서 삭제하시겠습니까?')) return;
  let arr = getEquipMaster();
  arr = arr.filter(e => e.id !== id);
  await saveEquipMaster(arr);
  toast('삭제됨', 'ok');
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

// 반입/반출 승인요청 처리 (AJ관리자 전용)
async function _approveEquipEntry(id) {
  if (S?.role !== 'aj') { toast('AJ관리자 권한 필요', 'err'); return; }
  const arr = getEquipMaster();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  if (e.pendingOut) {
    // 반출 요청 승인
    e.status  = 'out';
    e.outDate = e.outDate || today();
  }
  e.pendingApproval = false;
  e.pendingOut = false;
  e.synced = false;
  await saveEquipMaster(arr);
  // 요청자에게 승인 알림
  if (e.submitterMemberId) {
    pushSBNotif({target_user_id:e.submitterMemberId, type:'equip_approved',
      title:`✅ ${e.pendingOut?'반출':'반입'} 승인: ${e.equipNo}`,
      body:`${e.company} · ${e.spec||''}`, ref_id:e.id, site_id:e.siteId}).catch(()=>{});
  }
  toast(`${e.equipNo} 승인 완료`, 'ok');
  const sh = document.getElementById('sh-equip-master');
  if (sh) _renderEquipMasterSheet(sh);
}

function saveMyProfile(){
  const name  = document.getElementById('prof-name')?.value.trim();
  const phone = document.getElementById('prof-phone')?.value.trim() || '';
  const title = document.getElementById('prof-title')?.value.trim() || '';
  if(!name){ toast('이름을 입력하세요','err'); return; }
  S.name = name; S.phone = phone;
  if(S.role==='sub') S.title = title;
  DB.s(K.SESSION, S);
  // 멤버 목록 업데이트
  const members = getMembers();
  const mIdx = members.findIndex(m=>m.company===S.company&&m.siteId===S.siteId&&(m.name===name||m.phone===phone));
  if(mIdx>=0){
    members[mIdx] = {...members[mIdx], name, phone, title:title||members[mIdx].title, synced:false};
    saveMembers(members);
    if(members[mIdx].id){
      const _sm=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
      sbReq('members','PATCH',{name,phone,title:title||''},`?record_id=eq.${encodeURIComponent(members[mIdx].id)}`).catch(()=>{});
    }
  }
  toast('내 정보가 저장되었습니다','ok');
  renderAdmin();
}

async function openMemberMgr(){
  // 서버에서 최신 sub 멤버 목록 pull
  try {
    const sbUrl=DB.g(K.SB_URL,'');
    if(sbUrl && S){
      const siteId2=S?.siteId==='all'?null:S?.siteId;
      const siteFilter=siteId2?`&site_id=eq.${encodeURIComponent(siteId2)}`:'';
      const rows=await sbReq('members','GET',null,`?role=eq.sub${siteFilter}&order=joined_at.desc&limit=300`);
      if(Array.isArray(rows)&&rows.length){
        const allMembers=getMembers();
        const allMap=new Map(allMembers.map(m=>[m.id,m]));
        for(const row of rows){
          const id=row.record_id||String(row.id);
          allMap.set(id,{
            id, name:row.name||'', company:row.company||'', siteId:row.site_id||'',
            siteName:row.site_name||'', phone:row.phone||'', title:row.title||'',
            role:'sub', status:row.status||'approved',
            google_email:row.google_email||'',
            joinedAt:row.joined_at?new Date(row.joined_at).getTime():0,
            synced:true
          });
        }
        saveMembers([...allMap.values()]);
      }
    }
  } catch(e){ console.warn('[openMemberMgr] SB pull 실패:',e); }

  const siteId=S?.siteId==='all'?null:S?.siteId;
  const subMembers=getMembers().filter(m=>
    (m.role==='sub'||(!m.role&&m.title!=='기술인'))&&
    (!siteId||m.siteId===siteId)
  );
  const pendingCnt=subMembers.filter(m=>(m.status||'approved')==='pending').length;
  const statusLabel={pending:'대기중',approved:'승인됨',rejected:'거절됨'};
  let html=`<div style="padding:14px">
    <div class="shd"><span class="shd-title">협력사 관리자 목록 (${subMembers.length}명)${pendingCnt?` <span class="mbr-badge pending">대기 ${pendingCnt}건</span>`:''}</span></div>
    ${subMembers.length===0?'<div class="empty"><div class="empty-txt">가입된 관리자 없음</div></div>':
      subMembers.sort((a,b)=>{const sa=(a.status||'approved')==='pending'?0:1,sb=(b.status||'approved')==='pending'?0:1;return sa-sb;}).map((m,i)=>{
        const st=m.status||'approved'; const isPending=st==='pending';
        return `<div class="lcard" style="padding:12px;${isPending?'border-color:rgba(245,158,11,.3)':''}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span class="mbr-badge ${st}">${statusLabel[st]||st}</span>
              <span style="font-size:13px;font-weight:700">${m.name}</span>
            </div>
            <div style="font-size:11px;color:var(--tx2)">${m.company} · ${getSites().find(s=>s.id===m.siteId)?.name||m.siteId}</div>
            <div style="font-size:10px;color:var(--tx3);margin-top:2px">가입: ${new Date(m.joinedAt).toLocaleDateString('ko-KR')}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            ${isPending?`<button onclick="approveMember('${m.id}');openMemberMgr()" style="font-size:10px;padding:3px 8px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);border-radius:5px;color:#4ade80;cursor:pointer;font-weight:700">승인</button>`:''}
            <button class="btn-ghost" style="font-size:10px;padding:4px 8px;color:#f87171;border-color:rgba(239,68,68,.3)"
              onclick="deleteAcctSubMemberId('${m.id}');openMemberMgr()">탈퇴처리</button>
          </div>
        </div>
      </div>`;}).join('')
    }
  </div>`;
  document.getElementById('adm-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:14px 14px 0">
      <button class="btn-ghost" style="padding:6px 12px;font-size:11px" onclick="renderAdmin()">← 뒤로</button>
      <div style="font-size:14px;font-weight:800">협력사 관리자 목록</div>
    </div>` + html;
}

function deleteMember(idx){
  // 하위 호환용 (idx 기반 호출 처리)
  const members=getMembers();
  const m=members[idx]; if(!m) return;
  if(m.id) deleteAcctSubMemberId(m.id);
  else {
    if(!confirm(`${m?.company} ${m?.name}님의 계정을 탈퇴 처리할까요?`)) return;
    members.splice(idx,1); saveMembers(members);
    toast('탈퇴 처리되었습니다','ok'); openMemberMgr();
  }
}

function openASList(){
  const siteId=S?.siteId==='all'?null:S?.siteId;
  const reqs=getAsReqs().filter(r=>!siteId||r.siteId===siteId);
  document.getElementById('adm-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:14px 14px 0">
      <button class="btn-ghost" style="padding:6px 12px;font-size:11px" onclick="renderAdmin()">← 뒤로</button>
      <div style="font-size:14px;font-weight:800">AS 요청 목록</div>
    </div>
    <div style="padding:14px">
    ${reqs.length===0?'<div class="empty"><div class="empty-txt">AS 요청 없음</div></div>':
      reqs.map((r,i)=>`
      <div class="lcard">
        <div class="lc-top">
          <div class="lc-co">
            <div class="lc-dot" style="background:#dc2626"></div>
            <div class="lc-name">${r.company}</div>
            <span style="font-size:9px;padding:1px 5px;border-radius:4px;margin-left:5px;
              background:${r.status==='완료'?'rgba(34,197,94,.15)':'rgba(220,38,38,.15)'};
              color:${r.status==='완료'?'#4ade80':'#f87171'};font-weight:800">${r.status}</span>
          </div>
          <div class="lc-time">${fmtDate(r.date)}</div>
        </div>
        <div class="lc-grid">
          <div class="lc-item">장비: <span>${r.equip}</span></div>
          <div class="lc-item">유형: <span>${r.type}</span></div>
          <div class="lc-item">신청자: <span>${r.reporter}</span></div>
          ${r.desc?`<div class="lc-item" style="grid-column:1/-1">내용: <span>${r.desc}</span></div>`:''}
        </div>
        ${r.status!=='완료'?`<button class="btn-ghost" style="font-size:10px;padding:4px 10px;margin-top:6px;color:var(--green);border-color:rgba(34,197,94,.3)"
          onclick="resolveAS(${i})">완료 처리</button>`:''}
      </div>`).join('')
    }
    </div>`;
}

function openSubEquipSheet(){
  const siteId=S.siteId;
  const cos=getCos(siteId);
  const co=cos.find(c=>c.name===S.company);
  if(!co){ toast('업체 정보를 찾을 수 없습니다','err'); return; }
  const inp=prompt(`${S.company} 장비 대수를 입력하세요 (현재: ${co.equip}대)`,''+co.equip);
  if(inp===null) return;
  const n=parseInt(inp);
  if(isNaN(n)||n<0){ toast('올바른 숫자를 입력하세요','err'); return; }
  const allCos=DB.g(K.COS,{})||{};
  if(!allCos[siteId]) allCos[siteId]=getCos(siteId).slice();
  const idx=allCos[siteId].findIndex(c=>c.name===S.company);
  if(idx>=0) allCos[siteId][idx].equip=n;
  saveCos(allCos);
  toast(`${S.company} 장비 대수를 ${n}대로 변경했습니다`,'ok');
  renderAdmin();
}

/* Sites/Companies management */
async function _openSiteMgr(){
  closeSheet('sh-admin-hub');
  setTimeout(()=>openSheet('sh-sites'), 60);
  renderSiteMgr();
  try {
    await _pullSitesFromSB();
    renderSiteMgr();
  } catch(_e){}
}

async function _openCoMgr(){
  closeSheet('sh-admin-hub');
  setTimeout(()=>openSheet('sh-company'), 60);
  renderCoMgr();
  try {
    await Promise.all([_pullSitesFromSB(), _pullCosFromSB()]);
    renderCoMgr();
  } catch(_e){}
}

function renderSiteMgr(){
  const sites=getSites();
  document.getElementById('site-mgr-list').innerHTML=sites.map((s)=>{
    const projStr=(s.projects||[]).join(', ');
    return `
    <div class="site-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px 12px">
      <div style="display:flex;align-items:center">
        <div class="site-row-info" style="flex:1"><div class="site-row-name">${s.name}</div><div class="site-row-meta">업체 ${getCos(s.id).length}개</div></div>
        <div class="site-del" onclick="deleteSite('${s.id}')">×</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" class="lg-input" id="proj-input-${s.id}" value="${projStr}"
          placeholder="프로젝트 (쉼표 구분: Ph.2, Ph.4)"
          style="flex:0 0 calc(85% - 3px);font-size:11px;padding:5px 8px">
        <button class="btn-ghost" style="flex:0 0 calc(15% - 3px);font-size:11px;padding:5px 0;white-space:nowrap"
          onclick="saveProjects('${s.id}')">저장</button>
      </div>
    </div>`;
  }).join('');
}
function saveProjects(siteId){
  const val=document.getElementById('proj-input-'+siteId)?.value||'';
  const projects=val.split(',').map(p=>p.trim()).filter(Boolean);
  const sites=getSites();
  const idx=sites.findIndex(s=>s.id===siteId);
  if(idx===-1) return;
  sites[idx].projects=projects;
  saveSites(sites);
  renderSiteMgr();
  toast('프로젝트 저장됨','ok');
}
function addSite(){
  const name=document.getElementById('new-site-name').value.trim();
  if(!name){ toast('현장명을 입력하세요','err'); return; }
  const sites=getSites();
  const id='site'+Date.now().toString(36);
  sites.push({id,name,active:true,projects:[]});
  saveSites(sites);
  document.getElementById('new-site-name').value='';
  renderSiteMgr(); toast(`${name} 추가됨`,'ok');
}
function deleteSite(id){
  const sites=getSites();
  const s=sites.find(x=>x.id===id);
  if(!confirm(`'${s?.name||id}' 현장을 삭제할까요?`)) return;
  saveSites(sites.filter(x=>x.id!==id));
  renderSiteMgr();
}

function renderCoMgr(){
  const sites=getSites();
  const csel=document.getElementById('co-mgr-site');
  if(csel) csel.innerHTML=sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const allCos=DB.g(K.COS,{})||{};
  let html='';
  sites.forEach(site=>{
    const cos=allCos[site.id]||DEFAULT_COS[site.id]||[];
    if(!cos.length) return;
    html+=`<div style="font-size:10px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:1px;padding:8px 0 5px">${site.name}</div>`;
    html+=cos.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:9px;background:var(--bg2);border-radius:var(--rs);padding:9px 12px;margin-bottom:5px">
        <div style="width:7px;height:7px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
        <div style="flex:1"><div style="font-size:12px;font-weight:700">${c.name}</div></div>
        <span style="font-size:11px;font-weight:700;background:var(--bg3);border:1px solid var(--br);border-radius:5px;color:var(--blue);padding:4px 7px;min-width:56px;text-align:center;display:inline-block">${getEquipMaster().filter(e=>e.company===c.name&&e.siteId===site.id&&e.status!=='out').length}대</span>
        <div onclick="removeCo('${site.id}',${i})" style="color:var(--red);font-size:16px;cursor:pointer;padding:2px 5px">×</div>
      </div>`).join('');
  });
  document.getElementById('co-mgr-list').innerHTML=html||'<div class="empty" style="padding:20px 0"><div class="empty-txt">업체가 없습니다</div></div>';
}
function addCompany(){
  const siteId=document.getElementById('co-mgr-site')?.value;
  const name=document.getElementById('new-co-name').value.trim();
  if(!siteId||!name){ toast('현장과 업체명을 입력하세요','err'); return; }
  const allCos=DB.g(K.COS,{})||{};
  if(!allCos[siteId]) allCos[siteId]=[...( DEFAULT_COS[siteId]||[])];
  allCos[siteId].push({name,color:`hsl(${Math.floor(Math.random()*360)},65%,60%)`,equip:0});
  saveCos(allCos);
  document.getElementById('new-co-name').value='';
  renderCoMgr(); toast(`${name} 추가됨`,'ok');
}
function removeCo(siteId,i){
  const allCos=DB.g(K.COS,{})||{};
  if(!allCos[siteId]) allCos[siteId]=[...(DEFAULT_COS[siteId]||[])];
  if(!confirm(`'${allCos[siteId][i]?.name}' 삭제할까요?`)) return;
  allCos[siteId].splice(i,1); saveCos(allCos); renderCoMgr();
}
function updateEquip(siteId,i,val){
  const allCos=DB.g(K.COS,{})||{};
  if(!allCos[siteId]) allCos[siteId]=[...(DEFAULT_COS[siteId]||[])];
  allCos[siteId][i].equip=parseInt(val)||0; saveCos(allCos);
}

function populateExportSite(){
  const sites=getSites(); const siteId=S.siteId==='all'?null:S.siteId;
  const el=document.getElementById('export-site');
  if(!el) return;
  el.innerHTML=(siteId?sites.filter(s=>s.id===siteId):sites).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

/* Settings */
function saveAlertSettings(){
  const t=document.getElementById('alert-time').value;
  const s=DB.g(K.SETTINGS,{});
  s.alertTime=t||'15:00';
  s.alertRoles={
    tech:   !!document.getElementById('ac-role-tech')?.classList.contains('on'),
    sub:    !!document.getElementById('ac-role-sub')?.classList.contains('on'),
    aj:     !!document.getElementById('ac-role-aj')?.classList.contains('on'),
    ajtech: !!document.getElementById('ac-role-ajtech')?.classList.contains('on'),
  };
  DB.s(K.SETTINGS,s);
  _pushSettingsToSB().catch(()=>{});
  toast('✅ 알림 설정 저장됨','ok');
}

/* ── 추가 알림 관리 ── */
function _getCustomAlerts(){ return DB.g('custom_alerts',[]); }
function _saveCustomAlerts(arr){ DB.s('custom_alerts',arr); _pushSettingsToSB().catch(()=>{}); }

function renderCustomAlertList(){
  const el = document.getElementById('custom-alert-list');
  if(!el) return;
  const list = _getCustomAlerts();
  if(!list.length){
    el.innerHTML = `<div style="text-align:center;font-size:11px;color:var(--tx3);padding:12px;background:var(--bg2);border-radius:8px;border:1px dashed var(--br)">추가 알림 없음</div>`;
    return;
  }
  const repeatLabel = {daily:'매일', weekday:'평일', weekly:'매주'};
  el.innerHTML = list.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--bg2);border:1px solid var(--br);border-radius:8px;margin-bottom:6px">
      <div style="flex-shrink:0;width:36px;height:36px;background:rgba(59,139,255,.12);border-radius:8px;display:flex;align-items:center;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${a.time}</div>
        <div style="font-size:10px;color:var(--tx3)">${a.label||'알림'} · ${repeatLabel[a.repeat]||'매일'}</div>
      </div>
      <button onclick="toggleCustomAlert(${i})" style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid ${a.active!==false?'rgba(34,197,94,.3)':'var(--br)'};background:${a.active!==false?'rgba(34,197,94,.1)':'transparent'};color:${a.active!==false?'#4ade80':'var(--tx3)'};cursor:pointer;font-weight:600">${a.active!==false?'ON':'OFF'}</button>
      <button onclick="deleteCustomAlert(${i})" style="font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.08);color:#f87171;cursor:pointer">삭제</button>
    </div>`).join('');
}

function openAddAlertForm(){
  const el = document.getElementById('add-alert-form');
  if(el){ el.style.display='block'; el.scrollIntoView({behavior:'smooth',block:'center'}); }
}

function closeAddAlertForm(){
  const el = document.getElementById('add-alert-form');
  if(el) el.style.display='none';
  const t = document.getElementById('new-alert-time'); if(t) t.value='';
  const l = document.getElementById('new-alert-label'); if(l) l.value='';
}

function addCustomAlert(){
  const time  = (document.getElementById('new-alert-time')?.value||'').trim();
  const label = (document.getElementById('new-alert-label')?.value||'').trim();
  const repeat= document.getElementById('new-alert-repeat')?.value||'daily';
  if(!time){ toast('알림 시간을 선택하세요','err'); return; }
  if(!label){ toast('알림 내용을 입력하세요','err'); return; }
  const list = _getCustomAlerts();
  list.push({id:'ca-'+Date.now(), time, label, repeat, active:true, createdAt:Date.now()});
  _saveCustomAlerts(list);
  closeAddAlertForm();
  renderCustomAlertList();
  toast('알림이 추가되었습니다','ok');
}

function toggleCustomAlert(i){
  const list = _getCustomAlerts();
  if(!list[i]) return;
  list[i].active = list[i].active === false ? true : false;
  _saveCustomAlerts(list);
  renderCustomAlertList();
}

function deleteCustomAlert(i){
  if(!confirm('이 알림을 삭제할까요?')) return;
  const list = _getCustomAlerts();
  list.splice(i,1);
  _saveCustomAlerts(list);
  renderCustomAlertList();
  toast('알림이 삭제되었습니다','ok');
}
function saveInviteCode(){
  const c=document.getElementById('new-invite-code').value.trim();
  if(c.length<6){ toast('6자 이상 입력하세요','err'); return; }
  DB.s(K.INVITE,c);
  DB.s('invite_set_month', new Date().toISOString().slice(0,7));
  document.getElementById('current-invite-code').textContent=c;
  toast('초대코드가 변경되었습니다','ok');
  closeSheet('sh-invite');
  toast('✅ 초대코드 변경 완료','ok');
}
async function saveGsUrl(){
  const url=document.getElementById('gs-url').value.trim();
  if(!url){ toast('URL을 입력하세요','err'); return; }
  DB.s(K.GS_URL,url); toast('저장됨. 동기화 시도...','ok');
  closeSheet('sh-gs'); renderAdmin(); setTimeout(queueSync,300);
}
async function pasteUrl(){ try{const t=await navigator.clipboard.readText();document.getElementById('gs-url').value=t;}catch(_e){toast('클립보드 접근 거부','err');} }

/* ── Supabase 설정 저장 ── */
function saveSupabaseConfig(){
  const url = document.getElementById('sb-url-input').value.trim().replace(/\/+$/,'');
  const key = document.getElementById('sb-key-input').value.trim();
  const kakaoKey = document.getElementById('kakao-key-input')?.value.trim()||'';

  // 카카오 키는 URL/Key 없이도 독립 저장 — 먼저 처리
  if(kakaoKey){ DB.s('kakao_js_key', kakaoKey); if(typeof _kakaoInit==='function') _kakaoInit(); }

  // URL+Key 미입력 시: 카카오 키만 저장하고 리턴
  if(!url && !key){
    if(kakaoKey){ toast('카카오 키 저장됨 ✓','ok'); closeSheet('sh-supabase'); }
    else { toast('URL과 Key를 모두 입력하세요','err'); }
    return;
  }
  if(!url || !key){ toast('URL과 Key를 모두 입력하세요','err'); return; }
  if(!url.startsWith('https://')){ toast('URL은 https://로 시작해야 합니다','err'); return; }
  // localStorage에 저장 (기기별 커스텀 유지)
  DB.s(K.SB_URL, url);
  DB.s(K.SB_KEY, key);
  // 하드코딩값과 같으면 localStorage 제거 → 이후엔 기본값 사용 (저장 용량 절약)
  if(url === SB_DEFAULT_URL && key === SB_DEFAULT_KEY){
    localStorage.removeItem(K.SB_URL);
    localStorage.removeItem(K.SB_KEY);
  }
  toast('Supabase 연동 저장됨. 동기화 시도...','ok');
  closeSheet('sh-supabase');
  renderAdmin();
  setTimeout(queueSync, 300);
}

/* ── Supabase 연결 테스트 ── */
async function testSupabaseConnection(){
  const url = document.getElementById('sb-url-input').value.trim().replace(/\/+$/,'');
  const key = document.getElementById('sb-key-input').value.trim();
  if(!url || !key){ toast('URL과 Key를 먼저 입력하세요','err'); return; }
  toast('연결 테스트 중...','ok');
  try{
    const r = await fetch(`${url}/rest/v1/logs?limit=1`, {
      headers:{ 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    if(r.ok){
      toast('✅ Supabase 연결 성공!','ok');
    } else if(r.status === 404){
      toast('⚠️ 연결됨. 테이블이 없습니다 — SQL 실행 필요','warn');
    } else {
      toast(`연결 실패 (${r.status}). Key 확인 필요`,'err');
    }
  } catch(e){
    toast('연결 실패: ' + e.message,'err');
  }
}
function openForcedPwSheet(){
  window._forcePwChange=true;
  const notice=document.getElementById('pw-force-notice'); if(notice) notice.style.display='block';
  const laterBtn=document.getElementById('pw-later-btn'); if(laterBtn) laterBtn.style.display='';
  const cancelBtn=document.getElementById('pw-cancel-btn'); if(cancelBtn) cancelBtn.style.display='none';
  openSheet('sh-pw');
}

/* ═══════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════ */
function addNotif(n){ const ns=DB.g(K.NOTIFS,[]); ns.unshift({...n,ts:Date.now(),read:false}); DB.s(K.NOTIFS,ns.slice(0,50)); document.getElementById('ndot').classList.add('on'); }
function checkUnreadNotifs(){ if(DB.g(K.NOTIFS,[]).some(n=>!n.read)) document.getElementById('ndot').classList.add('on'); }
function openNotifSheet(){
  const ns=DB.g(K.NOTIFS,[]);
  const el=document.getElementById('notif-list');
  el.innerHTML=!ns.length
    ?`<div class="empty" style="padding:30px 0"><div class="empty-ico">🔕</div><div class="empty-txt">알림이 없습니다</div></div>`
    :ns.slice(0,20).map((n,i)=>`<div class="nitem ${!n.read?'unread':''}" style="position:relative;padding-right:32px"><div class="nitem-ico">${n.icon||'📢'}</div><div style="flex:1;min-width:0"><div class="nitem-title">${n.title||''}</div><div class="nitem-desc">${n.desc||''}</div><div class="nitem-time">${new Date(n.ts).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div></div><button onclick="deleteNotif(${i})" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--tx3);font-size:13px;cursor:pointer;padding:2px;line-height:1" title="삭제">✕</button></div>`).join('');
  openSheet('sh-notif');
}
function clearNotifs(){ const ns=DB.g(K.NOTIFS,[]); ns.forEach(n=>n.read=true); DB.s(K.NOTIFS,ns); document.getElementById('ndot').classList.remove('on'); }
function deleteNotif(idx){
  const ns=DB.g(K.NOTIFS,[]);
  ns.splice(idx,1);
  DB.s(K.NOTIFS,ns);
  if(!ns.some(n=>!n.read)) document.getElementById('ndot').classList.remove('on');
  openNotifSheet();
}

/* ═══════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════ */
function openExportSheet(){
  openSheet('sh-export');
  setTimeout(()=>initExportFilters(),50);
}
/* ── 내보내기 필터 헬퍼 ── */
function selectExportType(el, type){
  selectOne(el,'export-type-chips');
  ['가동현황','반입반출','AS요청','장비사용내역'].forEach(t=>{
    const panel=document.getElementById('export-filter-'+t);
    if(panel) panel.style.display=(t===type)?'':'none';
  });
}
function toggleChip(el){ el.classList.toggle('on'); }
function initExportFilters(){
  const siteId=document.getElementById('export-site')?.value||'';
  // 가동현황 / 장비사용내역 위치 칩 채우기
  const logs=getLogs().filter(l=>!siteId||l.siteId===siteId);
  const floors=[...new Set(logs.map(l=>l.floor).filter(Boolean).flatMap(f=>f.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean)))].sort();
  ['ef-ops-floor','ef-eq-floor'].forEach(cid=>{
    const el=document.getElementById(cid); if(!el) return;
    el.innerHTML=floors.map(f=>`<div class="chip" onclick="toggleChip(this)">${f}</div>`).join('');
  });
}
function exportCSV(){
  const siteId=document.getElementById('export-site')?.value||'';
  const typeChip=document.querySelector('#export-type-chips .chip.on')?.textContent||'가동현황';
  let data=[], h=[], rows=[], filename='내보내기';

  const _inRange=(dateStr,fromId,toId)=>{
    const from=document.getElementById(fromId)?.value; const to=document.getElementById(toId)?.value;
    if(from&&dateStr<from) return false;
    if(to&&dateStr>to) return false;
    return true;
  };

  if(typeChip==='반입반출'){
    const company=(document.getElementById('ef-tr-company')?.value||'').trim().toLowerCase();
    const project=(document.getElementById('ef-tr-project')?.value||'').trim().toLowerCase();
    const selTypes=[...document.querySelectorAll('#ef-tr-type .chip.on')].map(c=>c.textContent);
    data=getTransit().filter(r=>{
      if(!siteId||r.siteId===siteId);else if(r.siteId!==siteId) return false;
      if(!_inRange(r.date||'','ef-tr-from','ef-tr-to')) return false;
      if(company&&!(r.company||'').toLowerCase().includes(company)) return false;
      if(project&&!(r.project||'').toLowerCase().includes(project)) return false;
      if(selTypes.length){
        const rType=r.type==='in'?'반입':r.type==='out'?'반출':'인수인계';
        if(!selTypes.includes(rType)) return false;
      }
      return true;
    });
    h=['날짜','구분','현장','업체','제원','신청인','연락처','상태','프로젝트','메모'];
    rows=data.map(r=>[r.date||'',r.type==='in'?'반입':r.type==='out'?'반출':'인수인계',r.siteName||'',r.company||'',(r.specs||[]).map(s=>s.spec+'×'+s.qty).join('/')||r.equip||'',r.reporterName||r.recorder||'',r.reporterPhone||'',r.status||'',r.project||'',r.note||'']);
    filename='반입반출';
  } else if(typeChip==='AS요청'){
    const company=(document.getElementById('ef-as-company')?.value||'').trim().toLowerCase();
    data=getAsReqs().filter(r=>{
      if(siteId&&r.siteId!==siteId) return false;
      if(!_inRange(r.date||r.created_at?.slice(0,10)||'','ef-as-from','ef-as-to')) return false;
      if(company&&!(r.company||'').toLowerCase().includes(company)) return false;
      return true;
    });
    h=['날짜','현장','업체','장비','위치','고장유형','내용','신청인','연락처','처리상태','처리일','기사','비고'];
    rows=data.map(r=>[r.date||'',r.siteName||'',r.company||'',r.equip||'',r.location||'',r.faultType||r.type||'',r.description||r.desc||'',r.reporterName||r.reporter||'',r.reporterPhone||'',r.status||'',r.resolvedAt?new Date(r.resolvedAt).toLocaleDateString('ko-KR'):'',r.techName||'',r.resolveNote||r.resolvedNote||'']);
    filename='AS요청';
  } else if(typeChip==='장비사용내역'){
    const company=(document.getElementById('ef-eq-company')?.value||'').trim().toLowerCase();
    const project=(document.getElementById('ef-eq-project')?.value||'').trim().toLowerCase();
    const spec=(document.getElementById('ef-eq-spec')?.value||'').trim().toLowerCase();
    const selFloors=[...document.querySelectorAll('#ef-eq-floor .chip.on')].map(c=>c.textContent);
    data=getEquipMaster().filter(e=>{
      if(siteId&&e.siteId!==siteId) return false;
      if(!_inRange(e.in_date||'','ef-eq-from','ef-eq-to')) return false;
      if(company&&!(e.company||'').toLowerCase().includes(company)) return false;
      if(project&&!(e.project||'').toLowerCase().includes(project)) return false;
      if(spec&&!(e.spec||'').toLowerCase().includes(spec)) return false;
      if(selFloors.length&&!selFloors.some(f=>(e.location||'').includes(f))) return false;
      return true;
    });
    h=['장비번호','제원','모델','업체','현장','상태','반입일','반출일','프로젝트','위치'];
    rows=data.map(e=>[e.equip_no||e.equipNo||'',e.spec||'',e.model||'',e.company||'',e.site_name||e.siteName||'',e.status||'',e.in_date||'',e.out_date||'',e.project||'',e.location||'']);
    filename='장비사용내역';
  } else {
    // 가동현황
    const selFloors=[...document.querySelectorAll('#ef-ops-floor .chip.on')].map(c=>c.textContent);
    data=getLogs().filter(l=>{
      if(siteId&&l.siteId!==siteId) return false;
      if(!_inRange(l.date||'','ef-ops-from','ef-ops-to')) return false;
      if(selFloors.length){
        const lFloors=(l.floor||'').split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
        if(!selFloors.some(f=>lFloors.includes(f))) return false;
      }
      return true;
    });
    h=['날짜','현장','업체','층수','장비번호','기사','상태','시작시간','종료시간','가동시간(h)','계기(시작)','계기(종료)','비고'];
    rows=data.map(l=>[l.date||'',l.siteName||l.site_name||'',l.company||'',l.floor||'',l.equip||'',l.name||l.recorder||'',l.status||'',l.startTime||'',l.endTime||'',l.duration??'',l.meterStart??'',l.meterEnd??'',l.reason||'']);
    filename='가동현황';
  }
  if(!rows.length){ toast('내보낼 데이터가 없습니다','err'); return; }
  const csvRows=[h,...rows].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
  const blob=new Blob(['\uFEFF'+csvRows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${filename}_${siteId||'전체'}_${today()}.csv`; a.click();
  closeSheet('sh-export'); toast('📄 CSV 저장됨','ok');
}
function exportJSON(){
  const siteId=document.getElementById('export-site')?.value||'';
  const typeChip=document.querySelector('#export-type-chips .chip.on')?.textContent||'가동현황';
  let data, filename;
  if(typeChip==='반입반출'){ data=getTransit().filter(r=>!siteId||r.siteId===siteId); filename='반입반출'; }
  else if(typeChip==='AS요청'){ data=getAsReqs().filter(r=>!siteId||r.siteId===siteId); filename='AS요청'; }
  else if(typeChip==='장비사용내역'){ data=getEquipMaster().filter(e=>!siteId||e.siteId===siteId); filename='장비사용내역'; }
  else { data=getLogs().filter(l=>!siteId||l.siteId===siteId); filename='가동현황'; }
  const blob=new Blob([JSON.stringify({exported:new Date().toISOString(),siteId,data},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${filename}_${siteId||'전체'}_${today()}.json`; a.click();
  closeSheet('sh-export'); toast('📦 JSON 저장됨','ok');
}

/* ═══════════════════════════════════════════
   LOG BADGE
═══════════════════════════════════════════ */
function updateLogBadge(){
  const logs=getLogs();
  const c=logs.filter(l=>!l.synced).length;
  const b=document.getElementById('nb-log');
  if(!b) return;
  if(c>0){b.textContent=c;b.classList.add('on');}else b.classList.remove('on');
}

/* ═══════════════════════════════════════════
   데이터 마이그레이션 — v1 / v2 / v3 완전 호환
   
   버전별 저장 키 구조:
   v1: 'logs', 'companies'
   v2: 'logs_v2', 'companies_v2', 'user_session', 'admin_credentials'
   v3: 'logs_v3', 'companies_v3', 'session_v3', 'aj_creds'
═══════════════════════════════════════════ */

function _safeLS(key){
  try{ const v=localStorage.getItem(key); return v?JSON.parse(v):null; }catch(_e){ return null; }
}

/* ── v1 마이그레이션 (키: 'logs', 'companies') ── */
function migrateFromV1(){
  if(localStorage.getItem('migrated_v1_to_v3')) return;
  const v1Logs = _safeLS('logs');
  const v1Cos  = _safeLS('companies');
  if(!v1Logs?.length && !v1Cos?.length){
    localStorage.setItem('migrated_v1_to_v3','1'); return;
  }
  console.log(`[v1→v3] 로그 ${v1Logs?.length||0}건, 업체 ${v1Cos?.length||0}개`);

  // 업체 마이그레이션: v1 [{name,color,equip,total,active}] → v3 {p4:[...]}
  if(v1Cos?.length){
    const ex = DB.g(K.COS,{});
    if(!ex['p4']?.length){
      ex['p4'] = v1Cos.map(c=>({
        name:c.name||c.company||'', color:c.color||'#4f9eff', equip:c.equip||c.total||0
      })).filter(c=>c.name);
      DB.s(K.COS,ex); _cache.cos=null;
    }
  }

  // 로그 마이그레이션: v1 {id,date,company,status,count,total,meter,floor,name}
  if(v1Logs?.length){
    const ex  = DB.g(K.LOGS,[]);
    const ids = new Set(ex.map(l=>l.id));
    const conv = v1Logs.filter(l=>!ids.has(l.id||'')).map(l=>({
      id:      l.id||`v1-${l.date||''}-${l.company||''}-${Math.random().toString(36).slice(2,5)}`,
      siteId:'p4', date:l.date||'', company:l.company||'',
      floor:l.floor||'', equip:l.equip||'', name:l.name||l.worker||'',
      meterStart:l.meter?+l.meter:null, meterEnd:null, duration:null,
      startTime:null, endTime:null, status:'end',
      reason:l.status==='holiday'?'휴무':(l.reason||''),
      v1Legacy:{status:l.status,count:l.count,total:l.total,active:l.active},
      ts:l.ts||Date.now(), synced:l.synced!==false, migratedFrom:'v1',
    }));
    if(conv.length){ saveLogs([...conv,...ex]); console.log(`[v1→v3] ${conv.length}건 완료`); }
  }

  // v1 GS URL 마이그레이션
  const v1url = _safeLS('gs_url')||_safeLS('gsUrl')||_safeLS('scriptUrl');
  if(v1url && !DB.g(K.GS_URL,'')) DB.s(K.GS_URL, v1url);

  localStorage.setItem('migrated_v1_to_v3','1');
}

/* ── v2 마이그레이션 (키: 'logs_v2', 'companies_v2', 'admin_credentials') ── */
function migrateFromV2(){
  if(localStorage.getItem('migrated_v2_to_v3')) return;
  const v2Logs = _safeLS('logs_v2') || [];
  const v2Cos  = _safeLS('companies_v2');
  if(!v2Logs.length && !v2Cos){
    localStorage.setItem('migrated_v2_to_v3','1'); return;
  }
  console.log(`[v2→v3] 로그 ${v2Logs.length}건, 업체 ${v2Cos?.length||0}개`);

  // 업체 마이그레이션: v2 [{name,color,equip}] → v3 {p4:[...]}
  if(v2Cos?.length){
    const ex = DB.g(K.COS,{});
    if(!ex['p4']?.length){
      ex['p4'] = v2Cos.map(c=>({name:c.name,color:c.color||'#4f9eff',equip:c.equip||0}));
      DB.s(K.COS,ex); _cache.cos=null;
    }
  }

  // 로그 마이그레이션: v2 {id,date,company,floor,equip,name,meter,mode,active,count,total,reason,ts,synced}
  const ex  = DB.g(K.LOGS,[]);
  const ids = new Set(ex.map(l=>l.id));
  const conv = v2Logs.filter(l=>!ids.has(l.id)).map(l=>({
    id:      l.id||`v2-${l.date||''}-${l.company||''}-${Math.random().toString(36).slice(2,6)}`,
    siteId:'p4', date:l.date||'', company:l.company||'',
    floor:l.floor||'', equip:l.equip||'', name:l.name||'',
    meterStart:l.meter?+l.meter:null, meterEnd:null, duration:null,
    startTime:null, endTime:null, status:'end',
    reason:l.mode==='holiday'?'휴무':(l.reason||''),
    v2Legacy:{active:l.active,mode:l.mode,count:l.count,total:l.total},
    ts:l.ts||Date.now(), synced:l.synced!==false, migratedFrom:'v2',
  }));
  if(conv.length){ saveLogs([...conv,...ex]); console.log(`[v2→v3] ${conv.length}건 완료`); }

  // v2 관리자 비밀번호 마이그레이션
  const v2creds = _safeLS('admin_credentials');
  if(v2creds?.pw && !DB.g(K.CREDS,null)) DB.s(K.CREDS,{id:v2creds.id||'admin',pw:v2creds.pw});

  // v2 GS URL 마이그레이션
  const v2url = _safeLS('gs_url');
  if(v2url && !DB.g(K.GS_URL,'')) DB.s(K.GS_URL, v2url);

  localStorage.setItem('migrated_v2_to_v3','1');
}

// ── QR 코드 PDF 생성 ────────────────────────────────────────
async function generateQrPdf(){
  const raw = document.getElementById('qr-equip-input')?.value || '';
  const equipNos = raw.split(/[,，\s]+/).map(s=>s.trim().toUpperCase()).filter(Boolean);
  if(!equipNos.length){ toast('장비번호를 입력하세요','err'); return; }
  if(typeof QRCode === 'undefined'){ toast('QR 라이브러리 로드 중입니다. 잠시 후 다시 시도하세요','warn'); return; }

  toast('QR 생성 중...','ok', 1500);
  const baseUrl = location.origin + location.pathname;

  try {
    // 각 장비번호의 QR data URL 생성
    const items = await Promise.all(equipNos.map(async no => {
      const url = baseUrl + '?equip=' + encodeURIComponent(no);
      const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 3, color:{dark:'#000',light:'#fff'} });
      return { no, dataUrl };
    }));

    // 인쇄용 창 생성 (A4 1장 = QR 1개)
    const win = window.open('', '_blank', 'width=800,height=600');
    if(!win){ toast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요','err',4000); return; }
    const pages = items.map(({no, dataUrl})=>`
      <div class="page">
        <div class="equip-no">${no}</div>
        <img src="${dataUrl}" alt="QR ${no}">
        <div class="hint">스캔하면 가동현황 사용신청폼이 열립니다</div>
      </div>`).join('');
    win.document.write(`<!DOCTYPE html><html lang="ko"><head>
      <meta charset="UTF-8">
      <title>QR 코드 — ${equipNos.join(', ')}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Noto Sans KR',sans-serif;background:#fff}
        .page{width:210mm;height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;page-break-after:always;padding:20mm}
        .equip-no{font-size:36pt;font-weight:900;letter-spacing:2px;margin-bottom:12mm;color:#111}
        img{width:160mm;height:160mm;object-fit:contain}
        .hint{font-size:11pt;color:#666;margin-top:10mm}
        @media print{.page{page-break-after:always}}
      </style>
    </head><body>${pages}
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
  } catch(e) {
    console.error('[generateQrPdf]', e);
    toast('QR 생성 중 오류가 발생했습니다','err');
  }
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
