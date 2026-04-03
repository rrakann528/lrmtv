/* Service Worker v10 — LrmTV PWA
 *
 * Caching strategy:
 *  • JS / CSS (content-hashed)  → cache-first   (safe forever — hash changes on update)
 *  • Google Fonts               → stale-while-revalidate
 *  • Images / icons / SVG       → cache-first   (7 days max)
 *  • HTML pages (navigation)    → network-first (always fresh index.html → correct chunk hashes)
 *  • API requests               → network-only  (never cache dynamic data)
 *  • Stream segments (.m3u8/.ts/.mpd) → network-only (live data)
 *  • Range requests             → network-only  (native video needs byte-range support)
 */

const CACHE_STATIC  = 'lrmtv-static-v10';
const CACHE_PAGES   = 'lrmtv-pages-v10';

const PRECACHE = [
  '/',
  '/home',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/opengraph.jpg',
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

  // ── Never cache: range requests (needed for native <video> seeking) ────────
  // Browsers send byte-range requests to the video server. If the SW intercepts
  // these and tries to clone/cache the partial response, Safari and Chrome both
  // get confused and the video stalls or fails to seek.
  if (req.headers.get('range')) return;

  // ── Never cache: API, sockets, streams ────────────────────────────────────
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.m3u') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.mpd') ||
    url.pathname.includes('/socket.io/') ||
    url.pathname.includes('/stream/')
  ) {
    return; // fall through to network
  }

  // ── Skip cross-origin requests we don't know about ────────────────────────
  // Only handle our own origin + known CDNs (fonts, proxy worker)
  const isSameOrigin = url.origin === self.location.origin;
  const isFonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isSameOrigin && !isFonts) return;

  // ── Cache-first: hashed JS / CSS (Vite injects hash into filename) ────────
  if (
    (url.pathname.startsWith('/assets/') && (
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.woff')
    )) ||
    url.hostname === 'fonts.gstatic.com'
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
    url.pathname.endsWith('.ico') ||
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

  // ── Network-first: HTML navigation requests ───────────────────────────────
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      caches.open(CACHE_PAGES).then(async cache => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req)) ?? await cache.match('/') ?? offlinePage();
        }
      })
    );
    return;
  }
});

function offlinePage() {
  return new Response(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LrmTV — Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0A0A;color:#e5e5e5;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:2rem}.c{max-width:360px}.logo{font-size:2.5rem;font-weight:800;background:linear-gradient(135deg,#06B6D4,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}.icon{font-size:3rem;margin-bottom:1rem}.msg{font-size:1rem;color:#a3a3a3;line-height:1.6;margin-bottom:1.5rem}button{padding:.75rem 2rem;border:none;border-radius:12px;background:linear-gradient(135deg,#06B6D4,#8B5CF6);color:#fff;font-size:.9rem;font-weight:600;cursor:pointer}</style></head><body><div class="c"><div class="icon">📡</div><div class="logo">LrmTV</div><p class="msg">أنت غير متصل بالإنترنت حالياً.<br>تحقق من اتصالك وحاول مرة أخرى.</p><button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

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
      const existing = list.find(c => c.url.startsWith(origin));
      if (existing) {
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
