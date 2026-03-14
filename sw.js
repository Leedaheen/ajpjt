/* ═══════════════════════════════════════
   AJ 고소작업대 Service Worker
   - 정적 자산 캐시 (오프라인 지원)
   - 외부 API (Supabase, Anthropic, Google) 제외
═══════════════════════════════════════ */
const CACHE_NAME = 'ajpjt-v2';
const SHELL = ['/', '/index.html', '/manifest.json', '/sw.js'];

const BYPASS = [
  'supabase.co', 'anthropic.com', 'googleapis.com',
  'gstatic.com', 'fonts.google', 'script.google'
];

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

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (BYPASS.some(d => url.includes(d))) return;
  if (!url.startsWith('http')) return;

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
        if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
