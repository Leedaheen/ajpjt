/* ═══════════════════════════════════════════
   SESSION
═══════════════════════════════════════════ */
let S = null; // current session

/* ── 메모리 누수 방지: enterApp setInterval ID + visibilitychange 핸들러 ──
   enterApp()이 재호출(예: 자동로그인 후 수동로그인)되어도 중복 등록 방지.
──────────────────────────────────────────────────────────────────────── */
let _appIntervals = [];
function _onVisibilityChange(){
  if(document.visibilityState==='visible'&&S){ queueSync(); _fetchFromSB().catch(()=>{}); }
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
const today  = ()=>{const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const nowHM  = ()=>{ const n=new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; };
const fPct   = v=>(v*100).toFixed(1)+'%';
const fH = h => {
  if(!h || h <= 0) return '0h 0m';
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
};
const rCol   = v=>v>=.75?'var(--green)':v>=.5?'var(--yellow)':'var(--red)';
const gCoCol = (sid,name)=>{ const c=getCos(sid).find(x=>x.name===name); return c?.color||'var(--blue)'; };
const fmtDate= s=>{ if(!s)return''; const d=new Date(s); return `${d.getMonth()+1}/${d.getDate()}`; };
const fmtTS  = ts=>{ const d=new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };

/* ── XSS 방어: 사용자 입력값 HTML 이스케이프 ────────────────
   innerHTML 템플릿에 사용자 데이터 삽입 전 반드시 esc() 적용.
   예) `<div>${esc(r.desc)}</div>`
──────────────────────────────────────────────────────────── */
function esc(s){
  if(s===null||s===undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

let _tt; function toast(msg,type='',ms=2600){
  const el=document.getElementById('toast');
  clearTimeout(_tt);
  if(type==='err'){
    el.innerHTML=msg+'<button class="toast-close" onclick="document.getElementById(\'toast\').classList.remove(\'on\')">✕</button>';
    el.className='toast on err';
  } else {
    el.textContent=msg; el.className='toast on '+(type||'');
    _tt=setTimeout(()=>el.classList.remove('on'),ms);
  }
}
function spinner(on,txt='처리 중...'){
  document.getElementById('sp-ov').classList.toggle('on',on);
  document.getElementById('sp-txt').textContent=txt;
}
function openSheet(id){ document.getElementById(id).classList.add('on'); onSheetOpen(id); setTimeout(_setupAllSheetSwipe, 50); }
function closeSheet(id){ document.getElementById(id).classList.remove('on'); }

// ── 시트 스와이프 닫기 유틸리티 (전역 자동 적용) ────────────
let _swipeY0 = 0;
function _swipeStart(e){
  _swipeY0 = e.touches[0].clientY;
}
function _swipeMove(e, sheetId){
  const dy = e.touches[0].clientY - _swipeY0;
  if(dy > 80) closeSheet(sheetId);
}
// 모든 .soverlay > .sheet 에 120px 스와이프 닫기 + 드래그 애니메이션 자동 설정
function _setupAllSheetSwipe(){
  document.querySelectorAll('.soverlay').forEach(overlay=>{
    const sheet = overlay.querySelector('.sheet');
    if(!sheet || sheet.dataset.swipeSetup) return;
    sheet.dataset.swipeSetup = '1';
    let _sy = 0, _cy = 0, _dragging = false;
    const _getScrollParent = el => {
      // 스크롤 가능한 부모가 최상단(sheet 자신)인 경우만 swipe 허용
      let p = el;
      while(p && p !== sheet){ if(p.scrollTop > 0) return p; p = p.parentElement; }
      return null;
    };
    sheet.addEventListener('touchstart', e => {
      _sy = e.touches[0].clientY; _cy = _sy; _dragging = false;
      sheet.style.transition = 'none';
    }, {passive: true});
    sheet.addEventListener('touchmove', e => {
      _cy = e.touches[0].clientY;
      const dy = _cy - _sy;
      if(dy <= 0) return; // 위로 스와이프는 무시
      // 내부 스크롤 중이면 무시
      if(_getScrollParent(e.target)) return;
      _dragging = true;
      sheet.style.transform = `translateY(${dy}px)`;
    }, {passive: true});
    sheet.addEventListener('touchend', () => {
      const dy = _cy - _sy;
      sheet.style.transition = '';
      if(_dragging && dy >= 150){
        // 아래로 빠르게 내려가며 닫기
        sheet.style.transition = 'transform .18s cubic-bezier(.4,0,1,1)';
        sheet.style.transform = 'translateY(110%)';
        const ovId = overlay.id;
        setTimeout(() => {
          sheet.style.transform = '';
          sheet.style.transition = '';
          closeSheet(ovId);
        }, 180);
      } else {
        // 원위치 복귀
        sheet.style.transition = 'transform .2s cubic-bezier(.33,1,.68,1)';
        sheet.style.transform = '';
        setTimeout(() => { sheet.style.transition = ''; }, 200);
      }
      _dragging = false;
    }, {passive: true});
  });
}
function onSheetOpen(id){
  if(id==='sh-sites') renderSiteMgr();
  if(id==='sh-company') renderCoMgr();
  if(id==='sh-gs') document.getElementById('gs-url').value=DB.g(K.GS_URL,'')||'';
  if(id==='sh-supabase'){
    document.getElementById('sb-url-input').value=DB.g(K.SB_URL,'')||SB_DEFAULT_URL||'';
    document.getElementById('sb-key-input').value=DB.g(K.SB_KEY,'')||SB_DEFAULT_KEY||'';
    // AJ관리자만 민감 정보 블록 표시
    const _isAJ = S?.role==='aj';
    ['sb-credentials-block','sb-sql-block','sb-warn-block'].forEach(bid=>{
      const el=document.getElementById(bid); if(el) el.style.display=_isAJ?'':'none';
    });
    _loadInviteCodeInput();
    // IDB 통계 비동기 표시
    const statsEl=document.getElementById('idb-stats');
    if(statsEl){
      Promise.all([
        IDB.count('logs'), IDB.count('transit'),
        IDB.count('as_requests'), IDB.count('members'),
        IDB.getUnsynced('logs').then(a=>a.length).catch(()=>0)
      ]).then(([logs,tr,as,mb,unsync])=>{
        statsEl.innerHTML=`로그 <b>${logs.toLocaleString()}</b>건 · 반입출 <b>${tr}</b>건 · AS <b>${as}</b>건 · 멤버 <b>${mb}</b>건<br>미동기화: <b style="color:${unsync>0?'var(--yellow)':'var(--green)'}">${unsync}건</b>`;
      }).catch(()=>{ statsEl.textContent='IDB 통계 조회 실패'; });
    }
  }
  if(id==='sh-invite'){
    autoRotateInvite();
    const sites = getSites();
    const siteCodesHtml = sites.map(s => {
      const code = DB.g(K.INVITE_SITE + s.id, null) || DB.g(K.INVITE,'') || '(미설정)';
      return `<div style="margin-bottom:10px;padding:10px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--br)">
        <div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:4px">${s.name}</div>
        <div style="font-size:18px;font-weight:900;font-family:'JetBrains Mono',monospace;color:var(--teal);letter-spacing:2px;margin-bottom:6px" id="invite-code-${s.id}">${code}</div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button class="btn-ghost" style="flex:1;font-size:10px;padding:5px" onclick="copyInviteCodeSite('${s.id}')">복사</button>
          <button class="btn-ghost" style="flex:1;font-size:10px;padding:5px" onclick="shareInviteCodeSite('${s.id}','${s.name}')">공유</button>
        </div>
        <div style="display:flex;gap:6px">
          <input type="text" class="lg-input" id="new-code-${s.id}" placeholder="직접 입력" style="flex:1;padding:5px 8px;font-size:11px">
          <button class="btn-ghost" style="flex:1;font-size:10px;padding:5px" onclick="saveInviteCodeSite('${s.id}')">변경</button>
        </div>
      </div>`;
    }).join('');
    document.getElementById('invite-site-codes').innerHTML = siteCodesHtml;
  }
  if(id==='sh-export') populateExportSite();
}

/* ═══════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════ */
let curRole='tech';
const priv={p1:true,p2:true,p3:false};

function initLogin(){
  console.log('[INIT APP] initLogin 진입');
  // ── 스피너 강제 종료 (이전 작업에서 남아있는 경우 pointer-events:all 차단 방지) ──
  try { spinner(false); } catch(e){}
  // ── loginScreen pointer-events 복원 (이전 enterApp 실패 시 none 상태 수정) ──
  const _lsEl = document.getElementById('loginScreen');
  if(_lsEl){ _lsEl.style.pointerEvents=''; _lsEl.style.opacity='1'; _lsEl.style.display=''; }

  // ── 자동 로그인 처리 ────────────────────────────────────
  const autoLoginPref = DB.g('auto_login', null); // null = 아직 설정 안 됨 (=true 로 간주)
  const saved = DB.g(K.SESSION, null);
  if (autoLoginPref !== false && saved && (Date.now() - saved.loginAt) <= 7*24*60*60*1000) {
    S = saved; enterApp(); return;
  }
  // 체크박스 상태 복원 (기본값 true)
  const isAutoOn = autoLoginPref !== false;
  ['chk-auto-login-tech','chk-auto-login-sub'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.checked=isAutoOn;
  });
  // AJ 관리자 자동 로그인은 항상 체크
  const _ajAutoEl = document.getElementById('chk-auto-login-aj');
  if(_ajAutoEl) _ajAutoEl.checked = true;

  const sites=getSites();
  ['techSite','subSite'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.innerHTML='<option value="">현장 선택</option>'+sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
    el.addEventListener('change',()=>syncCoList(id));
  });
  // 첫 번째 현장 자동 선택
  const techSiteEl = document.getElementById('techSite');
  if(techSiteEl && !techSiteEl.value && sites.length) {
    techSiteEl.value = sites[0].id;
  }
  const subSiteEl = document.getElementById('subSite');
  if(subSiteEl && !subSiteEl.value && sites.length) {
    subSiteEl.value = sites[0].id;
  }
  syncCoList('techSite');
  syncCoList('subSite');
  // GIS 기본 활성 탭 = tech (로그인 화면 초기 탭)
  window._gsiActiveRole = window._gsiActiveRole || 'tech';
  // GIS 라이브러리가 먼저 로드됐으면 즉시 초기화, 아니면 로드 완료 시 자동 호출
  if(window._gsiLoadPending){ window._gsiLoadPending=false; _gsiInit(); }
  else if(typeof google!=='undefined'&&google.accounts?.id) _gsiInit();
  _kakaoInit();
  _checkKakaoToken().catch(()=>{}); // 카카오 리다이렉트 복귀 처리
  // restore saved info (상단에서 이미 선언된 saved 재사용)
  if(saved?.name){
    if(document.getElementById('techName')) document.getElementById('techName').value=saved.name;
    if(saved.phone && document.getElementById('techPhone')) document.getElementById('techPhone').value=saved.phone;
    if(saved.siteId && document.getElementById('techSite')) document.getElementById('techSite').value=saved.siteId;
    if(saved.siteId) syncCoList('techSite');
    if(saved.company && document.getElementById('techCompany')) document.getElementById('techCompany').value=saved.company;
    // 팀명 자동 복원
    const _savedTeam = saved.team || DB.g('last_tech_team','');
    if(_savedTeam && document.getElementById('techTeam')) document.getElementById('techTeam').value=_savedTeam;
  }
}

function syncCoList(siteElId){
  const siteEl=document.getElementById(siteElId);
  if(!siteEl) return;
  const siteId=siteEl.value;
  const coElId=siteElId==='techSite'?'techCompany':'subCompany';
  const coEl=document.getElementById(coElId);
  if(!coEl) return;
  const cos=siteId?getCos(siteId):[];
  coEl.innerHTML='<option value="">업체 선택</option>'+cos.map(co=>`<option value="${co.name}">${co.name}</option>`).join('');
  // 업체가 1개 이상이면 첫 번째 자동 선택
  if(cos.length && !coEl.value) coEl.value = cos[0].name;
}

function switchRole(r){
  curRole=r;
  window._gsiActiveRole = r; // 현재 활성 탭 기록 (Google Sign-In 콜백에서 사용)
  ['tech','sub','aj'].forEach(x=>{
    document.getElementById('form-'+x).style.display=x===r?'block':'none';
    const tab=document.querySelector(`.role-tab[data-r="${x}"]`);
    tab.className='role-tab'+(x===r?' active-'+x:'');
  });
  setTimeout(()=>_renderGsiBtn(r), 50); // form 표시 후 버튼 렌더링
}

const privState={p1:true,p2:true,p3:false};
function togglePriv(id){ privState[id]=!privState[id]; const el=document.getElementById(id); el.classList.toggle('on',privState[id]); el.textContent=privState[id]?'✓':''; updatePAll(); }
function toggleAllPriv(){ const all=privState.p1&&privState.p2&&privState.p3; ['p1','p2','p3'].forEach(id=>{ privState[id]=!all; const el=document.getElementById(id); el.classList.toggle('on',!all); el.textContent=!all?'✓':''; }); updatePAll(); }
function updatePAll(){
  const al=privState.p1&&privState.p2&&privState.p3;
  const req=privState.p1&&privState.p2; // 필수 항목만 체크
  const el=document.getElementById('pallck');
  if(el){ el.classList.toggle('on',req); el.textContent=req?'✓':''; }
  // 헤더 텍스트 업데이트
  const hd=document.querySelector('.priv-hd-title');
  if(hd) hd.textContent=req?'개인정보 수집·이용 동의 (전체 동의됨)':'개인정보 수집·이용 동의 ⚠️ 필수항목 미동의';
}

/* ── AJ 관리자 로그인 전용 헬퍼 ── */
async function sha256(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function switchAjTab(tab){
  ['login','register','changepw'].forEach(t=>{
    const pane=document.getElementById('aj-pane-'+t);
    const btn=document.getElementById('aj-tab-'+t);
    if(pane) pane.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('on',t===tab);
  });
  if(tab==='login') setTimeout(()=>_renderGsiBtn('aj'), 50);
}
/* ── AJ 멤버 로컬 저장소 헬퍼 ── */
function _getAjMembers(){ return DB.g(K.AJ_MEMBERS,[]); }
function _saveAjMembers(arr){ DB.s(K.AJ_MEMBERS,arr); }
/* admin 계정 초기 생성 (없을 때만) */
async function ensureAdminAccount(){
  const members = _getAjMembers();
  if(members.some(m=>m.emp_no==='admin')) return;
  const pwHash = await sha256('aj2025!');
  const admin = {emp_no:'admin', name:'관리자(Admin)', phone:'', pw_hash:pwHash, aj_type:'관리자', created_at:new Date().toISOString()};
  members.unshift(admin);
  _saveAjMembers(members);
  // 신규 생성 시 Supabase에도 저장 (다기기 로그인 지원)
  _syncAjMemberSb(admin);
}
function _syncAjMemberSb(member){ // Supabase 백그라운드 upsert
  sbBatchUpsert('aj_members',[member]).catch(e=>console.warn('[SB] aj_members upsert 실패:',e?.message));
}
function _patchAjMemberSb(empNo,patch){ // Supabase 백그라운드 패치 (실패 무시)
  sbReq('aj_members','PATCH',patch,`?emp_no=eq.${encodeURIComponent(empNo)}`).catch(()=>{});
}
function _deleteAjMemberSb(empNo){ // Supabase 백그라운드 삭제 (실패 무시)
  sbReq('aj_members','DELETE',null,`?emp_no=eq.${encodeURIComponent(empNo)}`).catch(()=>{});
}

/* ══════════════════════════════════════════════════════════
   GOOGLE SIGN-IN (Google Identity Services)
   - AJ 관리자 계정에 Google OAuth 연동 지원
   - 최초 로그인 시 기존 계정(사번+비번)과 연동 필요
   - 이후에는 Google 계정으로 바로 로그인
══════════════════════════════════════════════════════════ */
function _gsiInit(){
  console.log('[GOOGLE INIT] _gsiInit 호출');
  const clientId = GOOGLE_DEFAULT_CLIENT_ID;
  // 미설정 시 안내 표시만 하고 종료
  if(!clientId){ ['tech','sub','aj'].forEach(r=>_renderGsiBtn(r)); return; }
  if(typeof google==='undefined'||!google.accounts?.id){
    // Google 라이브러리가 아직 미로드 → window.load 시 재시도
    window._gsiLoadPending=true;
    window.addEventListener('load', function _gsiLoadHandler(){
      window.removeEventListener('load', _gsiLoadHandler);
      if(typeof google!=='undefined'&&google.accounts?.id){ window._gsiLoadPending=false; _gsiInit(); }
    });
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: onGoogleSignIn,
      context: 'signin',
      ux_mode: 'popup'
    });
    window._gsi_initialized = true;
    console.log('[GOOGLE INIT] google.accounts.id.initialize 완료');
  } catch(e){ console.warn('[GSI] initialize 오류:',e); }
  // 현재 보이는 탭의 버튼 렌더링 (나머지는 탭 전환 시 렌더링)
  const curR = window._gsiActiveRole || 'tech';
  _renderGsiBtn(curR);
}

/* role: 'tech' | 'sub' | 'aj' */
function _renderGsiBtn(role){
  role = role || 'aj';
  const clientId = GOOGLE_DEFAULT_CLIENT_ID;
  const container = document.getElementById('gsi-btn-'+role);
  if(!container) return;
  const noClientId = role==='aj'?'gsi-no-client':'gsi-no-client-'+role;
  const noClient = document.getElementById(noClientId);
  if(!clientId){
    container.style.display='none';
    if(noClient) noClient.style.display='block';
    return;
  }
  container.style.display='';
  if(noClient) noClient.style.display='none';
  if(!window._gsi_initialized) return;
  container.innerHTML=''; // 중복 방지
  try {
    google.accounts.id.renderButton(container,{
      type:'standard', theme:'filled_black', size:'large',
      text:'signin_with', shape:'rectangular', width:300, locale:'ko'
    });
  } catch(e){ console.warn('[GSI] renderButton 오류:',e); }
}

/* JWT payload 디코딩 (서명 검증 없이 클라이언트 사이드 파싱) */
function _decodeJwt(token){
  try {
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const json = decodeURIComponent(atob(b64).split('').map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
    return JSON.parse(json);
  } catch (_e) { return null; }
}

/* GIS 콜백 — 구글 로그인 성공 시 호출 (어느 탭에서든 동일 콜백) */
async function onGoogleSignIn(response){
  const payload = _decodeJwt(response.credential);
  if(!payload?.email){ toast('Google 로그인 실패: 토큰 오류','err'); return; }
  const activeRole = window._gsiActiveRole || 'aj';
  if(activeRole === 'tech') await _doGoogleTechLogin(payload.email, payload.name||'');
  else if(activeRole === 'sub') await _doGoogleSubLogin(payload.email, payload.name||'');
  else await _doGoogleAjLogin(payload.email, payload.name||'');
}

/* ── 기술인 Google 로그인 ── */
async function _doGoogleTechLogin(email, googleName){
  toast('Google 계정 확인 중...','ok',2000);
  const allMembers = getMembers();
  // google_email 기준으로 기술인 레코드 검색 (role='tech' 또는 title='기술인')
  let member = allMembers.find(m=>m.google_email===email && (m.role==='tech'||m.title==='기술인'));
  if(!member){
    try {
      const rows = await sbReq('members','GET',null,
        `?google_email=eq.${encodeURIComponent(email)}&role=eq.tech&limit=1`);
      if(rows?.length){
        member=rows[0];
        allMembers.push(member);
        saveMembers(allMembers);
      }
    } catch (_e) {}
  }
  // 프로필 입력 모달 열기 (신규 또는 재확인)
  _showGoogleProfileModal('tech',{
    email, googleName,
    name:member?.name||googleName||'',
    phone:member?.phone||'',
    siteId:member?.siteId||'',
    company:member?.company||'',
    existingId:member?.id||null
  });
}

/* ── 협력사 Google 로그인 ── */
async function _doGoogleSubLogin(email, googleName){
  toast('Google 계정 확인 중...','ok',2000);
  const allMembers = getMembers();
  let member = allMembers.find(m=>m.google_email===email && m.role!=='tech' && m.title!=='기술인');
  if(!member){
    try {
      const rows = await sbReq('members','GET',null,
        `?google_email=eq.${encodeURIComponent(email)}&role=eq.sub&limit=1`);
      if(rows?.length){
        member=rows[0];
        const idx=allMembers.findIndex(m=>m.id===member.id);
        if(idx>=0) allMembers[idx]=member; else allMembers.push(member);
        saveMembers(allMembers);
      }
    } catch (_e) {}
  }
  if(member){
    const st = member.status||'approved';
    if(st==='approved'){
      // 로그인 성공
      S={role:'sub',name:member.name,title:member.title||'',phone:member.phone||'',
         company:member.company,siteId:member.siteId,
         siteName:getSites().find(s=>s.id===member.siteId)?.name||member.siteId,
         loginAt:Date.now(), memberId:member.id||''};
      DB.s(K.SESSION,S); DB.s('auto_login',true);
      toast(`${member.name}님 환영합니다!`,'ok');
      enterApp();
    } else if(st==='pending'){
      toast('가입 승인 대기 중입니다. AJ관리자에게 문의하세요.','warn',4000);
    } else {
      toast('가입이 거절되었습니다. AJ관리자에게 문의하세요.','err');
    }
    return;
  }
  // 미등록 → 프로필 입력
  _showGoogleProfileModal('sub',{email, googleName});
}

/* ── 프로필 모달 열기 (Google·카카오 공통) ── */
function _showGoogleProfileModal(mode, data){
  window._gpfMode = mode;
  window._gpfEmail = data.email;
  window._gpfExistingId = data.existingId||null;
  window._gpfKakaoId = data.kakaoId||'';
  const isKakao = !!data.kakaoId;
  // 제목/설명
  document.getElementById('gpf-title').textContent = mode==='tech'?'기술인 프로필 입력':'협력사 담당자 가입';
  document.getElementById('gpf-desc').textContent = mode==='tech'
    ? '현장·업체를 선택하고 프로필을 입력해주세요.'
    : '정보 입력 후 AJ관리자 승인이 완료되면 로그인됩니다.';
  // 연동 계정 아이콘 (G: Google / K: 카카오)
  const icon = document.getElementById('gpf-provider-icon');
  if(icon){
    if(isKakao){
      icon.style.background='rgba(254,229,0,.25)'; icon.style.color='#191919'; icon.textContent='K';
    } else {
      icon.style.background='rgba(234,67,53,.15)'; icon.style.color='#EA4335'; icon.textContent='G';
    }
  }
  document.getElementById('gpf-email').textContent = data.email||'';
  document.getElementById('gpf-gname').textContent = data.googleName||data.email.split('@')[0];
  // 버튼 색상
  const btn = document.getElementById('gpf-submit-btn');
  btn.className = 'login-btn '+(mode==='tech'?'tech':'sub');
  btn.textContent = mode==='tech'?'시작하기':'가입 신청';
  // 직함 필드 (sub만) / 팀명 필드 (tech만)
  document.getElementById('gpf-jobtitle-wrap').style.display = mode==='sub'?'':'none';
  document.getElementById('gpf-jobtitle').value = data.title||'';
  const teamWrap = document.getElementById('gpf-team-wrap');
  if(teamWrap){ teamWrap.style.display = mode==='tech'?'':'none'; }
  const teamEl = document.getElementById('gpf-team');
  if(teamEl) teamEl.value = data.team||'';
  // 현장 셀렉트 초기화
  const siteEl = document.getElementById('gpf-site');
  const sites = getSites();
  siteEl.innerHTML = '<option value="">현장 선택</option>' +
    sites.map(s=>`<option value="${s.id}"${s.id===data.siteId?' selected':''}>${s.name}</option>`).join('');
  // 업체 초기화
  syncGpfCoList();
  if(data.company) document.getElementById('gpf-company').value = data.company;
  // 이름/연락처
  document.getElementById('gpf-name').value = data.name||'';
  document.getElementById('gpf-phone').value = data.phone||'';
  document.getElementById('modal-gprofile').style.display='flex';
}

/* 프로필 모달 - 현장 변경 시 업체 목록 동기화 */
function syncGpfCoList(){
  const siteEl = document.getElementById('gpf-site');
  const coEl   = document.getElementById('gpf-company');
  if(!siteEl||!coEl) return;
  const siteId = siteEl.value;
  const cos = siteId ? getCos(siteId) : [];
  coEl.innerHTML = '<option value="">업체 선택</option>' +
    cos.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  if(cos.length) coEl.value = cos[0].name;
}

/* 프로필 모달 제출 */
async function doGoogleProfileSubmit(){
  const mode    = window._gpfMode;
  const email   = window._gpfEmail;
  const site    = document.getElementById('gpf-site').value;
  const co      = document.getElementById('gpf-company').value;
  const name    = document.getElementById('gpf-name').value.trim();
  const phone   = document.getElementById('gpf-phone').value.trim();
  const title   = mode==='sub'?(document.getElementById('gpf-jobtitle')?.value.trim()||''):'기술인';
  const team    = mode==='tech'?(document.getElementById('gpf-team')?.value.trim()||''):'';
  if(!site||!co||!name||!phone){ toast('모든 항목을 입력해주세요','err'); return; }
  const siteObj = getSites().find(s=>s.id===site);
  const siteName = siteObj?.name||site;
  const allMembers = getMembers();
  let member = window._gpfExistingId ? allMembers.find(m=>m.id===window._gpfExistingId) : null;
  const isNew = !member;
  if(isNew){
    // 중복 체크 (같은 google_email이 이미 있으면 업데이트)
    const dup = allMembers.find(m=>m.google_email===email);
    if(dup) member = dup;
  }
  const status = mode==='tech'?'approved':(window._inviteCodeOk?'approved':'pending');
  const role   = mode==='tech'?'tech':'sub';
  const id     = member?.id || (role+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7));
  const record = {
    id, name, company:co, siteId:site, siteName, phone, title, team,
    role, status, google_email:email,
    kakao_id: window._gpfKakaoId||member?.kakao_id||'',
    joinedAt: member?.joinedAt||Date.now(), synced:false
  };
  // Supabase 서버 먼저 저장
  try {
    await sbReq('members','POST',[{
      record_id:record.id, name:record.name, company:record.company,
      site_id:record.siteId, site_name:record.siteName, phone:record.phone,
      title:record.title, team:record.team||'',
      google_email:email, kakao_id:record.kakao_id||'',
      status:record.status, role:record.role,
      joined_at:new Date(record.joinedAt).toISOString()
    }],'?on_conflict=record_id');
    record.synced=true;
  } catch(e){
    console.warn('[doGoogleProfileSubmit] SB 저장 실패:',e);
    const _em = e?.message||'';
    if(_em==='NO_SB_URL') toast('서버 연결 정보가 없습니다. 관리자에게 문의하세요.','err',4000);
    else toast(`가입 신청 실패: ${_em.slice(0,80)||'서버 오류'}`,'err',4000);
    return;
  }
  // 로컬 저장
  const idx = allMembers.findIndex(m=>m.id===id);
  if(idx>=0) allMembers[idx]=record; else allMembers.push(record);
  saveMembers(allMembers);
  document.getElementById('modal-gprofile').style.display='none';
  if(mode==='tech'){
    // 바로 로그인
    S={role:'tech',name,phone,company:co,siteId:site,siteName,team,loginAt:Date.now()};
    DB.s(K.SESSION,S); DB.s('auto_login',true);
    enterApp();
  } else if(window._inviteCodeOk){
    // 초대코드로 즉시 승인 — 바로 로그인
    window._inviteCodeOk = false;
    S={role:'sub',name,title:record.title||'',phone,company:co,siteId:site,siteName,loginAt:Date.now(),memberId:id};
    DB.s(K.SESSION,S); DB.s('auto_login',true);
    toast('가입 완료! 로그인됩니다.','ok',2000);
    enterApp();
  } else {
    // 일반 가입 신청 — AJ 승인 대기
    addNotif({icon:'',title:`신규 관리자 가입신청: ${co}`,
      desc:`${co} ${name}님이 가입을 신청했습니다. 승인이 필요합니다.`});
    pushSBNotif({target_aj_type:'관리자', type:'signup_request', title:`신규 가입신청: ${co}`, body:`${co} ${name}님이 가입을 신청했습니다. 승인이 필요합니다.`, ref_id:record.id}).catch(()=>{});
    toast('가입 신청 완료! AJ관리자 승인 후 로그인 가능합니다.','ok',4000);
  }
}

/* ── Google 이메일로 AJ 멤버 조회 후 로그인 ── */
async function _doGoogleAjLogin(email, googleName){
  toast('Google 계정 확인 중...','ok',2000);
  await _pullAjMembersFromSB().catch(()=>{});
  const list = _getAjMembers();
  // google_email 일치 계정 중 approved 우선 선택
  const byEmail = list.filter(m => m.google_email === email);
  const member = byEmail.find(m => (m.status||'approved') === 'approved') || byEmail[0] || null;
  if(!member){ _showGoogleLinkModal(email, googleName); return; }
  const _st = member.status||'approved';
  if(_st==='pending'){ toast('가입 승인 대기 중입니다. AJ 관리자에게 문의하세요.','warn',4000); return; }
  if(_st==='rejected'){ toast('가입이 거절되었습니다. AJ 관리자에게 문의하세요.','err',4000); return; }
  DB.s(K.AJ_MEMBER, member);
  S={ role:'aj', name:member.name, phone:member.phone||'', ajType:member.aj_type||'관리자',
      company:'AJ네트웍스', siteId:'all', siteName:'전체 현장', loginAt:Date.now(), empNo:member.emp_no,
      memberId: member.record_id||member.id||'' };
  DB.s(K.SESSION, S); DB.s('auto_login', true);
  toast(`${member.name}님 환영합니다!`,'ok'); enterApp();
}

/* ═══════════════════════════════════════════════════════════
   카카오 로그인
═══════════════════════════════════════════════════════════ */
function _kakaoInit(){
  const key = KAKAO_DEFAULT_JS_KEY || DB.g('kakao_js_key','');
  if(!key) return;
  if(typeof Kakao === 'undefined') return;
  if(!Kakao.isInitialized()) Kakao.init(key);
  ['tech','sub','aj'].forEach(r=>{
    const btn = document.getElementById('kakao-btn-'+r);
    if(btn) btn.style.display = 'block';
  });
}

/* PKCE 헬퍼 — code_verifier / code_challenge 생성 */
async function _kakaoGenPKCE(){
  const arr = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...arr))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return { verifier, challenge };
}

