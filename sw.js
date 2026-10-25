// Dormant. The old worker cached the live app (stale-while-revalidate) and
// showed Aiden's pushes. This one drops those caches, ends the push
// subscription, reloads onto the shutdown page, and does not cache anything.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch { /* push already gone */ }
    await self.clients.claim();
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(open.map((client) => {
      const clean = client.url.split('#')[0].split('?')[0];
      return client.navigate(clean);
    }));
    await self.registration.unregister();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
