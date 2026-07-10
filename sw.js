// Team Lift service worker: stale-while-revalidate for the app shell and CDN
// assets so opens are near-instant. After a deploy, a user's first open may
// serve the previous version; the refreshed copy lands on the next open.
// Firestore/live data (anything on *.googleapis.com) is never intercepted.
const CACHE = 'teamlift-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname.endsWith('googleapis.com')) return;
  event.respondWith(staleWhileRevalidate(event.request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(resp => {
    // Opaque responses (no-cors CDN scripts) report ok:false but cache fine.
    if (resp.ok || resp.type === 'opaque') cache.put(request, resp.clone());
    return resp;
  }).catch(() => cached);
  return cached || refresh;
}