async function _doKakaoLogin(role){
  const key = KAKAO_DEFAULT_JS_KEY || DB.g('kakao_js_key','');
  if(!key){ toast('카카오 로그인 설정이 필요합니다. 관리자에게 문의하세요.','warn',4000); return; }
  // PKCE Authorization Code Flow (response_type=token은 신규앱 차단 KOE202)
  const { verifier, challenge } = await _kakaoGenPKCE();
  sessionStorage.setItem('_kakaoRole', role);
  sessionStorage.setItem('_kakaoVerifier', verifier);
  const redirectUri = window.location.origin;
  window.location.href =
    `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(key)}`+
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=profile_nickname`+
    `&code_challenge=${challenge}&code_challenge_method=S256`;
}

/* 카카오 리다이렉트 복귀 처리 (앱 초기화 시 호출) */
async function _checkKakaoToken(){
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if(!code) return;
  // URL 정리
  window.history.replaceState({}, document.title, window.location.pathname);
  const key = KAKAO_DEFAULT_JS_KEY || DB.g('kakao_js_key','');
  const verifier = sessionStorage.getItem('_kakaoVerifier') || '';
  const role = sessionStorage.getItem('_kakaoRole') || 'tech';
  sessionStorage.removeItem('_kakaoVerifier');
  sessionStorage.removeItem('_kakaoRole');
  toast('카카오 로그인 처리 중...','ok',2000);
  try {
    // code → access_token 교환 (PKCE, client_secret 불필요)
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: key,
        redirect_uri: window.location.origin,
        code,
        code_verifier: verifier,
      })
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    if(!token) throw new Error(tokenData.error_description || 'access_token 없음');
    // /v2/user/me 호출
    const res = await fetch('https://kapi.kakao.com/v2/user/me',{
      headers:{ 'Authorization': `Bearer ${token}` }
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const kakaoId = String(data.id);
    const nickname = data.properties?.nickname || data.kakao_account?.profile?.nickname || '';
    const email = data.kakao_account?.email || null;
    if(typeof Kakao!=='undefined'&&Kakao.isInitialized()) Kakao.Auth.setAccessToken(token);
    if(role==='tech') await _doKakaoTechLogin(kakaoId, nickname, email);
    else if(role==='sub') await _doKakaoSubLogin(kakaoId, nickname, email);
    else await _doKakaoAjLogin(kakaoId, nickname, email);
  } catch(e){
    console.warn('[Kakao] 로그인 처리 실패',e);
    toast('카카오 로그인 실패: '+e.message,'err',4000);
  }
}

async function _doKakaoTechLogin(kakaoId, nickname, email){
  toast('카카오 계정 확인 중...','ok',2000);
  const allMembers = getMembers();
  let member = allMembers.find(m=>m.kakao_id===kakaoId && (m.role==='tech'||m.title==='기술인'));
  if(!member){
    try {
      const rows = await sbReq('members','GET',null,`?kakao_id=eq.${encodeURIComponent(kakaoId)}&role=eq.tech&limit=1`);
      if(rows?.length){ member=rows[0]; allMembers.push(member); saveMembers(allMembers); }
    } catch(_e){}
  }
  _showGoogleProfileModal('tech',{
    email: email||`kakao:${kakaoId}`, googleName: nickname,
    name: member?.name||nickname||'',
    phone: member?.phone||'',
    siteId: member?.siteId||'',
    company: member?.company||'',
    existingId: member?.id||null,
    kakaoId
  });
}

async function _doKakaoSubLogin(kakaoId, nickname, email){
  toast('카카오 계정 확인 중...','ok',2000);
  const allMembers = getMembers();
  let member = allMembers.find(m=>m.kakao_id===kakaoId && m.role!=='tech' && m.title!=='기술인');
  if(!member){
    try {
      const rows = await sbReq('members','GET',null,`?kakao_id=eq.${encodeURIComponent(kakaoId)}&role=eq.sub&limit=1`);
      if(rows?.length){
        member=rows[0];
        const idx=allMembers.findIndex(m=>m.id===member.id);
        if(idx>=0) allMembers[idx]=member; else allMembers.push(member);
        saveMembers(allMembers);
      }
    } catch(_e){}
  }
  if(member){
    const st=member.status||'approved';
    if(st==='approved'){
      S={role:'sub',name:member.name,title:member.title||'',phone:member.phone||'',
         company:member.company,siteId:member.siteId,
         siteName:getSites().find(s=>s.id===member.siteId)?.name||member.siteId,
         loginAt:Date.now(), memberId:member.id||''};
      DB.s(K.SESSION,S); DB.s('auto_login',true);
      toast(`${member.name}님 환영합니다!`,'ok'); enterApp();
    } else if(st==='pending'){
      toast('가입 승인 대기 중입니다. AJ관리자에게 문의하세요.','warn',4000);
    } else {
      toast('가입이 거절되었습니다. AJ관리자에게 문의하세요.','err');
    }
    return;
  }
  _showGoogleProfileModal('sub',{email:email||`kakao:${kakaoId}`, googleName:nickname, kakaoId});
}

async function _doKakaoAjLogin(kakaoId, nickname, email){
  toast('카카오 계정 확인 중...','ok',2000);
  await _pullAjMembersFromSB().catch(()=>{});
  const list = _getAjMembers();
  const byKakao = list.filter(m=>m.kakao_id===kakaoId);
  const member = byKakao.find(m=>(m.status||'approved')==='approved') || byKakao[0] || null;
  if(!member){ _showGoogleLinkModal(email||`kakao:${kakaoId}`, nickname); return; }
  const _st = member.status||'approved';
  if(_st==='pending'){ toast('가입 승인 대기 중입니다. AJ 관리자에게 문의하세요.','warn',4000); return; }
  if(_st==='rejected'){ toast('가입이 거절되었습니다. AJ 관리자에게 문의하세요.','err',4000); return; }
  DB.s(K.AJ_MEMBER, member);
  S={ role:'aj', name:member.name, phone:member.phone||'', ajType:member.aj_type||'관리자',
      company:'AJ네트웍스', siteId:'all', siteName:'전체 현장', loginAt:Date.now(), empNo:member.emp_no,
      memberId: member.record_id||member.id||'' };
  DB.s(K.SESSION, S); DB.s('auto_login', true);
  toast(`${member.name}님 환영합니다!`,'ok'); enterApp();
}

function _adminLogin(){
  const pw = prompt('관리자 암호를 입력하세요');
  if(pw === null) return;
  if(pw !== 'aj2025!'){ toast('암호가 올바르지 않습니다.','err',3000); return; }
  S = { role:'aj', name:'관리자', phone:'', ajType:'관리자',
        company:'AJ네트웍스', siteId:'all', siteName:'전체 현장',
        loginAt:Date.now(), empNo:'admin', memberId:'' };
  DB.s(K.SESSION, S);
  toast('관리자로 로그인됩니다.','ok');
  enterApp();
}

/* 협력사 관리자 초대코드 — 유효하면 가입 즉시 승인 */
function _enterInviteCode(){
  const stored = DB.g('sub_invite_code','');
  if(!stored){
    toast('초대코드가 설정되지 않았습니다. AJ관리자에게 문의하세요.','warn',3000);
    return;
  }
  const code = prompt('AJ관리자에게 받은 초대코드를 입력하세요');
  if(code === null) return;
  if(code.trim() !== stored.trim()){
    toast('초대코드가 올바르지 않습니다.','err',3000);
    return;
  }
  window._inviteCodeOk = true;
  toast('초대코드 확인! Google 또는 카카오로 가입해주세요.','ok',3000);
}
function _saveInviteCode(){
  const v = document.getElementById('invite-code-input')?.value.trim()||'';
  DB.s('sub_invite_code', v);
  toast(v ? `초대코드 저장됨: ${v}` : '초대코드 비활성화됨', 'ok');
}
function _loadInviteCodeInput(){
  const el = document.getElementById('invite-code-input');
  if(el) el.value = DB.g('sub_invite_code','');
}

/* ═══════════════════════════════════════════════════════════
   OS 알림 (Web Notifications + App Badge)
   - PC PWA: OS 우측하단 네이티브 알림
   - 모바일 PWA: 앱 아이콘 뱃지 + 알림 팝업
═══════════════════════════════════════════════════════════ */
async function _requestNotifPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted') return true;
  if(Notification.permission === 'denied') return false;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

async function _showOSNotif(title, body, tag){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-72.png',
                 tag: tag||'ajpjt', renotify: true };
  try {
    if(navigator.serviceWorker?.controller){
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } else {
      new Notification(title, opts);
    }
  } catch(e){ console.warn('[Notif]', e); }
}

function _setAppBadge(count){
  if('setAppBadge' in navigator){
    count > 0 ? navigator.setAppBadge(count).catch(()=>{}) : navigator.clearAppBadge().catch(()=>{});
  }
}

async function _checkPendingNotif(){
  if(S?.role !== 'aj') return;
  const pending = getMembers().filter(m => (m.status||'pending') === 'pending' && m.role !== 'tech');
  const count = pending.length;
  _setAppBadge(count);
  if(count === 0) return;
  // 이미 알림을 보낸 ID는 중복 발송하지 않음
  const notifiedSet = new Set(JSON.parse(DB.g('_notif_pend_ids','[]')));
  const newOnes = pending.filter(m => !notifiedSet.has(m.record_id||m.id));
  if(!newOnes.length) return;
  const granted = await _requestNotifPermission();
  if(!granted) return;
  const names = newOnes.map(m=>`${m.company||''} ${m.name||''}`.trim()).join(', ');
  await _showOSNotif(
    `가입 승인 요청 ${count}건`,
    `${names}님의 가입 승인이 필요합니다.`,
    'pending-approval'
  );
  newOnes.forEach(m => notifiedSet.add(m.record_id||m.id));
  DB.s('_notif_pend_ids', JSON.stringify([...notifiedSet]));
}

// AJ 관리자 홈화면 — 미입력 업체 담당자에게 일괄 알림 발송
async function _pushMissingNotif(){
  if(S?.role !== 'aj'){ toast('AJ 관리자만 사용 가능합니다','err'); return; }
  const sites = getSites();
  const tdStr = today();
  const todayLogs = (await getTodayLogs().catch(()=>[])) || [];
  const submitted = new Set(todayLogs.map(l=>l.company));
  const allMembers = getMembers();
  let sent = 0;
  for(const s of sites){
    for(const co of getCos(s.id)){
      if(submitted.has(co.name)) continue;
      // 해당 업체의 협력사 담당자 찾기
      const subMgr = allMembers.find(m =>
        m.company === co.name && (m.role==='sub'||(!m.role&&m.title!=='기술인')) &&
        (m.status||'approved')==='approved'
      );
      const tid = subMgr?.record_id || subMgr?.id || null;
      pushSBNotif({
        target_user_id: tid,
        target_role: tid ? null : 'sub',
        site_id: s.id,
        type: 'missing_log',
        title: `⚠ 가동 미입력 알림 [${s.name||s.id}]`,
        body: `${co.name} — 오늘(${tdStr}) 가동현황이 입력되지 않았습니다.`,
        ref_id: co.name,
      }).catch(()=>{});
      sent++;
    }
  }
  if(sent > 0) toast(`미입력 ${sent}개 업체 담당자에게 알림 발송 ✓`, 'ok', 3000);
  else toast('미입력 업체가 없습니다', 'ok');
}

function saveKakaoConfig(){
  const key = document.getElementById('kakao-key-input')?.value.trim()||'';
  if(!key){ toast('카카오 키를 입력하세요','err'); return; }
  DB.s('kakao_js_key', key);
  _kakaoInit();
  toast('카카오 설정 저장됨 ✓','ok');
}

/* Google 가입 신청 모달 열기 */
function _showGoogleLinkModal(email, googleName){
  window._glEmail = email;
  document.getElementById('gl-email').textContent = email;
  document.getElementById('gl-gname').textContent = googleName || email.split('@')[0];
  document.getElementById('glName').value = googleName || '';
  document.getElementById('glPhone').value = '';
  toggleGlAjType('관리자'); // chip 초기화
  document.getElementById('modal-glink').style.display = 'flex';
}

/* 직무 유형 chip 토글 */
function toggleGlAjType(type){
  document.querySelectorAll('#gl-aj-type-chips .chip').forEach(c=>{
    const on = c.textContent===type;
    c.classList.toggle('on',on);
    c.style.background=on?'rgba(222,31,35,.15)':'transparent';
    c.style.color=on?'#f87171':'var(--tx2)';
    c.style.borderColor=on?'rgba(222,31,35,.4)':'var(--br)';
  });
}

/* Google AJ 관리자 가입 신청 */
async function doGoogleAjRegister(){
  const name   = document.getElementById('glName').value.trim();
  const phone  = document.getElementById('glPhone').value.trim();
  const ajTypeChip = document.querySelector('#gl-aj-type-chips .chip.on');
  const ajType = ajTypeChip?.textContent||'관리자';
  if(!name||!phone){ toast('이름과 연락처를 입력하세요','err'); return; }
  // 이미 이 Google 계정으로 가입된 경우 처리
  await _pullAjMembersFromSB().catch(()=>{});
  const localList = _getAjMembers();
  const dup = localList.find(m => m.google_email === window._glEmail);
  if(dup){
    const _st = dup.status||'approved';
    if(_st==='approved'){
      document.getElementById('modal-glink').style.display='none';
      DB.s(K.AJ_MEMBER, dup);
      S={ role:'aj', name:dup.name, phone:dup.phone||'', ajType:dup.aj_type||'관리자',
          company:'AJ네트웍스', siteId:'all', siteName:'전체 현장', loginAt:Date.now(), empNo:dup.emp_no };
      DB.s(K.SESSION, S); DB.s('auto_login', true);
      toast(`${dup.name}님 환영합니다!`,'ok'); enterApp(); return;
    }
    toast('이미 가입 신청된 계정입니다. 승인 대기 중입니다.','warn',4000);
    document.getElementById('modal-glink').style.display='none'; return;
  }
  // 신규 pending 계정 생성
  const empNo = 'G' + Date.now().toString(36).toUpperCase();
  const member = { emp_no:empNo, name, phone, pw_hash:'GOOGLE_AUTH', aj_type:ajType,
    google_email:window._glEmail, status:'pending', created_at:new Date().toISOString() };
  localList.push(member);
  _saveAjMembers(localList);
  document.getElementById('modal-glink').style.display='none';
  // Supabase 저장 (await — 실패 시 사용자에게 피드백)
  try {
    await sbBatchUpsert('aj_members', [member]);
    toast('가입 신청 완료! AJ 관리자 승인 후 로그인 가능합니다 ✓','ok',4000);
  } catch(e) {
    console.error('[Google Register] SB 저장 실패:', e?.message);
    toast(`가입 신청 완료(로컬 저장). 단, 서버 저장 실패: ${e?.message||'네트워크 오류'}`, 'warn', 5000);
  }
}

/* ── AJ 관리자 계정 관리 UI ── */
function openAjMemberMgr(){
  // 목록 보기 상태로 초기화
  const formEl = document.getElementById('aj-member-form');
  const listEl = document.getElementById('aj-member-list');
  if(formEl) formEl.style.display='none';
  if(listEl) listEl.style.display='block';
  renderAjMemberList();
  openSheet('sh-aj-members');
}
function renderAjMemberList(){
  const el = document.getElementById('aj-member-list');
  if(!el) return;
  const members = _getAjMembers();
  if(!members.length){
    el.innerHTML='<div style="text-align:center;color:var(--tx3);padding:20px;font-size:12px">등록된 계정이 없습니다</div>';
    return;
  }
  el.innerHTML = members.map((m,i)=>`
    <div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;background:${m.aj_type==='관리자'?'rgba(222,31,35,.15)':'rgba(59,130,246,.15)'};color:${m.aj_type==='관리자'?'#f87171':'#60a5fa'}">${m.aj_type||'관리자'}</span>
        <span style="font-weight:800;font-size:13px;flex:1">${m.name}</span>
        ${m.emp_no==='admin'?'<span style="font-size:9px;background:rgba(245,158,11,.2);color:#fbbf24;padding:1px 5px;border-radius:4px;font-weight:700">ADMIN</span>':''}
      </div>
      ${m.phone?`<div style="font-size:11px;color:var(--tx2);margin-bottom:8px">${m.phone}</div>`:''}
      <div style="display:flex;gap:6px">
        <button class="btn-ghost" style="flex:1;font-size:10px;padding:4px" onclick="editAjMember(${i})">수정</button>
        <button class="btn-ghost" style="flex:1;font-size:10px;padding:4px;color:#fb923c;border-color:rgba(251,146,60,.3)" onclick="resetAjMemberPw(${i})">PW 초기화</button>
        ${m.emp_no==='admin'?'':`<button class="btn-ghost" style="flex:1;font-size:10px;padding:4px;color:#f87171;border-color:rgba(248,113,113,.3)" onclick="deleteAjMember(${i})">삭제</button>`}
      </div>
    </div>`).join('');
}
function showNewAjMemberForm(){
  document.getElementById('aj-mem-idx').value='-1';
  document.getElementById('aj-mem-name').value='';
  document.getElementById('aj-mem-phone').value='';
  document.getElementById('aj-mem-type').value='관리자';
  document.getElementById('aj-mem-pw').value='';
  document.getElementById('aj-mem-pw').placeholder='비밀번호 (6자 이상)';
  document.getElementById('aj-mem-form-title').textContent='신규 계정 추가';
  document.getElementById('aj-member-form').style.display='block';
  document.getElementById('aj-member-list').style.display='none';
  document.getElementById('aj-mem-new-btn').style.display='none';
}
function editAjMember(idx){
  const m = _getAjMembers()[idx];
  if(!m) return;
  document.getElementById('aj-mem-idx').value=idx;
  document.getElementById('aj-mem-name').value=m.name;
  document.getElementById('aj-mem-phone').value=m.phone||'';
  document.getElementById('aj-mem-type').value=m.aj_type||'관리자';
  document.getElementById('aj-mem-pw').value='';
  document.getElementById('aj-mem-pw').placeholder='변경 시에만 입력 (6자 이상)';
  document.getElementById('aj-mem-form-title').textContent='계정 수정';
  document.getElementById('aj-member-form').style.display='block';
  document.getElementById('aj-member-list').style.display='none';
  document.getElementById('aj-mem-new-btn').style.display='none';
}
async function saveAjMember(){
  const idx = +document.getElementById('aj-mem-idx').value;
  const name = document.getElementById('aj-mem-name').value.trim();
  const phone = document.getElementById('aj-mem-phone').value.trim();
  const ajType = document.getElementById('aj-mem-type').value;
  const pw = document.getElementById('aj-mem-pw').value;
  if(!name){ toast('이름은 필수입니다','err'); return; }
  const members = _getAjMembers();
  const isNew = idx === -1;
  if(isNew && !pw){ toast('신규 계정은 비밀번호를 입력하세요','err'); return; }
  if(pw && pw.length<6){ toast('비밀번호는 6자 이상이어야 합니다','err'); return; }
  const empNo = isNew ? ('M'+Date.now().toString(36).toUpperCase()) : members[idx].emp_no;
  const member = isNew
    ? {emp_no:empNo, name, phone, pw_hash:await sha256(pw), aj_type:ajType, created_at:new Date().toISOString()}
    : {...members[idx], name, phone, aj_type:ajType};
  if(!isNew && pw) member.pw_hash = await sha256(pw);
  if(isNew) members.unshift(member);
  else members[idx] = member;
  _saveAjMembers(members);
  _syncAjMemberSb(member);
  toast(isNew?'계정이 추가되었습니다':'계정이 수정되었습니다','ok');
  closeAjMemberForm();
}
async function resetAjMemberPw(idx){
  const members = _getAjMembers();
  const m = members[idx];
  if(!m) return;
  const newPw = prompt(`[${m.name}] 새 비밀번호 입력 (6자 이상):`);
  if(!newPw) return;
  if(newPw.length<6){ toast('비밀번호는 6자 이상이어야 합니다','err'); return; }
  members[idx].pw_hash = await sha256(newPw);
  _saveAjMembers(members);
  _patchAjMemberSb(m.emp_no, {pw_hash:members[idx].pw_hash});
  toast(`[${m.name}] 비밀번호가 초기화되었습니다`,'ok');
}
function deleteAjMember(idx){
  const members = _getAjMembers();
  const m = members[idx];
  if(!m) return;
  if(m.emp_no==='admin'){ toast('admin 계정은 삭제할 수 없습니다','err'); return; }
  if(!confirm(`[${m.name}] 계정을 삭제하시겠습니까?`)) return;
  members.splice(idx,1);
  _saveAjMembers(members);
  _deleteAjMemberSb(m.emp_no);
  toast('계정이 삭제되었습니다','ok');
  renderAjMemberList();
}
function closeAjMemberForm(){
  document.getElementById('aj-member-form').style.display='none';
  document.getElementById('aj-member-list').style.display='block';
  document.getElementById('aj-mem-new-btn').style.display='block';
  renderAjMemberList();
}

/* ══════════════════════════════════════════════
   통합 관리자 계정 관리 (sh-acct-mgr)
══════════════════════════════════════════════ */
function openAcctMgr(tab){
  tab = tab||'aj';
  openSheet('sh-acct-mgr');
  setTimeout(()=>switchAcctTab(tab),30);
}
function switchAcctTab(tab){
  ['aj','sub','invite'].forEach(t=>{
    const pane=document.getElementById('acct-pane-'+t);
    const btn=document.getElementById('acct-tab-'+t);
    if(pane) pane.style.display=(t===tab)?'':'none';
    if(btn){
      btn.style.borderBottomColor=(t===tab)?'var(--red)':'transparent';
      btn.style.color=(t===tab)?'var(--red)':'var(--tx2)';
      btn.style.fontWeight=(t===tab)?'700':'500';
    }
  });
  if(tab==='aj') renderAcctAjList();
  else if(tab==='sub') renderAcctSubList();
  else if(tab==='invite') renderAcctInviteCodes();
}
function renderAcctAjList(){
  const el=document.getElementById('acct-aj-list'); if(!el) return;
  // 대기 중 먼저 정렬
  const members=[..._getAjMembers()].sort((a,b)=>{
    const sa=(a.status||'approved')==='pending'?0:1;
    const sb=(b.status||'approved')==='pending'?0:1;
    return sa-sb;
  });
  // AJ 대기 중 배지 업데이트
  const ajPendingCnt=members.filter(m=>(m.status||'approved')==='pending').length;
  const ajCntEl=document.getElementById('aj-pending-cnt');
  if(ajCntEl){ ajCntEl.textContent=ajPendingCnt; ajCntEl.style.display=ajPendingCnt>0?'inline':'none'; }
  if(!members.length){ el.innerHTML='<div style="text-align:center;color:var(--tx3);padding:20px;font-size:12px">등록된 계정이 없습니다</div>'; return; }
  const statusLabel={pending:'대기중',approved:'',rejected:'거절됨'};
  el.innerHTML=members.map((m,i)=>{
    const st=m.status||'approved';
    const isPending=st==='pending';
    const isRejected=st==='rejected';
    const isGoogleOnly=m.pw_hash==='GOOGLE_AUTH';
    return `
    <div style="background:var(--bg2);border:1px solid ${isPending?'rgba(245,158,11,.4)':isRejected?'rgba(239,68,68,.3)':'var(--br)'};border-radius:10px;padding:9px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:5px;background:${m.aj_type==='관리자'?'rgba(222,31,35,.15)':'rgba(59,130,246,.15)'};color:${m.aj_type==='관리자'?'#f87171':'#60a5fa'};flex-shrink:0">${m.aj_type||'관리자'}</span>
        <span style="font-weight:800;font-size:12px">${m.name}${m.emp_no==='admin'?' <span style="font-size:9px;background:rgba(245,158,11,.2);color:#fbbf24;padding:1px 5px;border-radius:3px">ADMIN</span>':''}</span>
        ${isPending?`<span class="mbr-badge pending">대기중</span>`:isRejected?`<span class="mbr-badge rejected">거절됨</span>`:''}
        ${isGoogleOnly?'<span style="font-size:9px;background:rgba(234,67,53,.15);color:#EA4335;padding:1px 5px;border-radius:3px;font-weight:700">Google</span>':''}
        <div style="display:flex;gap:3px;margin-left:auto;flex-shrink:0">
          ${isPending
            ?`<button class="btn-ghost" style="font-size:9px;padding:2px 7px;color:#4ade80;border-color:rgba(74,222,128,.4)" onclick="approveAjMember('${m.emp_no}')">승인</button>
               <button class="btn-ghost" style="font-size:9px;padding:2px 7px;color:#f87171;border-color:rgba(248,113,113,.3)" onclick="rejectAjMember('${m.emp_no}')">거절</button>`
            :`<button class="btn-ghost" style="font-size:9px;padding:2px 6px" onclick="editAcctAjMember(${i})">수정</button>
               ${!isGoogleOnly?`<button class="btn-ghost" style="font-size:9px;padding:2px 6px;color:#fb923c;border-color:rgba(251,146,60,.3)" onclick="resetAcctAjPw(${i})">PW초기화</button>`:''}
               ${m.emp_no==='admin'?'':`<button class="btn-ghost" style="font-size:9px;padding:2px 6px;color:#f87171;border-color:rgba(248,113,113,.3)" onclick="deleteAcctAjMember(${i})">삭제</button>`}`
          }
        </div>
      </div>
      <div style="font-size:10px;color:var(--tx3);margin-top:3px;padding-left:2px">${m.phone?`<span style="color:var(--tx2)">${m.phone}</span>`:'연락처 없음'}${m.google_email?` · <span style="color:#EA4335">${m.google_email}</span>`:''}</div>
    </div>`;
  }).join('');
}
/* AJ 관리자 가입 승인 / 거절 */
function approveAjMember(empNo){
  const members=_getAjMembers();
  const idx=members.findIndex(m=>m.emp_no===empNo); if(idx<0) return;
  members[idx].status='approved';
  _saveAjMembers(members);
  _patchAjMemberSb(empNo,{status:'approved'});
  toast(`[${members[idx].name}] 가입 승인되었습니다`,'ok');
  renderAcctAjList();
}
function rejectAjMember(empNo){
  const members=_getAjMembers();
  const idx=members.findIndex(m=>m.emp_no===empNo); if(idx<0) return;
  members[idx].status='rejected';
  _saveAjMembers(members);
  _patchAjMemberSb(empNo,{status:'rejected'});
  toast(`[${members[idx].name}] 가입이 거절되었습니다`,'warn');
  renderAcctAjList();
}

let _subFilter='all'; // 'all' | 'pending' | 'approved'
function setSubFilter(f){
  _subFilter=f;
  ['all','pending','approved'].forEach(t=>{
    const btn=document.getElementById('sub-filter-'+t);
    if(!btn) return;
    const on=(t===f);
    btn.style.background=on?'rgba(20,184,166,.15)':'transparent';
    btn.style.borderColor=on?'rgba(20,184,166,.4)':'var(--br)';
    btn.style.color=on?'var(--teal)':'var(--tx2)';
    btn.style.fontWeight=on?'700':'500';
  });
  renderAcctSubList();
}
function renderAcctSubList(){
  const el=document.getElementById('acct-sub-list'); if(!el) return;
  const siteId=S?.siteId==='all'?null:S?.siteId;
  // 협력사(sub) 멤버만 필터 (기술인 제외)
  let members=getMembers().filter(m=>
    (m.role==='sub'||(!m.role&&m.title!=='기술인'))&&
    (!siteId||m.siteId===siteId)
  );
  // 대기 중 개수 배지 + OS 뱃지/알림 갱신
  const pendingCnt=members.filter(m=>(m.status||'approved')==='pending').length;
  _setAppBadge(pendingCnt);
  if(pendingCnt > 0) _checkPendingNotif();
  const cntEl=document.getElementById('sub-pending-cnt');
  if(cntEl){ cntEl.textContent=pendingCnt; cntEl.style.display=pendingCnt>0?'inline':'none'; }
  // 필터 적용
  if(_subFilter==='pending')   members=members.filter(m=>(m.status||'approved')==='pending');
  if(_subFilter==='approved')  members=members.filter(m=>(m.status||'approved')==='approved');
  if(!members.length){
    el.innerHTML=`<div style="text-align:center;color:var(--tx3);padding:20px;font-size:12px">${
      _subFilter==='pending'?'대기 중인 가입 신청이 없습니다':'가입된 협력사 관리자가 없습니다'
    }</div>`;
    return;
  }
  // 대기중 먼저 정렬
  members.sort((a,b)=>{
    const sa=(a.status||'approved')==='pending'?0:1;
    const sb=(b.status||'approved')==='pending'?0:1;
    return sa-sb || (b.joinedAt||0)-(a.joinedAt||0);
  });
  const statusLabel={pending:'대기중',approved:'승인됨',rejected:'거절됨'};
  const all=getMembers();
  el.innerHTML=members.map(m=>{
    const st=m.status||'approved';
    const isPending=st==='pending';
    return `<div style="background:var(--bg2);border:1px solid ${isPending?'rgba(245,158,11,.3)':'var(--br)'};border-radius:10px;padding:10px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="mbr-badge ${st}">${statusLabel[st]||st}</span>
        <span style="font-weight:800;font-size:13px">${m.name}</span>${m.title?`<span style="font-size:10px;color:var(--tx3);margin-left:5px;font-weight:500">${m.title}</span>`:''}
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${isPending?`
            <button onclick="approveMember('${m.id}')" style="font-size:10px;padding:3px 8px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);border-radius:5px;color:#4ade80;cursor:pointer;font-weight:700">승인</button>
            <button onclick="rejectMember('${m.id}')" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid rgba(239,68,68,.3);border-radius:5px;color:#f87171;cursor:pointer">거절</button>
          `:`<button onclick="deleteAcctSubMemberId('${m.id}')" style="font-size:9px;padding:2px 6px;background:transparent;border:1px solid rgba(248,113,113,.3);border-radius:5px;color:#f87171;cursor:pointer">탈퇴처리</button>`}
        </div>
      </div>
      <div style="font-size:11px;color:var(--tx2);margin-top:4px">${m.company} · ${getSites().find(s=>s.id===m.siteId)?.name||m.siteId}</div>
      ${m.phone?`<div style="font-size:10px;color:var(--tx3);margin-top:2px">📞 ${m.phone}</div>`:''}
      ${m.title?`<div style="font-size:10px;color:var(--tx3)">직함: ${m.title}</div>`:''}
      ${m.google_email?`<div style="font-size:10px;color:var(--tx3)">Google: ${m.google_email}</div>`:''}
      <div style="font-size:10px;color:var(--tx3);margin-top:2px">가입: ${new Date(m.joinedAt).toLocaleDateString('ko-KR')}</div>
    </div>`;
  }).join('');
}

function approveMember(id){
  const all=getMembers();
  const m=all.find(a=>a.id===id); if(!m) return;
  m.status='approved'; m.synced=false;
  saveMembers(all);
  // Supabase 업데이트
  sbReq('members','PATCH',{status:'approved'},`?record_id=eq.${encodeURIComponent(id)}`).catch(()=>{});
  pushSBNotif({target_user_id:id, type:'signup_approved', title:'가입이 승인되었습니다', body:`${m.company} ${m.name}님의 가입이 승인되었습니다. 로그인 가능합니다.`, ref_id:id}).catch(()=>{});
  toast(`${m.name}님을 승인했습니다`,'ok');
  renderAcctSubList();
}
function rejectMember(id){
  const all=getMembers();
  const m=all.find(a=>a.id===id); if(!m) return;
  if(!confirm(`[${m.name}] 가입 신청을 거절하시겠습니까?`)) return;
  m.status='rejected'; m.synced=false;
  saveMembers(all);
  sbReq('members','PATCH',{status:'rejected'},`?record_id=eq.${encodeURIComponent(id)}`).catch(()=>{});
  toast(`${m.name}님의 가입이 거절되었습니다`,'ok');
  renderAcctSubList();
}
function deleteAcctSubMemberId(id){
  const all=getMembers();
  const m=all.find(a=>a.id===id); if(!m) return;
  if(!confirm(`[${m.name}] 협력사 관리자를 탈퇴 처리하시겠습니까?`)) return;
  const newAll=all.filter(a=>a.id!==id);
  saveMembers(newAll);
  sbReq('members','DELETE',null,`?record_id=eq.${encodeURIComponent(id)}`).catch(()=>{});
  toast('탈퇴 처리되었습니다','ok');
  renderAcctSubList();
}
function deleteAcctSubMember(idx){
  // 하위 호환 (기존 openMemberMgr에서 idx 기반 호출)
  const siteId=S?.siteId==='all'?null:S?.siteId;
  const all=getMembers();
  const filtered=all.filter(m=>(!siteId||m.siteId===siteId)&&(m.role==='sub'||(!m.role&&m.title!=='기술인')));
  const m=filtered[idx]; if(!m) return;
  deleteAcctSubMemberId(m.id);
}
function renderAcctInviteCodes(){
  const el=document.getElementById('acct-invite-codes'); if(!el) return;
  autoRotateInvite();
  const sites=getSites();
  if(!sites.length){ el.innerHTML='<div style="text-align:center;color:var(--tx3);padding:20px;font-size:12px">등록된 현장이 없습니다</div>'; return; }
  el.innerHTML=sites.map(s=>{
    const code=DB.g(K.INVITE_SITE+s.id,null)||DB.g(K.INVITE,'')||'(미설정)';
    return `<div style="margin-bottom:10px;padding:10px;background:var(--bg2);border:1px solid var(--br);border-radius:8px">
      <div style="font-size:11px;font-weight:700;margin-bottom:6px">${s.name}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span id="acct-invite-${s.id}" style="font-family:monospace;font-size:13px;font-weight:900;flex:1;padding:8px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:6px;color:#60a5fa">${code}</span>
        <button onclick="copyText(document.getElementById('acct-invite-${s.id}').textContent)" style="font-size:10px;padding:5px 10px;background:rgba(96,165,250,.15);border:1px solid rgba(96,165,250,.3);border-radius:6px;color:#60a5fa;cursor:pointer">복사</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="text" id="acct-new-code-${s.id}" placeholder="새 코드 입력 (6자 이상)" style="flex:1;padding:6px 8px;font-size:11px;background:var(--bg3);border:1px solid var(--br);border-radius:4px;color:var(--tx)">
        <button onclick="saveInviteCodeSite('${s.id}',document.getElementById('acct-new-code-${s.id}')?.value)" style="padding:5px 10px;font-size:10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:4px;color:rgb(99,102,241);cursor:pointer;white-space:nowrap">저장</button>
      </div>
    </div>`;
  }).join('');
}
/* ── 통합 관리자 폼 (AJ탭) ── */
function showNewAjMemberForm2(){
  document.getElementById('acct-aj-idx').value='-1';
  document.getElementById('acct-aj-name').value='';
  document.getElementById('acct-aj-phone').value='';
  document.getElementById('acct-aj-type').value='관리자';
  document.getElementById('acct-aj-pw').value='';
  document.getElementById('acct-aj-pw').placeholder='비밀번호 (6자 이상)';
  document.getElementById('acct-aj-form-title').textContent='신규 계정 추가';
  document.getElementById('acct-aj-form').style.display='block';
  document.getElementById('acct-aj-list').style.display='none';
  document.getElementById('acct-aj-new-btn').style.display='none';
}
function editAcctAjMember(idx){
  const m=_getAjMembers()[idx]; if(!m) return;
  document.getElementById('acct-aj-idx').value=idx;
  document.getElementById('acct-aj-name').value=m.name;
  document.getElementById('acct-aj-phone').value=m.phone||'';
  document.getElementById('acct-aj-type').value=m.aj_type||'관리자';
  document.getElementById('acct-aj-pw').value='';
  document.getElementById('acct-aj-pw').placeholder='변경 시에만 입력';
  document.getElementById('acct-aj-form-title').textContent='계정 수정';
  document.getElementById('acct-aj-form').style.display='block';
  document.getElementById('acct-aj-list').style.display='none';
  document.getElementById('acct-aj-new-btn').style.display='none';
}
async function saveAcctAjMember(){
  const idx=+document.getElementById('acct-aj-idx').value;
  const name=document.getElementById('acct-aj-name').value.trim();
  const phone=document.getElementById('acct-aj-phone').value.trim();
  const ajType=document.getElementById('acct-aj-type').value;
  const pw=document.getElementById('acct-aj-pw').value;
  if(!name){ toast('이름은 필수입니다','err'); return; }
  const members=_getAjMembers(); const isNew=idx===-1;
  if(isNew&&!pw){ toast('신규 계정은 비밀번호를 입력하세요','err'); return; }
  if(pw&&pw.length<6){ toast('비밀번호는 6자 이상이어야 합니다','err'); return; }
  const empNo=isNew?('M'+Date.now().toString(36).toUpperCase()):members[idx].emp_no;
  const member=isNew?{emp_no:empNo,name,phone,pw_hash:await sha256(pw),aj_type:ajType,created_at:new Date().toISOString()}:{...members[idx],name,phone,aj_type:ajType};
  if(!isNew&&pw) member.pw_hash=await sha256(pw);
  if(isNew) members.unshift(member); else members[idx]=member;
  _saveAjMembers(members); _syncAjMemberSb(member);
  toast(isNew?'계정이 추가되었습니다':'계정이 수정되었습니다','ok');
  closeAcctAjForm();
}
async function resetAcctAjPw(idx){
  const members=_getAjMembers(); const m=members[idx]; if(!m) return;
  const newPw=prompt(`[${m.name}] 새 비밀번호 입력 (6자 이상):`); if(!newPw) return;
  if(newPw.length<6){ toast('비밀번호는 6자 이상이어야 합니다','err'); return; }
  members[idx].pw_hash=await sha256(newPw);
  _saveAjMembers(members); _patchAjMemberSb(m.emp_no,{pw_hash:members[idx].pw_hash});
  toast(`[${m.name}] 비밀번호가 초기화되었습니다`,'ok');
}
function deleteAcctAjMember(idx){
  const members=_getAjMembers(); const m=members[idx]; if(!m) return;
  if(m.emp_no==='admin'){ toast('admin 계정은 삭제할 수 없습니다','err'); return; }
  if(!confirm(`[${m.name}] 계정을 삭제하시겠습니까?`)) return;
  members.splice(idx,1); _saveAjMembers(members);
  _deleteAjMemberSb(m.emp_no);
  toast('계정이 삭제되었습니다','ok'); renderAcctAjList();
}
function closeAcctAjForm(){
  document.getElementById('acct-aj-form').style.display='none';
  document.getElementById('acct-aj-list').style.display='block';
  document.getElementById('acct-aj-new-btn').style.display='block';
  renderAcctAjList();
}

/* ══════════════════════════════════════════════
   AS 현황 분석 (AJ 전용)
══════════════════════════════════════════════ */
function openASAnalysis(filterUpdate){
  if(!window._asAnalFilter) window._asAnalFilter={period:'3',company:'',equip:'',type:''};
  if(filterUpdate) Object.assign(window._asAnalFilter, filterUpdate);
  const f=window._asAnalFilter;

  const siteId=S?.siteId==='all'?null:S?.siteId;
  const allSiteReqs=getAsReqs().filter(r=>!siteId||r.siteId===siteId);

  // 필터 드롭다운 옵션
  const allCos=[...new Set(allSiteReqs.map(r=>r.company||'').filter(Boolean))].sort();
  const allTypes=[...new Set(allSiteReqs.map(r=>r.faultType||r.type||'기타').filter(Boolean))].sort();

  // 기간 필터
  let reqs=allSiteReqs;
  if(f.period!=='all'){
    const months=parseInt(f.period)||3;
    const cut=new Date(); cut.setMonth(cut.getMonth()-months);
    const cutStr=cut.toISOString().slice(0,10);
    reqs=reqs.filter(r=>(r.date||r.created_at?.slice(0,10)||'')>=cutStr);
  }
  if(f.company) reqs=reqs.filter(r=>r.company===f.company);
  if(f.equip)   reqs=reqs.filter(r=>(r.equip||'').toUpperCase().includes(f.equip.toUpperCase()));
  if(f.type)    reqs=reqs.filter(r=>(r.faultType||r.type||'기타')===f.type);

  const total=reqs.length;
  const pending=reqs.filter(r=>!r.status||r.status==='대기'||r.status==='접수').length;
  const inProg=reqs.filter(r=>r.status==='진행중'||r.status==='부품대기'||r.status==='자재수급중').length;
  const resolved=reqs.filter(r=>r.status==='완료'||r.status==='처리완료').length;
  // 고장유형별
  const byType={};
  reqs.forEach(r=>{ const t=r.faultType||r.type||'기타'; byType[t]=(byType[t]||0)+1; });
  const topTypes=Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,6);
  // 업체별
  const byCo={};
  reqs.forEach(r=>{ const c=r.company||'미등록'; byCo[c]=(byCo[c]||0)+1; });
  const topCos=Object.entries(byCo).sort((a,b)=>b[1]-a[1]).slice(0,5);
  // 장비별
  const byEquip={};
  reqs.forEach(r=>{ if(!r.equip) return; r.equip.split(/[,\s]+/).forEach(e=>{ const eq=e.trim().toUpperCase(); if(eq) byEquip[eq]=(byEquip[eq]||0)+1; }); });
  const topEquips=Object.entries(byEquip).sort((a,b)=>b[1]-a[1]).slice(0,5);
  // 월별 (최근 6개월)
  const monthly={};
  reqs.forEach(r=>{ const d=r.date||r.created_at?.slice(0,10)||''; if(!d) return; const ym=d.slice(0,7); monthly[ym]=(monthly[ym]||0)+1; });
  const sortedMonths=Object.keys(monthly).sort().slice(-6);
  // 평균 처리시간
  let totalMs=0,cnt=0;
  reqs.forEach(r=>{
    if(r.resolvedAt&&r.created_at&&(r.status==='완료'||r.status==='처리완료')){
      const diff=new Date(r.resolvedAt)-new Date(r.created_at); if(diff>0){ totalMs+=diff; cnt++; }
    }
  });
  const avgDays=cnt>0?(totalMs/cnt/86400000).toFixed(1):'—';
  const bar=(entries,maxVal,c1,c2)=>entries.map(([k,v])=>`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <div style="font-size:11px;color:var(--tx);width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${k}</div>
      <div style="flex:1;background:var(--bg3);border-radius:3px;overflow:hidden;height:14px">
        <div style="width:${Math.round(v/maxVal*100)}%;height:100%;background:linear-gradient(90deg,${c1},${c2})"></div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--tx2);min-width:20px;text-align:right">${v}</div>
    </div>`).join('');
  const mMax=sortedMonths.length?Math.max(...sortedMonths.map(m=>monthly[m]),1):1;
  const periodBtn=(p,label)=>`<button onclick="openASAnalysis({period:'${p}'})" style="padding:3px 10px;font-size:10px;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid;${f.period===p?'background:rgba(96,165,250,.2);color:#60a5fa;border-color:rgba(96,165,250,.4)':'background:var(--bg2);color:var(--tx3);border-color:var(--br)'}">${label}</button>`;
  document.getElementById('adm-content').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 2fr 1fr;align-items:center;padding:14px 14px 0;margin-bottom:8px">
      <button class="btn-ghost" style="padding:1px 5px;font-size:8px;justify-self:start;white-space:nowrap;line-height:1.8" onclick="renderAdmin()">← 뒤로</button>
      <div style="font-size:14px;font-weight:800;text-align:center">AS 현황 분석</div>
      <div style="font-size:10px;color:var(--tx3);justify-self:end">총 ${total}건</div>
    </div>
    <div style="padding:0 14px 14px">
      <!-- 필터 컨트롤 -->
      <div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:10px 12px;margin-bottom:12px">
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          ${periodBtn('1','최근 1개월')}${periodBtn('3','최근 3개월')}${periodBtn('all','전체')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <select onchange="openASAnalysis({company:this.value})" style="font-size:10px;padding:4px 6px;border:1px solid var(--br);border-radius:6px;background:var(--bg1);color:var(--tx)">
            <option value="">전체 업체</option>
            ${allCos.map(c=>`<option value="${c}"${f.company===c?' selected':''}>${c}</option>`).join('')}
          </select>
          <input type="text" value="${f.equip}" onchange="openASAnalysis({equip:this.value})" onkeydown="if(event.key==='Enter')openASAnalysis({equip:this.value})" placeholder="장비번호 검색" style="font-size:10px;padding:4px 6px;border:1px solid var(--br);border-radius:6px;background:var(--bg1);color:var(--tx)">
          <select onchange="openASAnalysis({type:this.value})" style="font-size:10px;padding:4px 6px;border:1px solid var(--br);border-radius:6px;background:var(--bg1);color:var(--tx)">
            <option value="">전체 유형</option>
            ${allTypes.map(t=>`<option value="${t}"${f.type===t?' selected':''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px">
        <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#60a5fa">${pending}</div><div style="font-size:10px;color:var(--tx3)">대기</div>
        </div>
        <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#fbbf24">${inProg}</div><div style="font-size:10px;color:var(--tx3)">진행중</div>
        </div>
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:#22c55e">${resolved}</div><div style="font-size:10px;color:var(--tx3)">완료</div>
        </div>
        <div style="background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.15);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:var(--tx2)">${avgDays}</div><div style="font-size:10px;color:var(--tx3)">평균일(완료)</div>
        </div>
      </div>
      ${topTypes.length?`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:800;margin-bottom:10px">고장 유형별</div>
        ${bar(topTypes,topTypes[0]?.[1]||1,'#f87171','#dc2626')}
      </div>`:''}
      ${topCos.length?`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:800;margin-bottom:10px">업체별 AS 건수</div>
        ${bar(topCos,topCos[0]?.[1]||1,'#60a5fa','#2563eb')}
      </div>`:''}
      ${topEquips.length?`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:800;margin-bottom:10px">장비별 AS 건수 (Top 5)</div>
        ${bar(topEquips,topEquips[0]?.[1]||1,'#a78bfa','#7c3aed')}
      </div>`:''}
      ${sortedMonths.length?`<div style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:800;margin-bottom:10px">월별 AS 추이 (최근 6개월)</div>
        ${bar(sortedMonths.map(m=>[m,monthly[m]]),mMax,'#34d399','#059669')}
      </div>`:''}
      ${total===0?'<div style="text-align:center;color:var(--tx3);padding:30px;font-size:12px">AS 요청 데이터가 없습니다</div>':''}
    </div>`;
}

async function doLogin(role){
  console.log('[LOGIN CLICK] doLogin 호출:', role);
  if(role==='tech'){
    const site=document.getElementById('techSite').value;
    const co=document.getElementById('techCompany').value;
    const name=document.getElementById('techName').value.trim();
    const phone=document.getElementById('techPhone')?.value.trim()||'';
    const team=document.getElementById('techTeam')?.value.trim()||'';
    if(!site||!co||!name||!phone){ toast('모든 항목을 입력해주세요','err'); return; }
    if(!privState.p1||!privState.p2){ toast('필수 동의 항목에 체크해주세요','err'); return; }
    if(team) DB.s('last_tech_team', team); // 다음 로그인 시 자동 복원
    S={role:'tech',name,phone,company:co,siteId:site,siteName:getSites().find(s=>s.id===site)?.name||site,team,loginAt:Date.now()};
    // 기술인 멤버 저장 (첫 로그인 시 서버에 즉시 등록)
    const _techMbrs=getMembers();
    const _alreadyTech=_techMbrs.some(m=>m.name===name&&m.phone===phone&&m.company===co&&m.siteId===site);
    if(!_alreadyTech){
      const _newTech={id:'tech-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
        name,company:co,siteId:site,siteName:getSites().find(s=>s.id===site)?.name||site,
        phone,title:'기술인',role:'tech',status:'approved',google_email:'',
        team,joinedAt:Date.now(),synced:false};
      _techMbrs.push(_newTech);
      saveMembers(_techMbrs);
      // 즉시 Supabase 저장 (fire-and-forget)
      const _sm=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
      sbReq('members','POST',[{
        record_id:_newTech.id,name:_newTech.name,company:_newTech.company,
        site_id:_newTech.siteId,site_name:_sm[_newTech.siteId]||_newTech.siteId||'',
        phone:_newTech.phone,title:_newTech.title,role:'tech',status:'approved',google_email:'',
        team:_newTech.team||'',
        joined_at:new Date(_newTech.joinedAt).toISOString()
      }],'?on_conflict=record_id').then(()=>{
        _newTech.synced=true; saveMembers(getMembers());
      }).catch(()=>{});
    }
  } else if(role==='sub'){
    const site=document.getElementById('subSite').value;
    const co=document.getElementById('subCompany').value;
    const name=document.getElementById('subName').value.trim();
    const subTitle=document.getElementById('subTitle')?.value.trim()||'';
    const subPhone=document.getElementById('subPhone')?.value.trim()||'';
    if(!site||!co||!name||!subPhone){ toast('현장·업체·이름·연락처를 입력해주세요','err'); return; }
    // 서버에서 먼저 조회 — 로컬 캐시는 fallback
    let existing=null;
    try {
      const rows=await sbReq('members','GET',null,
        `?name=eq.${encodeURIComponent(name)}&company=eq.${encodeURIComponent(co)}&site_id=eq.${encodeURIComponent(site)}&role=neq.tech&limit=5`);
      if(Array.isArray(rows)&&rows.length){
        const r=rows[0];
        existing={id:r.record_id,name:r.name,company:r.company,siteId:r.site_id,
          siteName:r.site_name,phone:r.phone,title:r.title,role:r.role||'sub',
          status:r.status||'approved',google_email:r.google_email||'',pw_hash:r.pw_hash||'',
          joinedAt:new Date(r.joined_at||Date.now()).getTime(),synced:true};
        // 로컬 캐시 갱신
        const _all=getMembers();
        const _idx=_all.findIndex(m=>m.id===existing.id);
        if(_idx>=0) _all[_idx]={..._all[_idx],...existing}; else _all.push(existing);
        saveMembers(_all);
      }
    } catch(e){
      console.warn('[sub login] SB 조회 실패, 로컬 fallback:',e?.message);
      existing=getMembers().find(m=>m.name===name&&m.company===co&&m.siteId===site&&m.role!=='tech'&&m.title!=='기술인')||null;
    }
    if(existing){
      const st=existing.status||'approved';
      if(st==='pending'){ toast('가입 승인 대기 중입니다. AJ관리자에게 문의하세요.','warn',4000); return; }
      if(st==='rejected'){ toast('가입이 거절되었습니다. AJ관리자에게 문의하세요.','err'); return; }
      // approved → 로그인
    } else {
      // 신규 가입 신청
      const _newMbr={id:'sub-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
        name,company:co,siteId:site,siteName:getSites().find(s=>s.id===site)?.name||site,
        phone:subPhone,title:subTitle,role:'sub',status:'pending',google_email:'',
        joinedAt:Date.now(),synced:false};
      // 서버 우선 저장 — 성공 후 로컬 캐시 갱신
      try {
        const _sm=Object.fromEntries(getSites().map(s=>[s.id,s.name]));
        await sbReq('members','POST',[{
          record_id:_newMbr.id,name:_newMbr.name,company:_newMbr.company,
          site_id:_newMbr.siteId,site_name:_sm[_newMbr.siteId]||'',
          phone:_newMbr.phone,title:_newMbr.title,
          role:'sub',status:'pending',google_email:'',
          joined_at:new Date(_newMbr.joinedAt).toISOString()
        }],'?on_conflict=record_id');
        _newMbr.synced=true;
        const _all=getMembers(); _all.push(_newMbr); saveMembers(_all);
        addNotif({icon:'',title:`신규 관리자 가입신청: ${co}`,
          desc:`${co} ${name}님이 가입을 신청했습니다. 승인이 필요합니다.`});
        pushSBNotif({target_aj_type:'관리자', type:'signup_request', title:`신규 가입신청: ${co}`, body:`${co} ${name}님이 가입을 신청했습니다. 승인이 필요합니다.`, ref_id:_newMbr.id}).catch(()=>{});
        toast('가입 신청 완료! AJ관리자 승인 후 로그인 가능합니다 ✓','ok',4000);
      } catch(e){
        const _em=e?.message||'';
        if(_em==='NO_SB_URL') toast('서버 연결 정보가 없습니다. 관리자에게 문의하세요.','err',4000);
        else toast(`가입 신청 실패: ${_em.slice(0,80)||'서버 오류'}`,'err',4000);
      }
      return;
    }
    S={role:'sub',name,title:subTitle||existing?.title||'',phone:subPhone||existing?.phone||'',company:co,siteId:site,siteName:getSites().find(s=>s.id===site)?.name||site,loginAt:Date.now(),memberId:existing?.id||''};
  } else {
    // AJ 관리자 로그인 — 이름+연락처 기반
    const ajName  = document.getElementById('ajName').value.trim();
    const ajPhone = document.getElementById('ajPhone').value.trim();
    const ajRoleChip = document.querySelector('#aj-role-chips .chip.on');
    const ajType = ajRoleChip?.textContent||'관리자';
    if(!ajName||!ajPhone){ toast('이름·연락처를 입력하세요','err'); return; }
    let member = null;

    // 1) Supabase 최신 목록 pull
    await _pullAjMembersFromSB().catch(()=>{});

    // 2) 로컬에서 이름+연락처 기반 조회 (연락처 우선, 이름 보조)
    let localList = _getAjMembers();
    const local = localList.find(m=>m.phone===ajPhone && m.name===ajName) || localList.find(m=>m.phone===ajPhone);
    if(local){
      if((local.status||'approved')==='pending'){ toast('가입 승인 대기 중입니다. AJ 관리자에게 문의하세요.','warn',4000); return; }
      if((local.status||'approved')==='rejected'){ toast('가입이 거절되었습니다.','err'); return; }
      member = local;
    } else {
      // 3) Supabase 직접 조회 — 연락처 기반
      try {
        const rows = await sbReq('aj_members','GET',null,`?phone=eq.${encodeURIComponent(ajPhone)}&limit=5`);
        if(!rows||!rows.length){ toast('등록되지 않은 연락처입니다. Google로 가입 신청하세요.','err'); return; }
        const remote = rows.find(r=>r.name===ajName) || rows[0];
        if((remote.status||'approved')==='pending'){ toast('가입 승인 대기 중입니다. AJ 관리자에게 문의하세요.','warn',4000); return; }
        if((remote.status||'approved')==='rejected'){ toast('가입이 거절되었습니다.','err'); return; }
        localList.push(remote); _saveAjMembers(localList);
        member = remote;
      } catch(e){
        const _em = e?.message||'';
        let _msg;
        if(_em.includes('NO_SB_URL'))      _msg = '서버 연결 정보가 없습니다. 설정을 확인하세요.';
        else if(_em.includes('Failed to fetch')||_em.includes('NetworkError')) _msg = '서버에 연결할 수 없습니다.';
        else if(_em.includes('401')||_em.includes('403')) _msg = '서버 권한 오류. Supabase RLS를 확인하세요.';
        else _msg = `서버 오류: ${_em.slice(0,80)}`;
        toast(_msg,'err'); return;
      }
    }
    DB.s(K.AJ_MEMBER, member);
    S={role:'aj',name:member.name,phone:member.phone||ajPhone,ajType:member.aj_type||ajType,company:'AJ네트웍스',siteId:'all',siteName:'전체 현장',loginAt:Date.now(),empNo:member.emp_no,memberId:member.record_id||member.id||''};
  }
  DB.s(K.SESSION,S);
  // 자동 로그인 설정 저장
  const _autoChkId = role==='tech'?'chk-auto-login-tech':role==='sub'?'chk-auto-login-sub':'chk-auto-login-aj';
  DB.s('auto_login', document.getElementById(_autoChkId)?.checked !== false);
  enterApp();
}

function loadSession(){
  const saved=DB.g(K.SESSION,null);
  if(!saved){ toast('저장된 정보가 없습니다','warn'); return; }
  if((Date.now()-saved.loginAt)>7*24*60*60*1000){ toast('세션 만료. 다시 로그인하세요','warn'); return; }
  S=saved; enterApp();
}

function enterApp(){
  console.log('[INIT APP] enterApp 호출');
  const _ls=document.getElementById('loginScreen');
  if(_ls){
    _ls.style.pointerEvents='none'; // ← 즉시 클릭 차단 해제 (투명 레이어 클릭 흡수 방지)
    _ls.style.opacity='0';
    _ls.style.transition='opacity .3s';
    setTimeout(()=>{ _ls.style.display='none'; },300);
  }
  document.getElementById('app').classList.add('on');
  applyRole();
  renderNoticeBar();
  if(S.role==='aj'){
    const sel=document.getElementById('ajSiteSelect');
    if(sel && S.siteId) sel.value=S.siteId;
  }
  _purgeSeedLogs(); // 기존 더미 데이터 일회성 정리
  renderHome();
  // 로그인 직후 동기화 상태 초기값 설정
  const _dot = document.getElementById('sdot');
  const _txt = document.getElementById('stxt');
  if (_dot && _txt) {
    const hasSB = DB.g(K.SB_URL, '');
    const _ls0  = DB.g('last_sync', '');
    if (!hasSB) {
      _dot.className = 'sdot err';
      _txt.textContent = '미연동';
    } else if (_ls0) {
      _dot.className = 'sdot ok';
      _txt.textContent = `동기화 ${new Date(_ls0).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;
    } else {
      _dot.className = 'sdot sync';
      _txt.textContent = '연결 확인 중...';
    }
  }
  updateLogBadge();
  check3PMAlert();
  setTimeout(checkUnreadNotifs, 500);
  // AJ 관리자: 알림 권한 요청 + 승인 대기 회원 확인
  if(S?.role === 'aj') setTimeout(()=>_requestNotifPermission().then(()=>_checkPendingNotif()), 1500);
  // 협력사 담당자: 자사 오늘 미입력 시 OS 알림
  if(S?.role === 'sub') setTimeout(async ()=>{
    const granted = await _requestNotifPermission();
    if(!granted) return;
    const logs = await getTodayLogs().catch(()=>[]);
    const hasMine = (logs||[]).some(l=>l.company===S.company && l.siteId===S.siteId);
    if(!hasMine) _showOSNotif(
      `⚠ 가동 미입력 알림`,
      `${S.company} — 오늘 가동현황이 아직 입력되지 않았습니다.`,
      'missing_log'
    ).catch(()=>{});
  }, 2000);
  // IDB 초기화 완료 후 syncNow 실행 (순서 보장)
  IDB.open()
    .then(() => {
      window._IDB_READY = true; // 동기화 함수에서 IDB 사용 가능 여부 체크용
      return _migrateFromLocalStorage();
    })
    .then(() => queueSync())
    .catch(e => {
      console.warn('[init] IDB 초기화 에러, localStorage 모드로 진행:', e.message);
      window._IDB_READY = false;
      queueSync();
    });
  // 중복 등록 방지 — 기존 인터벌 모두 해제 후 재등록
  _appIntervals.forEach(id => clearInterval(id));
  _appIntervals = [
    setInterval(check3PMAlert, 60000),
    setInterval(_runMemoryGuard, 5 * 60 * 1000), // 메모리 가드: 5분마다 비활성 캐시 해제
  ];
  // 자동 싱크 제거 — pull-to-refresh / 페이지 이동 시 수동 싱크로만 운용
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  setTimeout(_initScrollTopBtn, 400);
  // Supabase Realtime 구독 — 다른 기기 변경사항 즉시 수신
  if(typeof _initRealtime==='function') setTimeout(_initRealtime, 1200);
  // Pull-to-refresh 초기화 (중복 방지)
  if(!window._ptrInitDone){ window._ptrInitDone=true; _initPullToRefresh(); }
  // 알림 수신 타임스탬프 초기화 (세션 최초 진입 시)
  if(!_lastNotifFetchTs){
    _lastNotifFetchTs = Date.now() - 5*60*1000; // 5분 lookback
    DB.s('_lastNotifFetchTs', String(_lastNotifFetchTs));
  }
  // QR 스캔 URL 파라미터 처리 (?equip=GJ265 → 가동현황 탭 + 장비번호 자동입력)
  const _qp = new URLSearchParams(location.search);
  const _qrEquip = _qp.get('equip');
  if(_qrEquip){
    setTimeout(()=>{
      goTab('pg-ops');
      const el = document.getElementById('f-equip');
      if(el){ el.value = _qrEquip.toUpperCase(); el.focus(); }
    }, 600);
  }
  // PWA 설치 배너 (2초 후 표시 — 로그인 직후 UX 방해 최소화)
  setTimeout(_showPwaInstallBanner, 2000);
}

