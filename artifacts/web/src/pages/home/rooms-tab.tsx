import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Globe, Lock, X, Mail, Check, UserCircle2, Tv2, Play } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import { generateColorFromString } from '@/lib/utils';

interface PublicRoom {
  id: number;
  slug: string;
  name: string;
  type: string;
  userCount: number;
  createdAt: string;
  currentVideoUrl?: string | null;
  users?: Array<{ username: string }>;
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

function getYoutubeThumbnail(url: string): string | null {
  if (!url) return null;
  let videoId: string | null = null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      videoId = u.searchParams.get('v');
    } else if (u.hostname === 'youtu.be') {
      videoId = u.pathname.slice(1).split('?')[0];
    }
  } catch {}
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
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

const prefetchedRef: Set<string> = new Set();
function prefetchRoomChunk() {
  if (prefetchedRef.has('room')) return;
  prefetchedRef.add('room');
  import('@/pages/room').catch(() => {});
}

function RoomCard({ room, banned, onEnter }: {
  room: PublicRoom;
  banned: boolean;
  onEnter: () => void;
}) {
  const { t } = useI18n();
  const thumbnail = room.currentVideoUrl ? getYoutubeThumbnail(room.currentVideoUrl) : null;
  const isYouTube = !!thumbnail;
  const users = room.users ?? [];
  const MAX_AVATARS = 5;
  const shown = users.slice(0, MAX_AVATARS);
  const extra = room.userCount > MAX_AVATARS ? room.userCount - MAX_AVATARS : 0;

  const gradientColor = generateColorFromString(room.name);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={!banned ? { scale: 0.97 } : {}}
      onClick={!banned ? onEnter : undefined}
      onMouseEnter={prefetchRoomChunk}
      onTouchStart={prefetchRoomChunk}
      className={`flex rounded-2xl overflow-hidden border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm ${!banned ? 'cursor-pointer active:scale-[0.97]' : 'opacity-60'}`}
      style={{ minHeight: '86px' }}
    >
      {/* ── Left: Thumbnail ── */}
      <div className="relative shrink-0 overflow-hidden" style={{ width: '120px' }}>
        {thumbnail ? (
          <>
            <img
              src={thumbnail}
              alt={room.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                (e.currentTarget.nextElementSibling as HTMLElement | null)?.classList.remove('hidden');
              }}
            />
            {/* Fallback behind image */}
            <div
              className="hidden absolute inset-0 flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${gradientColor}55, ${gradientColor}22)` }}
            >
              <Tv2 className="w-8 h-8 text-white/40" />
            </div>
            {/* YouTube icon */}
            <div className="absolute bottom-1.5 left-1.5 bg-black/70 rounded px-1 py-0.5 flex items-center gap-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#FF0000">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-2.75 12.68 12.68 0 0 0-7.35 0 4.83 4.83 0 0 1-3.77 2.75A5 5 0 0 0 3 11.5v1a5 5 0 0 0 1.7 3.81 4.83 4.83 0 0 1 3.77 2.75 12.68 12.68 0 0 0 7.35 0 4.83 4.83 0 0 1 3.77-2.75A5 5 0 0 0 21 12.5v-1a5 5 0 0 0-1.41-3.81z"/>
              </svg>
            </div>
            {/* Play indicator */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20" />
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-1"
            style={{ background: `linear-gradient(135deg, ${gradientColor}44 0%, ${gradientColor}18 100%)` }}
          >
            {room.type === 'private' ? (
              <Lock className="w-7 h-7 text-white/50" />
            ) : (
              <Play className="w-7 h-7 text-white/40" />
            )}
            <span className="text-[9px] text-white/30 font-medium uppercase tracking-widest">
              {room.userCount === 0 ? 'فارغة' : 'مباشر'}
            </span>
          </div>
        )}
      </div>

      {/* ── Right: Info ── */}
      <div className="flex-1 min-w-0 flex flex-col justify-between p-3">
        {/* Room name */}
        <div className="flex items-start gap-1.5">
          <p className="font-bold text-foreground text-[13px] leading-tight flex-1 line-clamp-2">
            {room.name}
          </p>
          {room.type === 'private' && (
            <Lock className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          )}
        </div>

        {/* Bottom: avatars + count badge */}
        <div className="flex items-center justify-between mt-2">
          {/* Overlapping avatars */}
          <div className="flex items-center">
            {shown.length > 0 ? (
              shown.map((u, i) => (
                <div
                  key={u.username + i}
                  className="w-[22px] h-[22px] rounded-full border-[1.5px] border-card flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                  style={{
                    backgroundColor: generateColorFromString(u.username),
                    marginLeft: i > 0 ? '-7px' : '0',
                    zIndex: shown.length - i,
                    position: 'relative',
                  }}
                >
                  {u.username.charAt(0).toUpperCase()}
                </div>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground/60">
                {t('noPublicRooms').length > 0 ? 'لا يوجد مشاهدين' : 'empty'}
              </span>
            )}
          </div>

          {/* User count badge or banned */}
          {banned ? (
            <span className="text-[10px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 rounded-full px-2 py-0.5">
              {t('banned')}
            </span>
          ) : room.userCount > 0 ? (
            <div className="flex items-center gap-1">
              {extra > 0 && (
                <span className="text-[10px] font-bold text-muted-foreground">+{extra}</span>
              )}
              <div
                className="min-w-[28px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-extrabold text-white px-1.5"
                style={{ backgroundColor: isYouTube ? '#ef4444' : 'var(--primary)' }}
              >
                {room.userCount}
              </div>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground/50">خالية</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function RoomsTab() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [bannedRooms, setBannedRooms] = useState<string[]>([]);
  const [kickedMsg, setKickedMsg] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState('');

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
      if (!r.ok) throw new Error(d.error || 'Failed to create room');
      return d;
    },
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      setLocation('/room/' + room.slug);
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const filtered = rooms.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const handleJoinCode = () => {
    const slug = joinCode.replace(/^(.*\/room\/)/, '').trim();
    if (slug) setLocation('/room/' + slug);
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
            {t('kickedFromRoom')}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Join */}
      <div className="px-4 pt-2 pb-1.5 space-y-1.5">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('searchRoomPlaceholder')}
            className="w-full bg-muted/50 border border-border rounded-xl pl-4 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder={t('enterRoomCode')}
            className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={e => e.key === 'Enter' && handleJoinCode()}
          />
          <button
            onClick={handleJoinCode}
            disabled={!joinCode.trim()}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40"
          >
            {t('enterRoom')}
          </button>
        </div>
      </div>

      {/* Rooms list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">

        {/* ── Friend Invites ── */}
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
                  {t('friendInvites')} ({invites.length})
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
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      <UserCircle2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{inv.roomName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="text-primary font-medium">{senderName}</span> {t('invitedYouBy')}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          declineMut.mutate(inv.id);
                          qc.invalidateQueries({ queryKey: ['room-invites'] });
                        }}
                        disabled={declineMut.isPending}
                        className="w-8 h-8 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
                        title={t('decline')}
                      >
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => {
                          apiFetch(`/invites/${inv.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
                          qc.invalidateQueries({ queryKey: ['room-invites'] });
                          qc.invalidateQueries({ queryKey: ['rooms-badge'] });
                          setLocation('/room/' + inv.roomSlug);
                        }}
                        className="flex items-center gap-1 px-3 h-8 rounded-xl bg-primary text-primary-foreground text-xs font-bold active:scale-90 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {t('enterRoom')}
                      </button>
                    </div>
                  </motion.div>
                );
              })}

              <div className="border-t border-border/50 pt-1" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Rooms count header ── */}
        <div className="flex items-center justify-between py-0.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('publicRooms')} ({filtered.length})
          </span>
          {filtered.some(r => r.userCount > 0) && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              مباشر
            </span>
          )}
        </div>

        {/* ── Room cards ── */}
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex rounded-2xl overflow-hidden border border-border/40 bg-card/60 animate-pulse" style={{ height: '86px' }}>
              <div className="w-[120px] shrink-0 bg-muted/60" />
              <div className="flex-1 p-3 space-y-2">
                <div className="h-3.5 bg-muted/60 rounded-lg w-3/4" />
                <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                <div className="h-5 bg-muted/30 rounded-full w-1/3 mt-auto" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Globe className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">{t('noPublicRooms')}</p>
            <p className="text-xs mt-1 opacity-50">{t('createFirstRoom')}</p>
          </div>
        ) : (
          filtered.map((room, i) => (
            <motion.div
              key={room.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <RoomCard
                room={room}
                banned={bannedRooms.includes(room.slug)}
                onEnter={() => setLocation('/room/' + room.slug)}
              />
            </motion.div>
          ))
        )}
      </div>

      {/* FAB */}
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
              <div style={{ width: '100%', transform: `translateY(-${keyboardOffset}px)`, transition: 'transform 0.25s ease-out' }}>
                <motion.div
                  className="relative w-full bg-card rounded-t-3xl p-6 z-10"
                  style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom, 0px))' }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                >
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-bold text-foreground">{t('createNewRoom')}</h3>
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
                      placeholder={t('roomName')}
                      className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      dir="rtl"
                      autoFocus
                    />
                    <div className="flex items-center justify-between px-1 py-2">
                      <span className="text-sm text-foreground">{t('privateRoom')}</span>
                      <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                    </div>
                    <button
                      onClick={() => { setCreateErr(''); createMut.mutate(); }}
                      disabled={!roomName.trim() || createMut.isPending}
                      className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-base disabled:opacity-40"
                    >
                      {createMut.isPending ? t('creating') : t('createRoom')}
                    </button>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
}
