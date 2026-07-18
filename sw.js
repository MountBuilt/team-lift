// Team Lift service worker: stale-while-revalidate for the app shell and CDN
// assets so opens are near-instant. After a deploy, a user's first open may
// serve the previous version; the refreshed copy lands on the next open.
// Firestore/live data (anything on *.googleapis.com) is never intercepted.
const CACHE = 'teamlift-v2'; // bumped for the 2026-07 visual redesign (fonts/, new css)

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

// Web push: payload is JSON { title, body } sent by scripts/orchestrator.mjs.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* malformed payload: show fallback */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Team Lift', {
    body: data.body || 'Get after it.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('.');
    })
  );
});
