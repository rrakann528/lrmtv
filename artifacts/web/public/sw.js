/* Service Worker v6 */
const CACHE = 'lrmtv-v6';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  )
);

/* ─── Push ─────────────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: e.data?.text() || 'إشعار' }; }

  e.waitUntil(
    self.registration.showNotification(d.title || 'إشعار', {
      body: d.body || '',
      tag: d.tag || 'notif',
      renotify: true,
      data: { url: d.url || '/' },
    })
  );
});

/* ─── Click ─────────────────────────────────────────────────────────────────── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  const full = url.startsWith('http') ? url : self.location.origin + url;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url === full);
      if (existing) return existing.focus();
      return clients.openWindow(full);
    })
  );
});

/* ─── Subscription change (iOS auto-renew) ──────────────────────────────────── */
self.addEventListener('pushsubscriptionchange', e => {
  const key = e.oldSubscription?.options?.applicationServerKey;
  e.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
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
