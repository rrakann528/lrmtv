import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus, Clock, Send, Bell, BellOff,
  Check, X, Loader2, Users, ChevronDown, MessageCircle,
} from 'lucide-react';
import { apiFetch } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { generateColorFromString, cn } from '@/lib/utils';
import { Socket } from 'socket.io-client';

interface Friend {
  id: number;
  status: string;
  friendshipId: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
}

interface RoomUser {
  socketId: string;
  userId?: number;
  username: string;
}

interface PrivateMessage {
  from: string;
  content: string;
  at: number;
  self: boolean;
}

interface FriendsPanelProps {
  userId: number;
  roomSlug: string;
  roomName: string;
  socket: Socket | null;
  roomUsers: RoomUser[];
  myUsername: string;
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

export default function FriendsPanel({ userId, roomSlug, roomName, socket, roomUsers, myUsername }: FriendsPanelProps) {
  const [friends, setFriends]       = useState<Friend[]>([]);
  const [inviting, setInviting]     = useState<number | null>(null);
  const [inviteResults, setInviteResults] = useState<Map<number, 'sent' | 'no_notif'>>(new Map());

  const [openChat, setOpenChat]     = useState<number | null>(null);
  const [messages, setMessages]     = useState<Map<number, PrivateMessage[]>>(new Map());
  const [input, setInput]           = useState('');
  const [unread, setUnread]         = useState<Map<number, number>>(new Map());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { permission, subscribed, subscribe, inviteFriend } = usePush(userId);

  const loadFriends = useCallback(async () => {
    const r = await apiFetch('/friends');
    if (r.ok) {
      const data = await r.json();
      setFriends(Array.isArray(data) ? data : []);
    }
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const respond = async (id: number, action: 'accept' | 'decline') => {
    await apiFetch(`/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    loadFriends();
  };

  const handleInvite = async (friendId: number) => {
    if (permission !== 'granted' && !subscribed) await subscribe();
    setInviting(friendId);
    const result = await inviteFriend(friendId, roomSlug, roomName);
    setInviteResults(prev => new Map(prev).set(friendId, result.sent === 0 ? 'no_notif' : 'sent'));
    setInviting(null);
  };

  // Incoming private messages
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { from: string; fromId: number; content: string }) => {
      const friend = friends.find(f => f.id === data.fromId);
      if (!friend) return;
      const msg: PrivateMessage = { from: data.from, content: data.content, at: Date.now(), self: false };
      setMessages(prev => {
        const updated = new Map(prev);
        updated.set(friend.id, [...(updated.get(friend.id) || []), msg]);
        return updated;
      });
      setUnread(prev => {
        if (openChat === friend.id) return prev;
        const updated = new Map(prev);
        updated.set(friend.id, (updated.get(friend.id) || 0) + 1);
        return updated;
      });
    };
    socket.on('private-message', handler);
    return () => { socket.off('private-message', handler); };
  }, [socket, friends, openChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, openChat]);

  const sendMessage = () => {
    if (!input.trim() || openChat === null || !socket) return;
    const friend = friends.find(f => f.id === openChat);
    if (!friend) return;

    const roomUser = roomUsers.find(u => u.userId === friend.id);
    if (!roomUser) return;

    socket.emit('private-message', { targetSocketId: roomUser.socketId, content: input.trim() });

    const msg: PrivateMessage = { from: myUsername, content: input.trim(), at: Date.now(), self: true };
    setMessages(prev => {
      const updated = new Map(prev);
      updated.set(friend.id, [...(updated.get(friend.id) || []), msg]);
      return updated;
    });
    setInput('');
  };

  const toggleChat = (friendId: number) => {
    setOpenChat(prev => {
      const next = prev === friendId ? null : friendId;
      if (next !== null) {
        setUnread(u => { const m = new Map(u); m.delete(friendId); return m; });
      }
      return next;
    });
    setInput('');
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
          <button onClick={subscribe} className="shrink-0 px-3 py-1 rounded-full bg-primary text-black text-xs font-semibold">
            تفعيل
          </button>
        </div>
      )}

      <div className="flex-grow overflow-y-auto px-3 pb-4 pt-3 flex flex-col gap-2">

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
            {accepted.map(f => {
              const inRoom   = roomUsers.some(u => u.userId === f.id);
              const isOpen   = openChat === f.id;
              const msgs     = messages.get(f.id) || [];
              const badge    = unread.get(f.id) || 0;

              return (
                <div key={f.id} className="mb-2 rounded-xl bg-white/5 overflow-hidden">
                  {/* Friend row */}
                  <div className="flex items-center gap-3 p-3">
                    <Avatar username={f.username} color={f.avatarColor} size={34} />

                    {/* Name — clickable to open chat if in room */}
                    <button
                      className={cn(
                        'flex-grow text-sm font-medium text-start transition',
                        inRoom ? 'text-white hover:text-primary' : 'text-white/60 cursor-default',
                      )}
                      onClick={() => inRoom && toggleChat(f.id)}
                      disabled={!inRoom}
                    >
                      <span className="flex items-center gap-2">
                        {f.username}
                        {inRoom && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" title="في الغرفة" />
                        )}
                        {badge > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-black text-[10px] font-bold px-1">
                            {badge}
                          </span>
                        )}
                      </span>
                    </button>

                    {/* Right side actions */}
                    {inRoom ? (
                      <button
                        onClick={() => toggleChat(f.id)}
                        className={cn(
                          'p-1.5 rounded-lg transition',
                          isOpen ? 'bg-primary/20 text-primary' : 'bg-white/5 text-white/40 hover:text-white',
                        )}
                        title="دردشة خاصة"
                      >
                        {isOpen
                          ? <ChevronDown className="w-4 h-4" />
                          : <MessageCircle className="w-4 h-4" />
                        }
                      </button>
                    ) : (
                      inviteResults.get(f.id) === 'sent'
                        ? <span className="text-green-400 text-xs flex items-center gap-1"><Check className="w-3 h-3" />أُرسلت</span>
                        : inviteResults.get(f.id) === 'no_notif'
                        ? <span className="text-yellow-400 text-xs flex items-center gap-1"><BellOff className="w-3 h-3" />لم يفعّل</span>
                        : <button
                            onClick={() => handleInvite(f.id)}
                            disabled={inviting === f.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition disabled:opacity-50"
                          >
                            {inviting === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            دعوة
                          </button>
                    )}
                  </div>

                  {/* Inline private chat */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-white/5"
                      >
                        {/* Messages */}
                        <div className="max-h-44 overflow-y-auto px-3 pt-2 pb-1 flex flex-col gap-1.5 text-sm">
                          {msgs.length === 0 && (
                            <p className="text-white/20 text-xs text-center py-3">ابدأ المحادثة مع {f.username}</p>
                          )}
                          {msgs.map((m, i) => (
                            <div key={i} className={cn('flex', m.self ? 'justify-end' : 'justify-start')}>
                              <span className={cn(
                                'px-3 py-1.5 rounded-2xl max-w-[80%] text-xs leading-snug break-words',
                                m.self
                                  ? 'bg-primary text-black rounded-br-sm'
                                  : 'bg-white/10 text-white rounded-bl-sm',
                              )}>
                                {m.content}
                              </span>
                            </div>
                          ))}
                          <div ref={chatEndRef} />
                        </div>

                        {/* Input */}
                        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                          <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && sendMessage()}
                            placeholder={`رسالة لـ ${f.username}...`}
                            className="flex-grow rounded-xl py-2 px-3 bg-white/5 border border-white/10 text-white placeholder:text-white/25 text-xs outline-none focus:border-primary/50 transition"
                          />
                          <button
                            onClick={sendMessage}
                            disabled={!input.trim()}
                            className="p-2 rounded-xl bg-primary text-black disabled:opacity-30 transition hover:bg-primary/80"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
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
            <p className="text-white/20 text-xs mt-1">أضف أصدقاء من صفحتك الشخصية</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