/* ── Pull-to-Refresh ─────────────────────────────────────── */
function _initPullToRefresh(){
  const THRESHOLD=65;
  let _y0=0,_pulling=false,_triggered=false;
  let _ptr=document.getElementById('ptr-bar');
  if(!_ptr){
    _ptr=document.createElement('div');
    _ptr.id='ptr-bar';
    _ptr.style.cssText='position:fixed;top:0;left:0;right:0;z-index:5000;height:46px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--bg1);border-bottom:1px solid var(--br);font-size:12px;font-weight:700;color:var(--blue);pointer-events:none;transform:translateY(-46px);transition:none;box-shadow:0 2px 12px rgba(0,0,0,.3)';
    document.body.appendChild(_ptr);
  }
  function _getScrollTop(){
    if(curPg==='pg-as') return document.getElementById('as-content')?.scrollTop||0;
    if(curPg==='pg-ops') return document.getElementById('ops-log-panel')?.scrollTop||0;
    return document.getElementById(curPg)?.scrollTop||0;
  }
  function _onSheet(el){ return !!el?.closest?.('.soverlay.on,.soverlay[style*="display: block"]'); }
  document.addEventListener('touchstart',e=>{
    if(_onSheet(e.target)||_getScrollTop()>4) return;
    _y0=e.touches[0].clientY; _pulling=true; _triggered=false;
    _ptr.style.transition='none';
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!_pulling) return;
    const dy=e.touches[0].clientY-_y0;
    if(dy<=0){_pulling=false;_ptr.style.transition='transform .2s ease';_ptr.style.transform='translateY(-46px)';return;}
    const t=Math.min(dy*0.45,46);
    _ptr.style.transform=`translateY(${t-46}px)`;
    if(dy>=THRESHOLD&&!_triggered){
      _triggered=true;
      _ptr.innerHTML='<span style="font-size:18px;animation:_ptrSpin .7s linear infinite;display:inline-block">↻</span> 놓으면 새로고침';
    } else if(!_triggered){
      _ptr.innerHTML='<span style="font-size:16px">↓</span> 당겨서 새로고침';
    }
  },{passive:true});
  document.addEventListener('touchend',async()=>{
    if(!_pulling) return; _pulling=false;
    if(!_triggered){_ptr.style.transition='transform .2s ease';_ptr.style.transform='translateY(-46px)';return;}
    _ptr.style.transition='transform .15s ease'; _ptr.style.transform='translateY(0)';
    _ptr.innerHTML='<span style="font-size:18px;animation:_ptrSpin .7s linear infinite;display:inline-block">↻</span> 동기화 중...';
    try{ await _fetchFromSB(); toast('최신 데이터로 업데이트됨','ok'); }catch(e){ toast('동기화 실패. 네트워크를 확인하세요','err'); }
    setTimeout(()=>{_ptr.style.transition='transform .3s ease';_ptr.style.transform='translateY(-46px)';},600);
    _triggered=false;
  },{passive:true});
}

