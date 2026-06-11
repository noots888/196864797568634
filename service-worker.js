// myMap service worker · mymap-v3-1-129_pwa_real_install_fix
// Simple shell controller: no heavy pre-cache, so Android install does not hang.
const MYMAP_SW_VERSION = 'mymap-v3-1-129_pwa_real_install_fix';
const OLD_CACHE_PATTERNS = [/^field-map-/i, /^fieldMap/i, /^myMap/i, /^mymap/i];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => {
        if (OLD_CACHE_PATTERNS.some(re => re.test(key))) return caches.delete(key);
        return Promise.resolve(false);
      }));
    } catch (e) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(async () => {
    try {
      const url = new URL(event.request.url);
      if (url.origin === location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
        const cached = await caches.match('./index.html', {ignoreSearch:true});
        if (cached) return cached;
      }
    } catch(e) {}
    throw new Error('myMap offline and requested file is not cached');
  }));
});
