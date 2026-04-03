/* ═══════════════════════════════════════════════════════════
   AJ 고소작업대 Service Worker v3.4
   - 앱 셸 캐시 (오프라인 지원)
   - Supabase API는 네트워크 우선, 실패 시 큐잉
   - 백그라운드 싱크 지원
═══════════════════════════════════════════════════════════ */
const SW_VER   = 'aj-v3.4';
const SHELL_CACHE = SW_VER + '-shell';
const API_CACHE   = SW_VER + '-api';

// 앱 셸 — 오프라인에서도 로드돼야 하는 리소스
const SHELL_ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&family=JetBrains+Mono:wght@600&display=swap',
];

// ── Install: 앱 셸 캐시 ─────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // 폰트만 캐시 (앱 자체는 단일 HTML이라 자동 캐시)
      cache.addAll([
        'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&family=JetBrains+Mono:wght@600&display=swap'
      ]).catch(() => {}) // 폰트 실패해도 계속
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: 구버전 캐시 정리 ──────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: 네트워크 우선 전략 ────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API — 네트워크 우선, 실패해도 오류 전달 (캐시 안 함)
  if (url.hostname.endsWith('.supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Google Fonts — 캐시 우선
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(e.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // 앱 HTML — 네트워크 우선, 실패 시 캐시
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 기타 — 기본 fetch
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ── Background Sync: 오프라인 큐 처리 ───────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-logs') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'BG_SYNC' }))
      )
    );
  }
});

// ── Push 알림 (향후 확장용) ──────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || '고소작업대', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './badge.png',
      tag: data.tag || 'aj-notif',
      data: data.url || '/'
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || '/'));
});
