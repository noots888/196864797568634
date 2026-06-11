// myMap service-worker cleanup/bump · mymap-v3-1-127_manifest_install_fix
// Registerable PWA shell worker. Network-first to avoid stale GitHub Pages files.
const MYMAP_SW_VERSION = 'mymap-v3-1-127_manifest_install_fix';
const OLD_CACHE_PATTERNS = [/^field-map-/i, /^fieldMap/i, /^myMap/i, /^mymap/i];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => {
        if (OLD_CACHE_PATTERNS.some(re => re.test(key)) && key !== MYMAP_SW_VERSION) return caches.delete(key);
        return Promise.resolve(false);
      }));
    } catch (e) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