/* ── 네트워크 오프라인 감지 ──────────────────────────────── */
function _updateOfflineBadge(){
  const el=document.getElementById('offline-badge');
  if(!el) return;
  const offline=!navigator.onLine;
  el.classList.toggle('on', offline);
  // 오프라인→온라인 복귀 시 자동 동기화 시도
}
function _onOnline(){ _updateOfflineBadge(); queueSync(); }
function _onOffline(){ _updateOfflineBadge(); const el=document.getElementById('sdot'); const txt=document.getElementById('stxt'); if(el){el.className='sdot err'; if(txt) txt.textContent='오프라인';} }
window.addEventListener('online',  _onOnline);
window.addEventListener('offline', _onOffline);

/* ── Service Worker 등록 (PWA) ──────────────────────────── */
// claudeusercontent.com / 로컬 미리보기에서는 SW 등록 생략
const _swSkip = location.hostname.includes('claudeusercontent.com') || location.hostname === 'localhost' && !location.port;
if('serviceWorker' in navigator && !_swSkip){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] 등록됨:', reg.scope);
        // 백그라운드 싱크 지원 시 등록
        if('sync' in reg) reg.sync.register('sync-logs').catch(()=>{});
        // SW 메시지 수신 (BG_SYNC)
        navigator.serviceWorker.addEventListener('message', e=>{
          if(e.data?.type==='BG_SYNC') queueSync();
        });
      })
      .catch(e => console.warn('[SW] 등록 실패:', e));
  });
}

