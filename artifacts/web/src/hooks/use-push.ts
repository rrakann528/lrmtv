import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './use-auth';

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const b   = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map(c => c.charCodeAt(0)));
}

const SUBSCRIBED_KEY = 'push_subscribed_uid';

const isSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePush(userId?: number) {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    isSupported ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(() => {
    if (!isSupported || !userId) return false;
    try { return localStorage.getItem(SUBSCRIBED_KEY) === String(userId); } catch { return false; }
  });
  const [loading, setLoading]         = useState(false);
  const autoAttempted                 = useRef(false);

  // Auto-subscribe: if permission is already granted and userId changes, re-register silently
  useEffect(() => {
    if (!isSupported || !userId || autoAttempted.current) return;
    if (Notification.permission !== 'granted') return;
    autoAttempted.current = true;
    doSubscribe(false, true /* silent */);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSubscribe = useCallback(async (forceNew = false, silent = false): Promise<boolean> => {
    if (!isSupported || !userId) return false;
    if (!silent) setLoading(true);
    try {
      const perm = silent
        ? Notification.permission
        : await Notification.requestPermission();

      setPermission(perm);
      if (perm !== 'granted') return false;

      const { key } = await apiFetch('/push/vapid-public-key').then(r => r.json());
      const reg     = await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();

      if (sub && forceNew) {
        await sub.unsubscribe();
        sub = null;
      }

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(key),
        });
      }

      const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: Record<string, string> };

      const r = await apiFetch('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }),
      });

      if (!r.ok) return false;

      localStorage.setItem(SUBSCRIBED_KEY, String(userId));
      setSubscribed(true);
      return true;
    } catch (e) {
      console.error('[Push] subscribe error:', e);
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  const subscribe = useCallback(() => doSubscribe(false), [doSubscribe]);
  const refresh   = useCallback(() => doSubscribe(true),  [doSubscribe]);

  /** Send a test push to yourself */
  const test = useCallback(async (): Promise<boolean> => {
    try {
      const r = await apiFetch('/push/test', { method: 'POST' });
      return r.ok;
    } catch { return false; }
  }, []);

  /** Invite a friend to a room */
  const inviteFriend = useCallback(async (
    friendId: number,
    roomSlug: string,
    roomName: string,
  ): Promise<{ ok: boolean; sent: number }> => {
    try {
      const r = await apiFetch('/push/invite', {
        method: 'POST',
        body: JSON.stringify({ friendId, roomSlug, roomName }),
      });
      if (!r.ok) return { ok: false, sent: 0 };
      const j = await r.json();
      return { ok: j.sent > 0, sent: j.sent ?? 0 };
    } catch {
      return { ok: false, sent: 0 };
    }
  }, []);

  return { permission, subscribed, loading, subscribe, refresh, test, inviteFriend, isSupported };
}
