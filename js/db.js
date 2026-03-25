/* ── JS 런타임 오류 가드 (로그인 화면 무응답 조기 감지) ── */
window.onerror = function(msg, src, line, col, err){
  console.error('[JS Error]', msg, '|', (src||'').split('/').pop() + ':' + line, err||'');
  return false; // 브라우저 기본 처리도 유지
};
window.addEventListener('unhandledrejection', function(e){
  console.error('[Unhandled Promise Rejection]', e.reason);
});
console.log('[INIT APP] script 블록 시작');

/* ── 전화번호 공통 유틸 ── */
function fmtPhone(v){ return v.replace(/[^0-9]/g,''); }
function validPhone(v){
  const d = fmtPhone(v);
  return d.length >= 10 && d.length <= 11;
}
function checkPhoneEl(el){
  const v = fmtPhone(el.value);
  el.value = v; // 하이픈 자동 제거
  if(v && !validPhone(v)){
    el.classList.add('shake');
    setTimeout(()=>el.classList.remove('shake'), 500);
    toast('연락처는 10~11자리 숫자로 입력하세요','err');
    return false;
  }
  return true;
}
// 전화번호 입력 시 숫자만 허용
document.addEventListener('input', function(e){
  if(e.target.classList.contains('phone-input')){
    e.target.value = e.target.value.replace(/[^0-9]/g,'');
  }
});

'use strict';
/* ═══════════════════════════════════════════
   DATA LAYER
═══════════════════════════════════════════ */
/* ── Supabase / OAuth 연결 정보 ──────────────────────────────
   서버(Render)에서 환경변수 SB_URL / SB_KEY / KAKAO_JS_KEY 설정 시
   window._SRV 로 주입되어 캐시 삭제해도 자동 복구됩니다.
   직접 입력 시: 관리 탭 → 서버 설정 (localStorage 우선 적용)
─────────────────────────────────────────────────────────── */
const SB_DEFAULT_URL = (typeof window !== 'undefined' && window._SRV?.u) || '';
const GOOGLE_DEFAULT_CLIENT_ID = '1075257837095-jrdnlfql4s4emh4mmhnjcvhomon6f3kk.apps.googleusercontent.com';
const KAKAO_DEFAULT_JS_KEY = (typeof window !== 'undefined' && window._SRV?.kk) || '';
const SB_DEFAULT_KEY = (typeof window !== 'undefined' && window._SRV?.k) || '';

const K = {
  SITES:   'sites_v3',
  COS:     'companies_v3',
  LOGS:    'logs_v3',
  SESSION: 'session_v3',
  GS_URL:  'gs_url',
  SB_URL:  'sb_url',        // Supabase Project URL
  SB_KEY:  'sb_anon_key',   // Supabase anon/public key
  CREDS:   'aj_creds',
  AJ_MEMBER:  'aj_member_cache',   // 현재 로그인한 AJ 멤버 캐시
  AJ_MEMBERS: 'aj_members_local',  // 등록된 AJ 멤버 목록 (로컬 주 저장소)
  INVITE:  'invite_code',        // 전체 기본 (deprecated)
  INVITE_SITE: 'invite_site_',  // prefix: invite_site_{siteId}
  NOTIFS:  'notifs',
  SETTINGS:'settings',
  MEMBERS: 'sub_members_v3',   // 협력사 관리자 가입 목록
  TRANSIT: 'transit_v3',       // 반입/반출 기록
  AS_REQS: 'as_requests_v3',   // AS 요청 기록
  IDLE:    'idle_logs_v3',     // 미가동 기록
  MGR_HIST:'mgr_history_v3',   // 양중담당자 이력
  EQUIP:   'equipment_v3',     // 현재 반입 장비 마스터
  NOTICE:  'siteNotice',      // 공지사항
};
/* ═══════════════════════════════════════════════════════════
   IDB (IndexedDB) 레이어 — 대용량 데이터 저장
   - LOGS / TRANSIT / AS_REQS / MEMBERS → IndexedDB (무제한)
   - 설정값 (SESSION, GS_URL, SB_URL 등) → localStorage (빠른 동기 접근)
   - DB.g / DB.s 는 설정값용 동기 API 유지
═══════════════════════════════════════════════════════════ */
const DB = {
  g(k, d) {
    try {
      const v = localStorage.getItem(k);
      const stored = v ? JSON.parse(v) : null;
      // SB_URL / SB_KEY: localStorage 없으면 하드코딩 기본값 사용
      if (stored !== null && stored !== '') return stored;
      if (k === 'sb_url'      && SB_DEFAULT_URL) return SB_DEFAULT_URL;
      if (k === 'sb_anon_key' && SB_DEFAULT_KEY) return SB_DEFAULT_KEY;
      return d !== undefined ? d : null;
    } catch (_e) { return d; }
  },
  s(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch(e) {
      if(e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'){
        _handleQuotaExceeded(k, v);
      } else {
        console.warn('[DB] localStorage 저장 실패:', k, e.message);
      }
    }
  },
  sizeKB() {
    let total = 0;
    for (const k in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, k)) {
        total += (localStorage[k].length + k.length) * 2;
      }
    }
    return Math.round(total / 1024);
  }
};