/* ── PWA 설치 프롬프트 ──────────────────────────────────── */
let _pwaInstallEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaInstallEvent = e;
  // 안드로이드/크롬: 이벤트 확보 즉시 배너 트리거 (2초 딜레이)
  setTimeout(_showPwaInstallBanner, 2000);
});

async function _installPWA() {
  if (!_pwaInstallEvent) { toast('현재 브라우저에서 설치를 지원하지 않거나 이미 설치되어 있습니다.', 'warn'); return; }
  try {
    _pwaInstallEvent.prompt();
    const { outcome } = await _pwaInstallEvent.userChoice;
    if (outcome === 'accepted') toast('앱 설치 완료! 홈 화면에서 실행하세요 🎉', 'ok', 4000);
    _pwaInstallEvent = null;
  } catch(e) {
    toast('설치 중 오류: ' + e.message, 'err');
  }
  document.getElementById('pwa-install-popup')?.remove();
}

function _showPwaInstallBanner() {
  // 이미 설치된 경우 스킵 (standalone 모드)
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
  const _isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // 비-iOS: 설치 이벤트가 없으면 배너 표시 불필요 (버튼이 동작 안 함)
  if (!_isIOS && !_pwaInstallEvent) return;
  // 7일 이내에 이미 표시한 경우 스킵
  const _lastShown = parseInt(localStorage.getItem('_pwa_prompt_ts') || '0');
  if (Date.now() - _lastShown < 7 * 24 * 3600 * 1000) return;
  localStorage.setItem('_pwa_prompt_ts', String(Date.now()));

  const popup = document.createElement('div');
  popup.id = 'pwa-install-popup';
  popup.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:10000;padding:16px 16px 20px;background:rgba(10,18,35,.97);border-top:1px solid rgba(59,130,246,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);animation:slideUp .3s ease';

  const _closeBtn = `<button onclick="document.getElementById('pwa-install-popup')?.remove()" style="position:absolute;top:10px;right:14px;background:none;border:none;color:rgba(255,255,255,.4);font-size:20px;cursor:pointer;line-height:1">×</button>`;

  if (_isIOS) {
    popup.innerHTML = _closeBtn + `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#DE1F23,#9f1214);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏗</div>
        <div>
          <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:2px">앱으로 설치하기</div>
          <div style="font-size:11px;color:rgba(255,255,255,.55)">홈 화면에 추가하면 알림 수신 · 빠른 실행이 가능합니다</div>
        </div>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:8px 12px;line-height:1.8">
        <b style="color:#60a5fa">Safari</b> 하단 공유 버튼 <b style="color:#60a5fa">⬆</b> 탭 →
        <b style="color:#60a5fa">"홈 화면에 추가"</b> 선택
      </div>`;
  } else {
    popup.innerHTML = _closeBtn + `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#DE1F23,#9f1214);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏗</div>
        <div>
          <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:2px">앱으로 설치하기</div>
          <div style="font-size:11px;color:rgba(255,255,255,.55)">홈 화면에 추가하면 알림 수신 · 오프라인 사용이 가능합니다</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('pwa-install-popup')?.remove()" style="flex:1;padding:10px;font-size:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:rgba(255,255,255,.6);cursor:pointer">나중에</button>
        <button onclick="_installPWA()" style="flex:2;padding:10px;font-size:13px;font-weight:700;background:linear-gradient(135deg,#DE1F23,#9f1214);border:none;border-radius:8px;color:#fff;cursor:pointer">📲 설치하기</button>
      </div>`;
  }
  document.body.appendChild(popup);
}


