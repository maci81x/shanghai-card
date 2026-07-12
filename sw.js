const CACHE_NAME = 'shanghai-card-v29';
const ASSETS = [
  '/shanghai-card/',
  '/shanghai-card/index.html',
  '/shanghai-card/style.css',
  '/shanghai-card/app.js',
  '/shanghai-card/manifest.json',
  '/shanghai-card/icons/icon-192.png',
  '/shanghai-card/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
