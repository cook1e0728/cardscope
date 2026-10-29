// PWA shell cache. Network-first so a deploy is never hidden behind an old copy; the cache is only the offline fallback.
// Only same-origin GET of the static shell is stored: never /api/*, never third-party card images.
const VERSION = 'cardscope-shell-v1';
const SHELL_URLS = ['/', '/assets/brand/web/rabbit-offline.webp', '/assets/brand/web/pwa-icon-192.png'];
const SHELL_PATH = /^\/(?:[a-z0-9-]+\.(?:js|css)|assets\/brand\/web\/[\w.-]+\.(?:png|webp)|assets\/[\w./-]*\.(?:png|webp|svg|woff2?))$/;
const OFFLINE_HTML = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CardScope 離線</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#EDE8DE;color:#16132A;font:16px/1.6 system-ui,\'Noto Sans TC\',sans-serif;text-align:center"><main style="padding:24px"><img src="/assets/brand/web/rabbit-offline.webp" alt="" width="160" style="max-width:50vw;height:auto"><h1 style="font-size:20px;margin:12px 0 6px">目前離線</h1><p style="margin:0">已收藏的卡仍保存在這台裝置。連上網路後再重新整理即可。</p></main>';

self.addEventListener('install', event => {
  // addAll would fail the whole install on one 404; best-effort per URL instead.
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(SHELL_URLS.map(url => cache.add(url).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = request.mode === 'navigate';
  if (!isPage && !SHELL_PATH.test(url.pathname)) return;
  // All navigations share the '/' entry: the app is a single-page shell and deep links are resolved client-side.
  const key = isPage ? '/' : request;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && (!isPage || response.headers.get('content-type')?.includes('text/html'))) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(key, copy)); }
    return response;
  }).catch(async () => (await caches.match(key)) || (isPage ? new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error())));
});
