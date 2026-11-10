const CACHE_VERSION = 'v2.0.1';
const CACHE_NAME = `kelime-ezber-cache-${CACHE_VERSION}`;

// Service Worker kurulumunda beklemeyi atla ve anında devreye gir
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Eski sürüm önbelleklerini derhal temizle ve istemcileri sahiplen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Eski onbellek temizleniyor:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First (Önce Ağ / İnternet) Stratejisi
// İnternet bağlı olduğu sürece her zaman Vercel'den en güncel dosyaları çek
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Harici CDN'ler ve API istekleri doğrudan ağa gider
  if (url.includes('/api/') || url.includes('cdn.') || url.includes('unpkg.') || url.includes('googleapis.')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // index.html, app.js, style.css vb. yerel kaynaklar için Network-First
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Yalnızca ağ bağlantısı kesildiğinde önbellekten sun
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
