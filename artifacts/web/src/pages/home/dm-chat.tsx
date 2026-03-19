import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useI18n } from '@/lib/i18n';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface DmMessage {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
}

interface Friend {
  id: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
}

interface Props {
  friend: Friend;
  onBack: () => void;
}

export function DmChat({ friend, onBack }: Props) {
  const { user } = useAuth();
  const { t, dir, lang } = useI18n();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const seenIds = useRef<Set<number>>(new Set());

  const { data: history = [], isLoading } = useQuery<DmMessage[]>({
    queryKey: ['dm', friend.id],
    queryFn: () => apiFetch(`/dm/${friend.id}`).then(r => r.json()),
  });

  useEffect(() => {
    setMessages(history);
    history.forEach(m => seenIds.current.add(m.id));
  }, [history]);

  useEffect(() => {
    apiFetch(`/dm/${friend.id}/read`, { method: 'POST' }).then(() => {
      qc.invalidateQueries({ queryKey: ['friends-conversations'] });
      qc.invalidateQueries({ queryKey: ['friends-badge'] });
    }).catch(() => {});
  }, [friend.id, messages.length]);

  useEffect(() => {
    const token = localStorage.getItem('lrmtv_auth_token') || '';
    const socket = io(BASE || '/', {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-user-room', { userId: user?.id });
    });

    socket.on('dm:receive', (msg: DmMessage) => {
      const inConversation =
        (msg.senderId === friend.id && msg.receiverId === user?.id) ||
        (msg.senderId === user?.id && msg.receiverId === friend.id);
      if (!inConversation) return;
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages(prev => [...prev, msg]);
      apiFetch(`/dm/${friend.id}/read`, { method: 'POST' }).then(() => {
        qc.invalidateQueries({ queryKey: ['friends-conversations'] });
        qc.invalidateQueries({ queryKey: ['friends-badge'] });
      }).catch(() => {});
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [friend.id, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending || !user) return;
    setSending(true);
    setText('');
    const tempId = -Date.now();
    const optimistic: DmMessage = {
      id: tempId,
      senderId: user.id,
      receiverId: friend.id,
      content: t,
      createdAt: new Date().toISOString(),
    };
    seenIds.current.add(tempId);
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await apiFetch(`/dm/${friend.id}`, {
        method: 'POST',
        body: JSON.stringify({ content: t }),
      });
      if (res.ok) {
        const saved: DmMessage = await res.json();
        seenIds.current.add(saved.id);
        setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
      } else {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setText(t);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(t);
    } finally {
      setSending(false);
    }
  };

  const locale = lang === 'ar' ? 'ar-SA' : lang === 'fr' ? 'fr-FR' : lang === 'tr' ? 'tr-TR' : lang === 'es' ? 'es-ES' : lang === 'id' ? 'id-ID' : 'en-US';
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateSep = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return t('today') || 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t('yesterday') || 'Yesterday';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  const displayName = friend.displayName || friend.username;
  const BackArrow = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const groupedMessages: { date: string; msgs: DmMessage[] }[] = [];
  let lastDate = '';
  for (const msg of messages) {
    const dateStr = new Date(msg.createdAt).toDateString();
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      groupedMessages.push({ date: msg.createdAt, msgs: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].msgs.push(msg);
    }
  }

  return (
    <motion.div
      className="absolute inset-0 bg-background z-40 flex flex-col"
      initial={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      animate={{ x: 0 }}
      exit={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 400 }}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/95 backdrop-blur-sm">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted/50 active:scale-95 transition-transform">
          <BackArrow className="w-5 h-5" />
        </button>
        <Avatar name={displayName} color={friend.avatarColor} url={friend.avatarUrl} size={40} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground">@{friend.username}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Avatar name={displayName} color={friend.avatarColor} url={friend.avatarUrl} size={64} />
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground/60">{t('startConversation') || 'Start a conversation'}</p>
          </div>
        ) : (
          groupedMessages.map((group, gi) => (
            <div key={gi}>
              <div className="flex justify-center my-3">
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                  {formatDateSep(group.date)}
                </span>
              </div>
              <div className="space-y-1.5">
                {group.msgs.map(msg => {
                  const isMe = msg.senderId === user?.id;
                  const isOptimistic = msg.id < 0;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm ${
                        isMe
                          ? `bg-primary text-primary-foreground ${dir === 'rtl' ? 'rounded-tl-sm' : 'rounded-tr-sm'} ${isOptimistic ? 'opacity-60' : ''}`
                          : `bg-muted text-foreground ${dir === 'rtl' ? 'rounded-tr-sm' : 'rounded-tl-sm'}`
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-0.5 ${isMe ? 'text-primary-foreground/50' : 'text-muted-foreground'} ${isMe ? 'text-end' : 'text-start'}`}>
                          {isOptimistic ? '...' : formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={t('typeMessage') || 'Type a message...'}
            className="flex-1 bg-muted/50 border border-border rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="w-10 h-10 bg-primary rounded-full flex items-center justify-center disabled:opacity-40 flex-shrink-0 active:scale-95 transition-transform"
          >
            <Send className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
