import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users, Play, Search, Globe, Lock, X, Mail, Check, UserCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import RoomInterstitial from '@/components/room-interstitial';

interface PublicRoom {
  id: number;
  slug: string;
  name: string;
  type: string;
  userCount: number;
  createdAt: string;
}

interface RoomInvite {
  id: number;
  roomSlug: string;
  roomName: string;
  senderUsername: string;
  senderDisplayName: string | null;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function fetchRooms(): Promise<PublicRoom[]> {
  return fetch(`${BASE}/api/rooms`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => (Array.isArray(data) ? data : []));
}

function fetchInvites(): Promise<RoomInvite[]> {
  return apiFetch('/invites/pending').then(r => r.json()).then(d => Array.isArray(d) ? d : []);
}

function useKeyboardOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setOffset(kb);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return offset;
}

// Prefetch the room page chunk so navigation feels instant
const prefetchedRef: Set<string> = new Set();
function prefetchRoomChunk() {
  if (prefetchedRef.has('room')) return;
  prefetchedRef.add('room');
  import('@/pages/room').catch(() => {});
}

export function RoomsTab() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { lang } = useI18n();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [bannedRooms, setBannedRooms] = useState<string[]>([]);
  const [kickedMsg, setKickedMsg] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState('');
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const keyboardOffset = useKeyboardOffset();
  const { data: rooms = [], isLoading } = useQuery<PublicRoom[]>({
    queryKey: ['rooms'],
    queryFn: fetchRooms,
    refetchInterval: 5_000,
  });

  const { data: invites = [] } = useQuery<RoomInvite[]>({
    queryKey: ['room-invites'],
    queryFn: fetchInvites,
    enabled: !!user,
    refetchInterval: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });


  // Read banned rooms from localStorage on mount + detect kicked redirect
  useEffect(() => {
    try {
      const banned: string[] = JSON.parse(localStorage.getItem('lrmtv_banned_rooms') || '[]');
      setBannedRooms(banned);
      const lastKicked = localStorage.getItem('lrmtv_last_kicked');
      if (lastKicked) {
        setKickedMsg(lastKicked);
        localStorage.removeItem('lrmtv_last_kicked');
        setTimeout(() => setKickedMsg(null), 5000);
      }
    } catch {}
  }, []);

  const declineMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/invites/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'declined' }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-invites'] });
      qc.invalidateQueries({ queryKey: ['rooms-badge'] });
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: roomName, type: isPrivate ? 'private' : 'public', username: user?.username || 'guest' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل إنشاء الغرفة');
      return d;
    },
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      setPendingRoom(room.slug);
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const filtered = rooms.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const handleJoinCode = () => {
    const slug = joinCode.replace(/^(.*\/room\/)/, '').trim();
    if (slug) setPendingRoom(slug);
  };

  return (
    <div className="flex flex-col h-full">

      {/* Kicked banner */}
      <AnimatePresence>
        {kickedMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-4 mt-3 px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 text-sm font-medium text-center"
          >
            ⛔ تم طردك من الغرفة
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Join */}
      <div className="px-4 pt-4 pb-2 space-y-2">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن غرفة..."
            className="w-full bg-muted/50 border border-border rounded-xl pl-4 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            dir="rtl"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder="أدخل كود الغرفة..."
            className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            dir="rtl"
            onKeyDown={e => e.key === 'Enter' && handleJoinCode()}
          />
          <button
            onClick={handleJoinCode}
            disabled={!joinCode.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40"
          >
            دخول
          </button>
        </div>
      </div>

      {/* Rooms list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">

        {/* ── Friend Invites Section ── */}
        <AnimatePresence>
          {invites.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 pt-1">
                <Mail className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold text-foreground">
                  دعوات الأصدقاء ({invites.length})
                </span>
              </div>

              {invites.map((inv, i) => {
                const senderName = inv.senderDisplayName || inv.senderUsername;
                return (
                  <motion.div
                    key={inv.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 bg-primary/8 border border-primary/20 rounded-2xl p-3"
                  >
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      <UserCircle2 className="w-5 h-5 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">
                        {inv.roomName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        دعاك <span className="text-primary font-medium">{senderName}</span> للانضمام
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          declineMut.mutate(inv.id);
                          qc.invalidateQueries({ queryKey: ['room-invites'] });
                        }}
                        disabled={declineMut.isPending}
                        className="w-8 h-8 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
                        title="رفض"
                      >
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => {
                          // Mark as accepted then join
                          apiFetch(`/invites/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
                          qc.invalidateQueries({ queryKey: ['room-invites'] });
                          qc.invalidateQueries({ queryKey: ['rooms-badge'] });
                          setPendingRoom(inv.roomSlug);
                        }}
                        className="flex items-center gap-1 px-3 h-8 rounded-xl bg-primary text-primary-foreground text-xs font-bold active:scale-90 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        دخول
                      </button>
                    </div>
                  </motion.div>
                );
              })}

              <div className="border-t border-border/50 pt-1" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Rooms List ── */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">الغرف العامة ({filtered.length})</span>
        </div>

        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted/40 rounded-2xl animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Globe className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">لا توجد غرف عامة حالياً</p>
            <p className="text-xs mt-1 opacity-60">أنشئ أول غرفة!</p>
          </div>
        ) : (
          filtered.map((room, i) => (
            <motion.div
              key={room.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4"
              onMouseEnter={prefetchRoomChunk}
              onTouchStart={prefetchRoomChunk}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                {room.type === 'private' ? (
                  <Lock className="w-5 h-5 text-primary" />
                ) : (
                  <Play className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">{room.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Users className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{room.userCount} مشاهد</span>
                </div>
              </div>
              {bannedRooms.includes(room.slug) ? (
                <button
                  disabled
                  className="flex-shrink-0 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/40 rounded-xl text-xs font-bold cursor-not-allowed"
                >
                  مطرود
                </button>
              ) : (
                <button
                  onClick={() => setPendingRoom(room.slug)}
                  className="flex-shrink-0 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:bg-primary/90"
                >
                  دخول
                </button>
              )}
            </motion.div>
          ))
        )}
      </div>

      {/* FAB — only for registered users */}
      {user && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowCreate(true)}
          className="fixed left-4 z-[50] w-14 h-14 bg-primary rounded-full shadow-xl shadow-primary/40 flex items-center justify-center"
          style={{ bottom: 'calc(160px + env(safe-area-inset-bottom, 0px))' }}
        >
          <Plus className="w-7 h-7 text-primary-foreground" />
        </motion.button>
      )}

      {/* Create Room Modal */}
      {createPortal(
        <AnimatePresence>
          {showCreate && (
            <motion.div
              className="fixed inset-0 z-[200] flex items-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
              <div
                style={{
                  width: '100%',
                  transform: `translateY(-${keyboardOffset}px)`,
                  transition: 'transform 0.25s ease-out',
                }}
              >
              <motion.div
                className="relative w-full bg-card rounded-t-3xl p-6 z-10"
                style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom, 0px))' }}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              >
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg font-bold text-foreground">إنشاء غرفة جديدة</h3>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-muted/50">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {createErr && (
                  <div className="mb-3 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-xs">{createErr}</div>
                )}

                <div className="space-y-3">
                  <input
                    value={roomName}
                    onChange={e => setRoomName(e.target.value)}
                    placeholder="اسم الغرفة"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    dir="rtl"
                    autoFocus
                  />

                  <div className="flex items-center justify-between px-1 py-2">
                    <span className="text-sm text-foreground">{(lang === 'ar') ? 'غرفة خاصة' : 'Private room'}</span>
                    <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                  </div>

                  <button
                    onClick={() => { setCreateErr(''); createMut.mutate(); }}
                    disabled={!roomName.trim() || createMut.isPending}
                    className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-40"
                  >
                    {createMut.isPending ? 'جاري الإنشاء...' : 'إنشاء الغرفة'}
                  </button>
                </div>
              </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Interstitial Ad ───────────────────────────────────────── */}
      {pendingRoom && (
        <RoomInterstitial
          onDone={() => {
            const slug = pendingRoom;
            setPendingRoom(null);
            setLocation(`/room/${slug}`);
          }}
        />
      )}
    </div>
  );
}

