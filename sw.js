/* ═══════════════════════════════════════
   AJ 고소작업대 Service Worker
   - 정적 자산 캐시 (오프라인 지원)
   - 외부 API (Supabase, Anthropic, Google) 제외
═══════════════════════════════════════ */
const CACHE_NAME = 'ajpjt-v7'; // 2026-03-27 프로젝트 즉시반영 / 장비현황 pull / AJ가입알람
const SHELL = [
  '/', '/index.html', '/manifest.json', '/sw.js',
  '/js/db.js', '/js/state.js', '/js/api.js',
  '/js/ui.js', '/js/app.js', '/js/event.js',
];

const BYPASS = [
  'supabase.co', 'anthropic.com', 'googleapis.com',
  'gstatic.com', 'fonts.google', 'script.google'
];

// SHELL 파일 URL 집합 (Network-First 적용 대상)
const _origin = self.location.origin;
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, _origin).href));

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── 백그라운드 푸시 수신 ──────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'AJ 알림', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: data.tag || 'ajpjt',
      renotify: true,
      data: data
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const win = list.find(w => w.url.includes(self.location.origin));
      if (win) return win.focus();
      return clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (BYPASS.some(d => url.includes(d))) return;
  if (!url.startsWith('http')) return;

  // JS·HTML(SHELL) — Network-First: 항상 최신 코드 로드, 오프라인 시 캐시 fallback
  if (SHELL_URLS.has(url) || url === _origin + '/') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 기타 자산 (아이콘·이미지 등) — Cache-First: 성능 우선
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        if (e.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
