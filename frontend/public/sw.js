/* KIMS service worker.
 *
 * Makes the portal installable and lets the app shell open instantly (and
 * offline). Strategy, by request type:
 *
 *   /api/...                never cached -- every API response is live data.
 *   /static/... (hashed)    cache-first  -- filenames change on every build,
 *                                           so a cached copy is never stale.
 *   navigations (index.html)  network-first, cached copy as offline fallback,
 *                              so a new build is picked up on the next open.
 *   /catalog-images/...     cache-first with a size cap -- component photos.
 *
 * CACHE_VERSION is bumped by the build (see index.js registration) so an old
 * shell never lingers after a deploy.
 */
const CACHE_VERSION = 'kims-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const IMAGE_CACHE_LIMIT = 300;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(['/', '/manifest.json', '/logo.png']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(k => cache.delete(k)));
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // App navigations: network first so deploys show up; cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Hashed build assets: cache first, forever.
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        return response;
      }))
    );
    return;
  }

  // Component photos: cache first, bounded.
  if (url.pathname.startsWith('/catalog-images/') || url.pathname.startsWith('/icons/') || url.pathname === '/logo.png') {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(IMAGE_CACHE).then(cache => cache.put(request, copy)).then(() => trimCache(IMAGE_CACHE, IMAGE_CACHE_LIMIT)).catch(() => {});
        }
        return response;
      }))
    );
  }
});

// ---- Web Push -------------------------------------------------------------
// The server sends a small JSON payload (see backend/utils/push.js). Show it,
// and on tap open the deep link in an existing app window when there is one.

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'KIMS';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Prefer a window that is already showing the portal.
      const open = list.find(client => 'focus' in client);
      if (open) return open.focus().then(c => (c && 'navigate' in c ? c.navigate(target) : c));
      return self.clients.openWindow(target);
    })
  );
});