function doLogout(){
  if(!confirm('로그아웃 하시겠습니까?')) return;
  // 인터벌 및 리스너 정리 (location.reload() 전 명시적 해제)
  _appIntervals.forEach(id => clearInterval(id));
  _appIntervals = [];
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  window.removeEventListener('online',  _onOnline);
  window.removeEventListener('offline', _onOffline);
  if(typeof _cleanupRealtime==='function') _cleanupRealtime();
  // 재시도 타이머 정리 (api.js 전역 참조)
  if(typeof _retrySyncTimer !== 'undefined' && _retrySyncTimer){
    clearTimeout(_retrySyncTimer); _retrySyncTimer = null;
  }
  S=null; DB.s(K.SESSION,null); DB.s('auto_login',false); location.reload();
}

/* ═══════════════════════════════════════════
   ROLE UI
═══════════════════════════════════════════ */
function applyRole(){
  const role=S.role;
  const badge=document.getElementById('rbadge');
  const roleNames={tech:'기술인',sub:'협력사관리자',aj:'AJ관리자',guest:'둘러보기'};
  badge.textContent=roleNames[role]||role;
  badge.className='rbadge '+role;
  const nameEl = document.getElementById('tbName');
  const roleEl = document.getElementById('tbRole');
  if(nameEl) nameEl.textContent = S.name || '—';
  if(roleEl) roleEl.textContent = S.title ? `${S.title} · ${S.company}` : S.company;
  document.getElementById('tbSub').style.display='flex';

  // 상단 현장 표시: AJ는 드롭다운, 나머지는 라벨
  const wrap = document.getElementById('site-selector-wrap');
  if(role==='aj'){
    const sites = getSites();
    wrap.innerHTML = `<select class="topbar-site-sel" id="ajSiteSelect" onchange="onAJSiteChange()">
      <option value="all">전체 현장</option>
      ${sites.map(s=>`<option value="${s.id}"${S.siteId===s.id?' selected':''}>${s.name}</option>`).join('')}
    </select>`;
  } else {
    wrap.innerHTML = `<div class="topbar-site-label">${S.siteName||'—'}</div>`;
  }

  const canAdmin = role==='sub'||role==='aj';
  const isGuest  = role==='guest';

  // 새 nav: 홈/반입반출/가동현황/AS/관리
  document.getElementById('nt-ops')?.classList.toggle('locked', isGuest);
  document.getElementById('nt-transit')?.classList.toggle('locked', isGuest);
  document.getElementById('nt-as')?.classList.toggle('locked', !S); // 로그인만 하면 접근 가능
  document.getElementById('nt-admin').className = 'ntab'+(canAdmin?'':' locked');
  if(document.getElementById('homeRankBtn'))
    document.getElementById('homeRankBtn').style.display = canAdmin?'':'none';
  if(isGuest) document.getElementById('app').classList.add('browse-mode');
}

