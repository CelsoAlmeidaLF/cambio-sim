const CACHE = 'cambio-app-v1.13.1';
const ASSETS = [
  './',
  './index.html',
  './cambio-app.html',
  './manifest.json',
  './css/style.css',
  './js/cambio-engine.js',
  './js/quote-sources.js',
  './js/app.js',
  './stk-pkg-secure-vault.js',
  './stk-pkg-secure-ui.js',
  './stk-pkg-autosave.js',
  './stk-pkg-secure-ui.css',
  './stk-pkg-financ-icons.js',
  './cambio-icon-192.png',
  './cambio-icon-512.png',
  './apoio/apoio.css',
  './apoio/stk-pkg-doacao.js',
  './apoio/stk-pkg-feedback.js',
  './apoio/stk-pkg-erros.js',
  './apoio/stk-pkg-qrcode.js',
  './fonts/fonts.css',
  './fonts/ibm-plex-mono-latin-400.woff2',
  './fonts/ibm-plex-mono-latin-500.woff2',
  './fonts/ibm-plex-mono-latin-600.woff2',
  './fonts/ibm-plex-mono-latin-ext-400.woff2',
  './fonts/ibm-plex-mono-latin-ext-500.woff2',
  './fonts/ibm-plex-mono-latin-ext-600.woff2',
  './fonts/space-grotesk-latin-ext.woff2',
  './fonts/space-grotesk-latin.woff2'
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
  // Cotações (AwesomeAPI e fontes reserva) e qualquer outro domínio: sempre rede, nunca cache.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  // Rede primeiro: atualizações valem na hora; o cache só entra quando estiver offline.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
