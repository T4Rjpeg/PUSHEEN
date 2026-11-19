// Keeps Pusheen working offline. Online: always asks GitHub for the newest version first.
const CACHE = 'pusheen-v5';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'sprites.js', 'extras.js', 'scene.js', 'core.js', 'lang.js', 'study.js', 'brain.js', 'mind.js', 'games.js', 'duo.js', 'ui.js', 'boot.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pusheen-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameSite = url.origin === self.location.origin;
  // her brain (OpenRouter / Anthropic) is never cached
  if (!sameSite && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  const req = sameSite ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : e.request;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.redirected && e.request.mode === 'navigate') return Response.redirect(res.url, 302);
        if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request.url, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request.url).then(r => r || caches.match(url.origin + url.pathname)).then(r => r || (e.request.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
