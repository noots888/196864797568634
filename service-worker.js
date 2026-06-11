// myMap service-worker cleanup/bump · mymap-v3-1-125_strict_simple_crossings
// Keeps GitHub Pages/mobile PWA from serving stale app shell files.
const MYMAP_SW_VERSION = 'mymap-v3-1-125_strict_simple_crossings';
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
  // Network-pass-through on purpose. The app uses local IndexedDB for imported data,
  // and stale shell caching causes old JS/CSS to survive after GitHub uploads.
  event.respondWith(fetch(event.request));
});
