/**
 * puffsn0w — Offline Service Worker
 * Network-first strategy with offline cache fallback.
 */

const CACHE_NAME = 'puffsn0w-cache-v4.9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './demo/',
  './demo/index.html',
  './styles.css',
  './app.js',
  './earth-wallpaper.png',
  './puffco-ble.js',
  './curve-governor.js',
  './simulator.js',
  './curves-data.js',
  './curves.json',
  './manifest.json',
  './icons/favicon.ico',
  './icons/favicon-32x32.png',
  './icons/favicon-16x16.png',
  './icons/apple-touch-icon.png',
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png',
  './icons/puffsn0w-icon.svg',
  './icons/puffsn0w-icon.png',
  './icons/puffsn0w.png',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Network-first strategy: always fetch fresh from network if online
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fall back to cache when offline
        return caches.match(event.request);
      })
  );
});