function guardTab(pgId){
  const role=S?.role;
  const isGuest=role==='guest';
  if(isGuest&&(pgId==='pg-ops'||pgId==='pg-transit')){ toast('둘러보기 모드에서는 입력이 불가합니다','warn'); return; }
  if(pgId==='pg-admin'&&role!=='sub'&&role!=='aj'){ toast('관리자만 접근 가능합니다','warn'); return; }
  goTab(pgId);
}

// AJ 현장 선택 변경
function onAJSiteChange(){
  if(!S||S.role!=='aj') return;
  const sel = document.getElementById('ajSiteSelect');
  const val = sel.value;
  if(val==='all'){
    S.siteId='all'; S.siteName='전체 현장';
  } else {
    const site = getSites().find(s=>s.id===val);
    if(site){ S.siteId=site.id; S.siteName=site.name; }
  }
  DB.s(K.SESSION, S);
  refreshCurrentPage();
}

function refreshCurrentPage(){
  if(curPg==='pg-home')    renderHome();
  if(curPg==='pg-ops')     initOpsPanel(curOpsTab);
  if(curPg==='pg-transit') renderTransit();
  if(curPg==='pg-as')      renderASPage();
  if(curPg==='pg-admin')   renderAdmin();
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */
const PG_NT={
  'pg-home':'nt-home','pg-transit':'nt-transit',
  'pg-ops':'nt-ops','pg-as':'nt-as','pg-admin':'nt-admin',
};
let curPg='pg-home';
let curOpsTab='input';

window._trExpanded = window._trExpanded || new Set();
function toggleTrCard(id){
  if(window._trExpanded.has(id)) window._trExpanded.delete(id);
  else window._trExpanded.add(id);
  const body = document.getElementById('tr-body-'+id);
  if(body) body.style.display = window._trExpanded.has(id) ? 'block' : 'none';
  const arrow = document.getElementById('tr-arrow-'+id);
  if(arrow) arrow.style.transform = window._trExpanded.has(id) ? 'rotate(180deg)' : '';
}

/* ── 스크롤 탑 버튼 ─────────────────────────────────────── */
function _initScrollTopBtn(){
  const btn = document.getElementById('scroll-top-btn');
  if(!btn) return;
  function _check(){
    if(!btn) return;
    let scrolled = false;
    if(curPg === 'pg-as'){
      const asCont = document.getElementById('as-content');
      if(asCont) scrolled = asCont.scrollTop > 280;
    } else if(curPg === 'pg-ops' && curOpsTab === 'log'){
      const logPanel = document.getElementById('ops-log-panel');
      if(logPanel) scrolled = logPanel.scrollTop > 280;
    } else {
      const pg = document.getElementById(curPg);
      if(pg) scrolled = pg.scrollTop > 280;
    }
    btn.style.display = scrolled ? '' : 'none';
  }
  document.getElementById('pg-transit')?.addEventListener('scroll', _check, {passive:true});
  document.getElementById('as-content')?.addEventListener('scroll', _check, {passive:true});
  document.getElementById('ops-log-panel')?.addEventListener('scroll', _check, {passive:true});
  window._checkScrollTop = _check;
}
function _scrollTop(){
  let el;
  if(curPg === 'pg-as') el = document.getElementById('as-content');
  else if(curPg === 'pg-ops' && curOpsTab === 'log') el = document.getElementById('ops-log-panel');
  else el = document.getElementById(curPg);
  el?.scrollTo({top:0, behavior:'smooth'});
  const btn = document.getElementById('scroll-top-btn');
  if(btn) btn.style.display = 'none';
}

function goTab(pgId){
  document.getElementById('scroll-top-btn')?.style && (document.getElementById('scroll-top-btn').style.display='none');
  document.getElementById(curPg)?.classList.remove('on');
  document.getElementById(PG_NT[curPg])?.classList.remove('on');
  curPg=pgId;
  document.getElementById(pgId)?.classList.add('on');
  document.getElementById(PG_NT[pgId])?.classList.add('on');
  // 로딩 스피너 헬퍼
  const _spin = (color='var(--blue)') =>
    `<div style="padding:40px 20px;text-align:center;color:var(--tx3);font-size:12px"><div style="width:18px;height:18px;border:2px solid var(--br);border-top-color:${color};border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px"></div>서버 데이터 로드 중...</div>`;

  if(pgId==='pg-home'){
    renderHome(); // 로컬 데이터로 즉시 렌더
    _fetchFromSB().then(()=>{ if(curPg==='pg-home') renderHome(); }).catch(()=>{});
  }
  if(pgId==='pg-ops'){
    const _oc=document.getElementById('ops-log-panel');
    initOpsPanel(curOpsTab);
    if(curOpsTab==='log' && _oc) _oc.innerHTML=_spin();
    _fetchFromSB().then(()=>{ if(curPg==='pg-ops') initOpsPanel(curOpsTab); }).catch(()=>{ if(curPg==='pg-ops') initOpsPanel(curOpsTab); });
  }
  if(pgId==='pg-transit'){
    const _tc=document.getElementById('transit-content');
    if(_tc) _tc.innerHTML=_spin('var(--blue)');
    _fetchFromSB().then(()=>renderTransit()).catch(()=>renderTransit());
  }
  if(pgId==='pg-as'){
    const _ac=document.getElementById('as-content');
    if(_ac) _ac.innerHTML=_spin('var(--red)');
    _fetchFromSB().then(()=>{ renderASPage(); updateASBadge(); }).catch(()=>{ renderASPage(); updateASBadge(); });
  }
  if(pgId==='pg-admin'){
    renderAdmin();
    _fetchFromSB().then(()=>{ if(curPg==='pg-admin') renderAdmin(); }).catch(()=>{});
  }
}

/* ═══════════════════════════════════════════
   GOOGLE SHEETS / SUPABASE
═══════════════════════════════════════════ */
const APP_VER = 'v3.4';
if(localStorage.getItem('app_version') !== APP_VER){
  // 세션만 초기화 — 데이터는 마이그레이션이 처리
  ['session_v3','user_session','session_v2'].forEach(k=>localStorage.removeItem(k));
  localStorage.setItem('app_version', APP_VER);
}

// v1, v2 데이터 자동 마이그레이션 (해당 데이터가 있을 경우에만 실행)
migrateFromV1();
migrateFromV2();

// admin 계정 초기 생성 후 로그인 화면 진입
// .catch() 추가: ensureAdminAccount 실패해도 initLogin은 반드시 호출
ensureAdminAccount()
  .then(()=>{ console.log('[INIT APP] ensureAdminAccount 완료 → initLogin 호출'); initLogin(); })
  .catch(e=>{ console.error('[INIT APP] ensureAdminAccount 오류, initLogin 강제 호출:', e); try{ initLogin(); }catch(e2){ console.error('[INIT APP] initLogin 오류:', e2); } });
