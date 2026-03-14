import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus, UserCheck, Clock, Search, Send, Bell, BellOff,
  Check, X, Loader2, Users,
} from 'lucide-react';
import { apiFetch } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { generateColorFromString, cn } from '@/lib/utils';

interface Friend {
  id: number;
  status: string;
  friendshipId: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
}

interface SearchUser {
  id: number;
  username: string;
  avatarColor: string;
}

interface FriendsPanelProps {
  userId: number;
  roomSlug: string;
  roomName: string;
}

function Avatar({ username, color, size = 36 }: { username: string; color?: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35, backgroundColor: color || generateColorFromString(username) }}
    >
      {username.substring(0, 2).toUpperCase()}
    </div>
  );
}

export default function FriendsPanel({ userId, roomSlug, roomName }: FriendsPanelProps) {
  const [friends, setFriends]       = useState<Friend[]>([]);
  const [search, setSearch]         = useState('');
  const [results, setResults]       = useState<SearchUser[]>([]);
  const [searching, setSearching]   = useState(false);
  const [inviting, setInviting]     = useState<number | null>(null);
  const [inviteResults, setInviteResults] = useState<Map<number, 'sent' | 'no_notif'>>(new Map());
  const [tab, setTab]               = useState<'friends' | 'search'>('friends');

  const { permission, subscribed, subscribe, inviteFriend } = usePush(userId);

  const loadFriends = useCallback(async () => {
    const r = await apiFetch('/friends');
    if (r.ok) setFriends(await r.json());
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  // Debounced search
  useEffect(() => {
    if (search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await apiFetch(`/friends/search?q=${encodeURIComponent(search)}`);
      if (r.ok) setResults(await r.json());
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const sendRequest = async (addresseeId: number) => {
    await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ addresseeId }) });
    loadFriends();
    setResults(prev => prev.filter(u => u.id !== addresseeId));
  };

  const respond = async (id: number, action: 'accept' | 'decline') => {
    await apiFetch(`/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    loadFriends();
  };

  const handleInvite = async (friendId: number) => {
    if (permission !== 'granted' && !subscribed) {
      await subscribe();
    }
    setInviting(friendId);
    const result = await inviteFriend(friendId, roomSlug, roomName);
    setInviteResults(prev => new Map(prev).set(friendId, result.noSubscription ? 'no_notif' : 'sent'));
    setInviting(null);
  };

  const accepted  = friends.filter(f => f.status === 'accepted');
  const pending   = friends.filter(f => f.status === 'pending_received');
  const sent      = friends.filter(f => f.status === 'pending_sent');

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full"
    >
      {/* Push permission banner */}
      {permission !== 'granted' && (
        <div className="shrink-0 mx-3 mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center gap-3">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <p className="text-white/70 text-xs flex-grow">فعّل الإشعارات لاستقبال دعوات الأصدقاء</p>
          <button
            onClick={subscribe}
            className="shrink-0 px-3 py-1 rounded-full bg-primary text-black text-xs font-semibold"
          >
            تفعيل
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-3 shrink-0">
        <button
          onClick={() => setTab('friends')}
          className={cn('flex-1 py-2 rounded-xl text-xs font-medium transition', tab === 'friends' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white')}
        >
          أصدقائي {accepted.length > 0 && `(${accepted.length})`}
        </button>
        <button
          onClick={() => setTab('search')}
          className={cn('flex-1 py-2 rounded-xl text-xs font-medium transition', tab === 'search' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white')}
        >
          إضافة صديق
        </button>
      </div>

      <div className="flex-grow overflow-y-auto px-3 pb-4 flex flex-col gap-3">

        {/* ── Friends tab ── */}
        {tab === 'friends' && (
          <>
            {/* Pending requests */}
            {pending.length > 0 && (
              <div>
                <p className="text-white/40 text-[11px] font-medium mb-2 px-1">طلبات الصداقة</p>
                {pending.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2">
                    <Avatar username={f.username} color={f.avatarColor} />
                    <span className="flex-grow text-white text-sm font-medium">{f.username}</span>
                    <button onClick={() => respond(f.friendshipId, 'accept')} className="p-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => respond(f.friendshipId, 'decline')} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Accepted friends */}
            {accepted.length > 0 && (
              <div>
                <p className="text-white/40 text-[11px] font-medium mb-2 px-1">الأصدقاء</p>
                {accepted.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2">
                    <Avatar username={f.username} color={f.avatarColor} />
                    <span className="flex-grow text-white text-sm font-medium">{f.username}</span>
                    {inviteResults.get(f.id) === 'sent'
                      ? <span className="text-green-400 text-xs flex items-center gap-1"><Check className="w-3 h-3" />أُرسلت</span>
                      : inviteResults.get(f.id) === 'no_notif'
                      ? <span className="text-yellow-400 text-xs flex items-center gap-1"><BellOff className="w-3 h-3" />لم يفعّل الإشعارات</span>
                      : <button
                          onClick={() => handleInvite(f.id)}
                          disabled={inviting === f.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition disabled:opacity-50"
                        >
                          {inviting === f.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Send className="w-3 h-3" />
                          }
                          دعوة
                        </button>
                    }
                  </div>
                ))}
              </div>
            )}

            {/* Sent requests */}
            {sent.length > 0 && (
              <div>
                <p className="text-white/40 text-[11px] font-medium mb-2 px-1">طلبات مُرسلة</p>
                {sent.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2 opacity-60">
                    <Avatar username={f.username} color={f.avatarColor} />
                    <span className="flex-grow text-white text-sm">{f.username}</span>
                    <Clock className="w-4 h-4 text-white/30" />
                  </div>
                ))}
              </div>
            )}

            {accepted.length === 0 && pending.length === 0 && sent.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-grow py-12 text-center">
                <Users className="w-10 h-10 text-white/10 mb-3" />
                <p className="text-white/30 text-sm">لا يوجد أصدقاء بعد</p>
                <button onClick={() => setTab('search')} className="mt-3 text-primary text-xs hover:underline">
                  ابحث عن أصدقاء
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Search tab ── */}
        {tab === 'search' && (
          <>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث باسم المستخدم..."
                className="w-full rounded-xl py-2.5 ps-9 pe-4 bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm outline-none focus:border-primary/50 transition"
              />
              {searching && <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 animate-spin" />}
            </div>

            <AnimatePresence>
              {results.map(u => {
                const alreadyFriend = friends.some(f => f.id === u.id && f.status === 'accepted');
                const alreadySent   = friends.some(f => f.id === u.id && f.status === 'pending_sent');
                return (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/5"
                  >
                    <Avatar username={u.username} color={u.avatarColor} />
                    <span className="flex-grow text-white text-sm font-medium">{u.username}</span>
                    {alreadyFriend
                      ? <span className="text-white/30 text-xs flex items-center gap-1"><UserCheck className="w-3 h-3" />صديق</span>
                      : alreadySent
                      ? <span className="text-white/30 text-xs flex items-center gap-1"><Clock className="w-3 h-3" />مُرسل</span>
                      : <button
                          onClick={() => sendRequest(u.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition"
                        >
                          <UserPlus className="w-3 h-3" /> إضافة
                        </button>
                    }
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {search.length >= 2 && !searching && results.length === 0 && (
              <p className="text-center text-white/30 text-sm py-8">لا توجد نتائج</p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
