const CACHE_NAME = 'kelime-ezber-pwa-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// iOS Safari zaman aşımını ve beyaz ekranı önleyen Network-First / Cache-Fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Harici CDN'ler ve API'ler için doğrudan ağ
  const url = event.request.url;
  if (url.includes('/api/') || url.includes('cdn.') || url.includes('unpkg.') || url.includes('googleapis.')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Yerel dosyalar için Network-First, hata durumunda Cache-Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
