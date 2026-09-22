const CACHE = 'cambio-app-v2';
const ASSETS = [
  './',
  './index.html',
  './cambio-app.html',
  './manifest.json',
  './css/style.css',
  './js/cambio-engine.js',
  './js/app.js',
  './cambio-icon-192.png',
  './cambio-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // shell local: cache-first (funciona offline)
  // chamadas à API de cotação: sempre rede (nunca cachear cotação)
  if (event.request.url.indexOf('awesomeapi.com.br') !== -1) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((res) => {
        var resClone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, resClone));
        return res;
      }).catch(() => cached);
    })
  );
});