/* ── IndexedDB 레이어 (비동기, 대용량) ─────────────────────
   스토어: logs | transit | as_requests | members
   키:     record_id (고유)
   인덱스: date, site_id, status, synced
─────────────────────────────────────────────────────────── */
const IDB = (() => {
  const DB_NAME = 'aj_v3';
  const DB_VER  = 3;
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        // 기존 트랜잭션이 남아있는 경우 안전하게 처리
        try { e.target.transaction.onabort = ev => console.warn('[IDB] upgrade aborted:', ev); } catch (_e) {}
        // LOGS
        if (!db.objectStoreNames.contains('logs')) {
          const s = db.createObjectStore('logs', { keyPath: 'id' });
          s.createIndex('date',    'date',    { unique: false });
          s.createIndex('siteId',  'siteId',  { unique: false });
          s.createIndex('synced',  'synced',  { unique: false });
          s.createIndex('status',  'status',  { unique: false });
          s.createIndex('company', 'company', { unique: false });
          // 복합 인덱스: [siteId, date] — 현장별 날짜 조회 (미지원 환경에서 무시)
          try { s.createIndex('siteDate', ['siteId', 'date'], { unique: false }); } catch(e) { console.warn('[IDB] siteDate 복합인덱스 미지원:', e); }
        }
        // TRANSIT
        if (!db.objectStoreNames.contains('transit')) {
          const s = db.createObjectStore('transit', { keyPath: 'id' });
          s.createIndex('date',   'date',   { unique: false });
          s.createIndex('siteId', 'siteId', { unique: false });
          s.createIndex('synced', 'synced', { unique: false });
          s.createIndex('status', 'status', { unique: false });
        }
        // AS_REQUESTS
        if (!db.objectStoreNames.contains('as_requests')) {
          const s = db.createObjectStore('as_requests', { keyPath: 'id' });
          s.createIndex('date',   'date',   { unique: false });
          s.createIndex('siteId', 'siteId', { unique: false });
          s.createIndex('synced', 'synced', { unique: false });
          s.createIndex('status', 'status', { unique: false });
        }
        // MEMBERS
        if (!db.objectStoreNames.contains('members')) {
          const s = db.createObjectStore('members', { keyPath: 'id' });
          s.createIndex('siteId',  'siteId',  { unique: false });
          s.createIndex('synced',  'synced',  { unique: false });
          s.createIndex('company', 'company', { unique: false });
        }
        // EQUIPMENT — 현재 반입 중인 장비 마스터
        if (!db.objectStoreNames.contains('equipment')) {
          const s = db.createObjectStore('equipment', { keyPath: 'id' });
          s.createIndex('siteId',  'siteId',  { unique: false });
          s.createIndex('company', 'company', { unique: false });
          try { s.createIndex('siteComp', ['siteId', 'company'], { unique: false }); } catch(e) { console.warn('[IDB] siteComp 복합인덱스 미지원:', e); }
          s.createIndex('status',  'status',  { unique: false });
        }
      };
      req.onsuccess = e => {
        _db = e.target.result;
        // 버전 불일치 감지 — versionchange 이벤트 처리
        _db.onversionchange = () => {
          _db.close();
          _db = null;
          console.warn('[IDB] 버전 변경 감지 — DB 닫음');
        };
        res(_db);
      };
      req.onerror = e => {
        const err = e.target.error;
        // SyntaxError 등 재시도해도 의미없는 에러는 즉시 reject
        if (err?.name === 'SyntaxError' || err?.name === 'TypeError') {
          console.error('[IDB] 스키마 오류 — 재시도 불가:', err);
          rej(err);
          return;
        }
        // AbortError(upgradeneeded 충돌) 시 DB 삭제 후 재시도
        if (err?.name === 'AbortError' || err?.name === 'VersionError') {
          console.warn('[IDB] 버전 충돌 — DB 삭제 후 재시도');
          indexedDB.deleteDatabase(DB_NAME);
          _db = null;
          // 재시도
          setTimeout(() => open().then(res).catch(rej), 500);
        } else {
          rej(err);
        }
      };
      req.onblocked = () => {
        console.warn('[IDB] blocked - 다른 탭 종료 후 새로고침 필요');
        // onblocked에서는 기다리지 않고 에러 처리
        rej(new Error('IDB blocked'));
      };
    });
  }

  // 전체 조회
  async function getAll(store) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  // 인덱스 범위 조회 (고속) — ex: getByIndex('logs','date','2025-03-01')
  async function getByIndex(store, idx, val) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx   = db.transaction(store, 'readonly');
      const req  = tx.objectStore(store).index(idx).getAll(val);
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  // 범위 조회 — ex: getRange('logs','date', IDBKeyRange.bound('2025-01-01','2025-03-01'))
  async function getRange(store, idx, range) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx   = db.transaction(store, 'readonly');
      const req  = tx.objectStore(store).index(idx).getAll(range);
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  // 단건 upsert
  async function put(store, obj) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(obj);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  // 배치 upsert (트랜잭션 1회)
  async function putAll(store, items) {
    if (!items.length) return;
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      items.forEach(item => os.put(item));
      tx.oncomplete = () => res(items.length);
      tx.onerror    = () => rej(tx.error);
    });
  }

  // synced=false 항목만 조회
  async function getUnsynced(store) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index('synced').getAll(false);
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  // synced 플래그 배치 업데이트
  async function markSynced(store, ids) {
    if (!ids.length) return;
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      let done = 0;
      ids.forEach(id => {
        const gr = os.get(id);
        gr.onsuccess = () => {
          if (gr.result) { gr.result.synced = true; os.put(gr.result); }
          if (++done === ids.length) {}
        };
      });
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }

  // 총 건수
  async function count(store) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  // 페이지네이션 조회 (cursor 방식)
  async function getPage(store, idxName, direction='prev', offset=0, limit=50, filter=null) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx      = db.transaction(store, 'readonly');
      const os      = tx.objectStore(store);
      const source  = idxName ? os.index(idxName) : os;
      const results = [];
      let skipped   = 0;
      const req = source.openCursor(null, direction);
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) { res(results); return; }
        const item = cursor.value;
        if (!filter || filter(item)) {
          if (skipped >= offset) results.push(item);
          else skipped++;
        }
        cursor.continue();
      };
      req.onerror = () => rej(req.error);
    });
  }

  return { open, getAll, getByIndex, getRange, put, putAll, getUnsynced, markSynced, count, getPage };
})();

