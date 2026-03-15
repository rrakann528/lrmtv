/* Service Worker v7 — LrmTV PWA
 *
 * Caching strategy:
 *  • JS / CSS (content-hashed)  → cache-first  (safe forever — hash changes on update)
 *  • Google Fonts               → cache-first  (stale-ok, font files rarely change)
 *  • Images / icons / SVG       → cache-first  (7 days max)
 *  • HTML pages (navigation)    → stale-while-revalidate (instant load, update in bg)
 *  • API requests               → network-only (never cache dynamic data)
 *  • Stream segments (.m3u8/.ts) → network-only (live data, huge, never cache)
 */

const CACHE_STATIC  = 'lrmtv-static-v7';   // JS / CSS / fonts / images
const CACHE_PAGES   = 'lrmtv-pages-v7';    // HTML shells

const PRECACHE = [
  '/',
  '/home',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

/* ─── Install: precache the app shell ─────────────────────────────────────── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_PAGES)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* ─── Activate: delete old caches ─────────────────────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES)
          .map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  );
});

/* ─── Fetch ────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // ── Never cache: API, sockets, streams ────────────────────────────────────
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.mpd') ||
    url.pathname.includes('/socket.io/') ||
    url.pathname.includes('/stream/')
  ) {
    return; // fall through to network
  }

  // ── Cache-first: hashed JS / CSS (Vite injects hash into filename) ────────
  if (
    (url.pathname.startsWith('/assets/') && (
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.woff')
    )) ||
    url.hostname === 'fonts.gstatic.com'   // font binary files
  ) {
    e.respondWith(
      caches.open(CACHE_STATIC).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // ── Cache-first: icons / images / manifest (short-lived) ──────────────────
  if (
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname === '/manifest.json'
  ) {
    e.respondWith(
      caches.open(CACHE_STATIC).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit ?? new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // ── Stale-while-revalidate: Google Fonts CSS ───────────────────────────────
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.open(CACHE_STATIC).then(async cache => {
        const hit = await cache.match(req);
        const fetchPromise = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return hit ?? (await fetchPromise) ?? new Response('', { status: 503 });
      })
    );
    return;
  }

  // ── Stale-while-revalidate: HTML navigation requests ─────────────────────
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      caches.open(CACHE_PAGES).then(async cache => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => null);

        if (cached) {
          // Serve cached immediately; update in background
          fetchPromise.catch(() => {});
          return cached;
        }
        // No cache: try network, fallback to root shell
        return (await fetchPromise) ?? await cache.match('/') ?? new Response('', { status: 503 });
      })
    );
    return;
  }
  // Everything else: network-only
});

/* ─── Push notifications ───────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: e.data?.text() || 'إشعار' }; }

  e.waitUntil(
    self.registration.showNotification(d.title || 'إشعار', {
      body: d.body || '',
      tag: d.tag || 'notif',
      renotify: true,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      data: { url: d.url || '/' },
    })
  );
});

/* ─── Notification click ───────────────────────────────────────────────────── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  const full = url.startsWith('http') ? url : self.location.origin + url;
  const origin = self.location.origin;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Find any open window on the same origin
      const existing = list.find(c => c.url.startsWith(origin));
      if (existing) {
        // Navigate the existing window to the target URL and focus it
        existing.navigate(full).catch(() => {});
        return existing.focus();
      }
      return clients.openWindow(full);
    })
  );
});

/* ─── Push subscription auto-renew (iOS) ──────────────────────────────────── */
self.addEventListener('pushsubscriptionchange', e => {
  const key = e.oldSubscription?.options?.applicationServerKey;
  e.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(sub => {
        const j = sub.toJSON();
        return fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
        });
      }).catch(() => {})
  );
});
