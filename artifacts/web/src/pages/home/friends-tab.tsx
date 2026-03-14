import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, UserPlus, MessageCircle, Check, X, Bell, Users, Send, MoreVertical, UserMinus, BellOff, Bell as BellOn } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DmChat } from './dm-chat';
import { UserProfileSheet } from '@/components/user-profile-sheet';
import { io, Socket } from 'socket.io-client';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface FriendUser {
  id: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  status?: 'accepted' | 'pending_sent' | 'pending_received';
  friendshipId?: number;
  muted?: boolean;
}

interface Conversation {
  friendId: number;
  lastMessage: { content: string; createdAt: string; fromMe: boolean } | null;
  unreadCount: number;
}

type SubTab = 'friends' | 'requests' | 'search';

async function fetchFriends(): Promise<FriendUser[]> {
  const r = await apiFetch('/friends');
  return r.json();
}

async function fetchConversations(): Promise<Conversation[]> {
  const r = await apiFetch('/friends/conversations');
  return r.json();
}

async function searchUsers(q: string): Promise<FriendUser[]> {
  if (!q.trim()) return [];
  const r = await fetch(`${BASE}/api/friends/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
  return r.json();
}

function formatLastTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `${diffMins}د`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}س`;
  return d.toLocaleDateString('ar-SA', { day: 'numeric', month: 'numeric' });
}

export function FriendsTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('friends');
  const [searchQ, setSearchQ] = useState('');
  const [dmFriend, setDmFriend] = useState<FriendUser | null>(null);
  const [menuFriend, setMenuFriend] = useState<FriendUser | null>(null);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const { data: friends = [], isLoading } = useQuery<FriendUser[]>({
    queryKey: ['friends'],
    queryFn: fetchFriends,
    enabled: !!user,
  });

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['friends-conversations'],
    queryFn: fetchConversations,
    enabled: !!user,
    refetchInterval: 15000,
  });

  const { data: searchResults = [], isFetching: searching } = useQuery<FriendUser[]>({
    queryKey: ['search-users', searchQ],
    queryFn: () => searchUsers(searchQ),
    enabled: subTab === 'search' && searchQ.length >= 2,
  });

  const convMap = new Map(conversations.map(c => [c.friendId, c]));
  const accepted = friends.filter(f => f.status === 'accepted');
  const pendingReceived = friends.filter(f => f.status === 'pending_received');
  const pendingSent = friends.filter(f => f.status === 'pending_sent');

  // Socket: real-time events
  useEffect(() => {
    if (!user?.id) return;
    const socket = io(`${BASE}`, {
      path: `${BASE}/api/socket.io`,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    socket.emit('join-user-room', { userId: user.id });
    socket.on('friend-request', () => qc.invalidateQueries({ queryKey: ['friends'] }));
    socket.on('dm:receive', () => {
      if (!dmFriend) qc.invalidateQueries({ queryKey: ['friends-conversations'] });
    });
    return () => { socket.disconnect(); };
  }, [user?.id, dmFriend]);

  const requestMut = useMutation({
    mutationFn: (addresseeId: number) => apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ addresseeId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  const respondMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'accepted' | 'rejected' }) =>
      apiFetch(`/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  const removeMut = useMutation({
    mutationFn: (friendshipId: number) => apiFetch(`/friends/${friendshipId}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friends'] }); setMenuFriend(null); },
  });

  const muteMut = useMutation({
    mutationFn: ({ friendId, muted }: { friendId: number; muted: boolean }) =>
      apiFetch(`/friends/${friendId}/mute`, { method: muted ? 'DELETE' : 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friends'] }); setMenuFriend(null); },
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Users className="w-14 h-14 opacity-20" />
        <p className="text-sm">سجّل دخولك لرؤية أصدقائك</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Sub tabs */}
      <div className="flex gap-1 mx-4 mt-4 mb-3 bg-muted/50 rounded-2xl p-1">
        {([
          ['friends',  'أصدقائي'],
          ['requests', `الطلبات${pendingReceived.length > 0 ? ` (${pendingReceived.length})` : ''}`],
          ['search',   'بحث'],
        ] as [SubTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
              subTab === key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search input */}
      {subTab === 'search' && (
        <div className="px-4 mb-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="ابحث باسم المستخدم..."
              className="w-full bg-muted/50 border border-border rounded-xl pl-4 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              dir="rtl"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-4">

        {/* ── Friends list ──────────────────────────────────────────── */}
        {subTab === 'friends' && (
          <>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted/40 rounded-2xl animate-pulse" />
                ))
              : accepted.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Users className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">لا يوجد أصدقاء بعد</p>
                    <button onClick={() => setSubTab('search')} className="mt-3 text-primary text-xs font-semibold">
                      ابحث عن أصدقاء
                    </button>
                  </div>
                )
                : accepted.map(f => (
                    <FriendCard
                      key={f.id}
                      friend={f}
                      conv={convMap.get(f.id) ?? null}
                      onChat={() => setDmFriend(f)}
                      onMenu={() => setMenuFriend(f)}
                      onProfile={() => setProfileUserId(f.id)}
                    />
                  ))
            }
          </>
        )}

        {/* ── Requests ─────────────────────────────────────────────── */}
        {subTab === 'requests' && (
          <>
            {pendingReceived.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground py-1">طلبات واردة</p>
                {pendingReceived.map(f => (
                  <div key={f.id} className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3">
                    <Avatar name={f.displayName || f.username} color={f.avatarColor} url={f.avatarUrl} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{f.displayName || f.username}</p>
                      <p className="text-xs text-muted-foreground">@{f.username}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => f.friendshipId && respondMut.mutate({ id: f.friendshipId, action: 'accepted' })}
                        className="w-9 h-9 bg-green-500/20 rounded-xl flex items-center justify-center"
                      >
                        <Check className="w-4 h-4 text-green-500" />
                      </button>
                      <button
                        onClick={() => f.friendshipId && respondMut.mutate({ id: f.friendshipId, action: 'rejected' })}
                        className="w-9 h-9 bg-destructive/10 rounded-xl flex items-center justify-center"
                      >
                        <X className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {pendingSent.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground py-1 mt-2">طلبات مرسلة</p>
                {pendingSent.map(f => (
                  <div key={f.id} className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3">
                    <Avatar name={f.displayName || f.username} color={f.avatarColor} url={f.avatarUrl} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{f.displayName || f.username}</p>
                      <p className="text-xs text-muted-foreground">@{f.username}</p>
                    </div>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-lg">في الانتظار</span>
                  </div>
                ))}
              </>
            )}
            {pendingReceived.length === 0 && pendingSent.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Bell className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">لا توجد طلبات</p>
              </div>
            )}
          </>
        )}

        {/* ── Search ───────────────────────────────────────────────── */}
        {subTab === 'search' && (
          <>
            {searching && (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!searching && searchQ.length >= 2 && searchResults.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">لا توجد نتائج</div>
            )}
            {searchResults.map(u => {
              const isSelf = u.id === user.id;
              const alreadyFriend = friends.some(f => f.id === u.id);
              return (
                <div key={u.id} className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3">
                  <button onClick={() => setProfileUserId(u.id)} className="flex-shrink-0">
                    <Avatar name={u.displayName || u.username} color={u.avatarColor} url={u.avatarUrl} size={44} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{u.displayName || u.username}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </div>
                  {!isSelf && (
                    alreadyFriend
                      ? <span className="text-xs text-green-500 font-medium">صديق ✓</span>
                      : (
                        <button
                          onClick={() => requestMut.mutate(u.id)}
                          disabled={requestMut.isPending}
                          className="w-9 h-9 bg-primary/20 rounded-xl flex items-center justify-center"
                        >
                          <UserPlus className="w-4 h-4 text-primary" />
                        </button>
                      )
                  )}
                </div>
              );
            })}
            {searchQ.length < 2 && !searching && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">ابحث باسم المستخدم</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* DM Chat overlay */}
      <AnimatePresence>
        {dmFriend && <DmChat friend={dmFriend} onBack={() => setDmFriend(null)} />}
      </AnimatePresence>

      {/* User Profile Sheet */}
      <AnimatePresence>
        {profileUserId && (
          <UserProfileSheet
            userId={profileUserId}
            onClose={() => setProfileUserId(null)}
            onChat={f => { setProfileUserId(null); setDmFriend(f); }}
          />
        )}
      </AnimatePresence>

      {/* Friend Options Bottom Sheet — portal to escape Framer Motion transform context */}
      {createPortal(
      <AnimatePresence>
        {menuFriend && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMenuFriend(null)}
            />
            <motion.div
              className="relative w-full bg-card rounded-t-3xl z-10 overflow-hidden"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-border rounded-full" />
              </div>

              {/* Friend info */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
                <Avatar
                  name={menuFriend.displayName || menuFriend.username}
                  color={menuFriend.avatarColor}
                  url={menuFriend.avatarUrl}
                  size={40}
                />
                <div>
                  <p className="font-semibold text-sm text-foreground">{menuFriend.displayName || menuFriend.username}</p>
                  <p className="text-xs text-muted-foreground">@{menuFriend.username}</p>
                </div>
              </div>

              {/* Options */}
              <div className="py-2">
                {/* Mute / Unmute */}
                <button
                  onClick={() => muteMut.mutate({ friendId: menuFriend.id, muted: !!menuFriend.muted })}
                  disabled={muteMut.isPending}
                  className="w-full flex items-center gap-4 px-5 py-4 text-foreground hover:bg-muted/50 transition-colors"
                >
                  {menuFriend.muted
                    ? <BellOn className="w-5 h-5 text-green-400" />
                    : <BellOff className="w-5 h-5 text-amber-400" />
                  }
                  <span className="text-sm font-medium">
                    {menuFriend.muted ? 'إلغاء الكتم' : 'كتم الإشعارات'}
                  </span>
                  {menuFriend.muted && (
                    <span className="mr-auto text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">مكتوم</span>
                  )}
                </button>

                <div className="h-px bg-border mx-4" />

                {/* Remove friend */}
                <button
                  onClick={() => menuFriend.friendshipId && removeMut.mutate(menuFriend.friendshipId)}
                  disabled={removeMut.isPending}
                  className="w-full flex items-center gap-4 px-5 py-4 text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <UserMinus className="w-5 h-5" />
                  <span className="text-sm font-medium">إزالة صديق</span>
                </button>
              </div>

              {/* Cancel */}
              <div className="px-4 pb-8 pt-1">
                <button
                  onClick={() => setMenuFriend(null)}
                  className="w-full py-3 bg-muted/50 rounded-2xl text-sm font-semibold text-foreground"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
}

function FriendCard({
  friend,
  conv,
  onChat,
  onMenu,
  onProfile,
}: {
  friend: FriendUser;
  conv: Conversation | null;
  onChat: () => void;
  onMenu: () => void;
  onProfile: () => void;
}) {
  const name = friend.displayName || friend.username;
  const unread = conv?.unreadCount ?? 0;
  const lastMsg = conv?.lastMessage ?? null;

  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3">
      <button onClick={onProfile} className="flex-shrink-0">
        <Avatar name={name} color={friend.avatarColor} url={friend.avatarUrl} size={44} />
      </button>

      {/* Info + last message */}
      <button onClick={onProfile} className="flex-1 min-w-0 text-right">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-sm text-foreground truncate">{name}</p>
          {friend.muted && (
            <BellOff className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        {lastMsg ? (
          <p className="text-xs text-muted-foreground truncate">
            {lastMsg.fromMe ? 'أنت: ' : ''}{lastMsg.content}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">@{friend.username}</p>
        )}
      </button>

      {/* Right side */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {lastMsg && (
          <span className="text-[10px] text-muted-foreground">{formatLastTime(lastMsg.createdAt)}</span>
        )}
        <div className="flex items-center gap-1.5">
          {/* Chat button with unread badge */}
          <div className="relative">
            <button
              onClick={onChat}
              className="w-9 h-9 bg-primary/15 rounded-xl flex items-center justify-center"
            >
              <MessageCircle className="w-4 h-4 text-primary" />
            </button>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>

          {/* Options button */}
          <button
            onClick={onMenu}
            className="w-9 h-9 bg-muted/50 rounded-xl flex items-center justify-center"
          >
            <MoreVertical className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
