// sw.js - Service Worker (FAKDU v9.46)

const SW_VERSION = '9.46.1';
const CACHE_NAME = `fakdu-cache-v${SW_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './client.html',
  './style.css',
  './manifest.json',
  './icon.png',
  './js/db.js',
  './js/core.js',
  './js/client-core.js',
  './js/vault.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const networkFetch = fetch(event.request)
      .then(async (response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(() => cached);

    return cached || networkFetch;
  })());
});
