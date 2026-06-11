// myMap service worker · mymap-v3-1-128_pwa_download_fix
// Keeps the app shell installable and clears older myMap caches.
const MYMAP_SW_VERSION = 'mymap-v3-1-128_pwa_download_fix';
const SHELL_CACHE = 'mymap-shell-v3-1-128';
const OLD_CACHE_PATTERNS = [/^field-map-/i, /^fieldMap/i, /^myMap/i, /^mymap/i];
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/lean-engine.css',
  './js/lean-app-core.js',
  './js/diagnostics.js',
  './js/lean-engine-stubs.js',
  './js/storage-engine.js',
  './js/import-engine.js',
  './js/conductor-data-loader.js',
  './js/search-engine.js',
  './js/span-weight-calculator.js',
  './js/popup-engine.js',
  './js/map-engine.js',
  './js/hv-crossings-layer.js',
  './js/lean-map-app.js',
  './workers/geojson-import-worker.js',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-source-mymap.png',
  './icons/pin-drop-mymap.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL.map(url => new Request(url, {cache: 'reload'})));
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => {
        if ((OLD_CACHE_PATTERNS.some(re => re.test(key)) || key.startsWith('mymap-shell-')) && key !== SHELL_CACHE) return caches.delete(key);
        return Promise.resolve(false);
      }));
    } catch (e) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isAppShell = url.origin === location.origin && APP_SHELL.some(path => url.pathname.endsWith(path.replace('./','/')) || (path === './' && /\/$/.test(url.pathname)));
  if (isAppShell) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(event.request, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match(event.request, {ignoreSearch:true});
        if (cached) return cached;
        if (url.pathname.endsWith('/')) return caches.match('./index.html');
        throw e;
      }
    })());
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request, {ignoreSearch:true})));
});