/* ── localStorage 용량 초과 자동 복구 ─────────────────────
   대용량 배열 키(_BULK_KEYS)를 최근 50건으로 슬라이싱 후 재시도.
   IDB로 마이그레이션된 환경에서는 LS를 캐시 목적으로만 사용하므로 안전.
─────────────────────────────────────────────────────────── */
const _BULK_KEYS_LS = ['logs_v3','transit_v3','as_requests_v3','sub_members_v3'];
function _handleQuotaExceeded(k, v){
  console.warn('[DB] localStorage 용량 초과 — 대용량 키 슬라이싱 시도');
  // 저장 대상 키 자신 제외한 대용량 키부터 50건으로 축소
  let freed = false;
  for(const bk of _BULK_KEYS_LS){
    if(bk === k) continue;
    try {
      const raw = localStorage.getItem(bk);
      if(!raw) continue;
      const arr = JSON.parse(raw);
      if(Array.isArray(arr) && arr.length > 50){
        localStorage.setItem(bk, JSON.stringify(arr.slice(-50)));
        freed = true;
        break;
      }
    } catch(_e){}
  }
  if(freed){
    try {
      localStorage.setItem(k, JSON.stringify(v));
      console.log('[DB] 용량 확보 후 재저장 성공:', k);
      return;
    } catch(_e){}
  }
  // 자기 자신이 대용량 배열이면 직접 축소
  if(_BULK_KEYS_LS.includes(k) && Array.isArray(v)){
    try {
      localStorage.setItem(k, JSON.stringify(v.slice(-50)));
      console.warn('[DB] 용량 부족 — 최근 50건만 LS 유지 (IDB 보존):', k);
      return;
    } catch(_e){}
  }
  console.error('[DB] localStorage 용량 초과 — 저장 불가:', k);
  setTimeout(()=>{
    try{ toast('저장 공간 부족. 앱을 새로고침하면 자동 정리됩니다','warn',5000); }catch(_e){}
  }, 0);
}

/* ── localStorage → IndexedDB 마이그레이션 (최초 1회) ─── */
async function _migrateFromLocalStorage() {
  const migKey = 'idb_migrated_v2';
  if (localStorage.getItem(migKey)) return;
  try {
    // 기존 로컬스토리지 데이터를 IndexedDB로 이전
    const stores = [
      { lsKey: K.LOGS,    idbStore: 'logs'        },
      { lsKey: K.TRANSIT, idbStore: 'transit'     },
      { lsKey: K.AS_REQS, idbStore: 'as_requests' },
      { lsKey: K.MEMBERS, idbStore: 'members'     },
    ];
    let total = 0;
    for (const { lsKey, idbStore } of stores) {
      const data = DB.g(lsKey, []);
      if (data.length) {
        await IDB.putAll(idbStore, data);
        total += data.length;
        // localStorage.removeItem(lsKey) 제거 — getTransit() 등이 캐시 무효화 후 LS fallback으로 사용
      }
    }
    localStorage.setItem(migKey, '1');
    if (total > 0) console.log(`[IDB] 마이그레이션 완료: ${total}건`);
  } catch(e) {
    console.warn('[IDB] 마이그레이션 실패:', e);
  }
}
