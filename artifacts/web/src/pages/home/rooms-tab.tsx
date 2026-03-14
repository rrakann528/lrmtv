import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users, Play, Search, Globe, Lock, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';

interface PublicRoom {
  id: number;
  slug: string;
  name: string;
  type: string;
  userCount: number;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function fetchRooms(): Promise<PublicRoom[]> {
  return fetch(`${BASE}/api/rooms`, { credentials: 'include' }).then(r => r.json());
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

export function RoomsTab() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { lang } = useI18n();
  const isRtl = lang === 'ar';
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [createErr, setCreateErr] = useState('');
  const keyboardOffset = useKeyboardOffset();

  const { data: rooms = [], isLoading, refetch } = useQuery<PublicRoom[]>({
    queryKey: ['rooms'],
    queryFn: fetchRooms,
    refetchInterval: 15_000,
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
      setLocation(`/room/${room.slug}`);
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const filtered = rooms.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const handleJoinCode = () => {
    const slug = joinCode.replace(/^(.*\/room\/)/, '').trim();
    if (slug) setLocation(`/room/${slug}`);
  };

  return (
    <div className="flex flex-col h-full">
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

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-semibold text-foreground">الغرف العامة ({filtered.length})</span>
        <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Rooms list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
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
              <button
                onClick={() => setLocation(`/room/${room.slug}`)}
                className="flex-shrink-0 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:bg-primary/90"
              >
                دخول
              </button>
            </motion.div>
          ))
        )}
      </div>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setShowCreate(true)}
        className="fixed left-4 z-30 w-14 h-14 bg-primary rounded-full shadow-xl shadow-primary/40 flex items-center justify-center"
        style={{ bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}
      >
        <Plus className="w-7 h-7 text-primary-foreground" />
      </motion.button>

      {/* Create Room Modal — rendered via portal to escape Framer Motion transform context */}
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

                  <div className="flex items-center justify-between px-1 py-2" dir={isRtl ? 'rtl' : 'ltr'}>
                    <span className="text-sm text-foreground">{isRtl ? 'غرفة خاصة' : 'Private room'}</span>
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
    </div>
  );
}
