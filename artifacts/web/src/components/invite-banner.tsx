import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth, apiFetch } from '@/hooks/use-auth';

interface Invite {
  id: string;
  dbId?: number;
  from: string;
  roomSlug: string;
  roomName: string;
}

export default function InviteBanner() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [invites, setInvites] = useState<Invite[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const shownDbIds = useRef<Set<number>>(new Set());

  const addInvite = useCallback((invite: Invite) => {
    setInvites(prev => {
      // Avoid duplicate from same sender+room
      const key = `${invite.from}-${invite.roomSlug}`;
      if (prev.some(i => `${i.from}-${i.roomSlug}` === key)) return prev;
      return [...prev, invite];
    });
    setTimeout(() => {
      setInvites(prev => prev.filter(i => i.id !== invite.id));
    }, 20000);
  }, []);

  // ── Load pending invites from DB on mount ─────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    apiFetch('/invites/pending')
      .then(r => r.ok ? r.json() : [])
      .then((pending: { id: number; roomSlug: string; roomName: string; senderUsername: string }[]) => {
        for (const inv of pending) {
          if (shownDbIds.current.has(inv.id)) continue;
          shownDbIds.current.add(inv.id);
          addInvite({
            id: `db-${inv.id}-${Date.now()}`,
            dbId: inv.id,
            from: inv.senderUsername,
            roomSlug: inv.roomSlug,
            roomName: inv.roomName,
          });
        }
      })
      .catch(() => {});
  }, [user?.id, addInvite]);

  // ── Real-time via Socket.io ───────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const socket = io('/', {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-user-room', { userId: user.id });
    });

    socket.on('room-invite', (data: { from: string; roomSlug: string; roomName: string }) => {
      addInvite({
        id: `ws-${Date.now()}-${Math.random()}`,
        from: data.from,
        roomSlug: data.roomSlug,
        roomName: data.roomName,
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id, addInvite]);

  const dismiss = useCallback((invite: Invite) => {
    setInvites(prev => prev.filter(i => i.id !== invite.id));
    if (invite.dbId) {
      apiFetch(`/invites/${invite.dbId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'declined' }),
      }).catch(() => {});
    }
  }, []);

  const join = useCallback((invite: Invite) => {
    if (invite.dbId) {
      apiFetch(`/invites/${invite.dbId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      }).catch(() => {});
    }
    setInvites(prev => prev.filter(i => i.id !== invite.id));
    setLocation(`/room/${invite.roomSlug}`);
  }, [setLocation]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      <AnimatePresence>
        {invites.map(invite => (
          <motion.div
            key={invite.id}
            initial={{ opacity: 0, y: -24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.94 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="pointer-events-auto bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xl">
              🎬
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">
                دعوة من {invite.from}
              </p>
              <p className="text-white/50 text-xs truncate">
                {invite.roomName}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => join(invite)}
                className="px-3 py-1.5 bg-primary text-black text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors"
              >
                دخول
              </button>
              <button
                onClick={() => dismiss(invite)}
                className="px-2 py-1.5 text-white/40 text-xs hover:text-white/70 transition-colors"
              >
                ✕
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
