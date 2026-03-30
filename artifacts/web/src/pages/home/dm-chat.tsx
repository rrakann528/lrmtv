import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Send, Check, CheckCheck } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useI18n } from '@/lib/i18n';
import { MessageContextMenu } from '@/components/chat/message-context-menu';
import { ReplyPreview } from '@/components/chat/reply-preview';
import { QuotedMessage } from '@/components/chat/quoted-message';
import { LinkifiedText } from '@/components/chat/linkified-text';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface DmMessage {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
  replyToId?: number | null;
  replyToContent?: string | null;
  replyToSenderName?: string | null;
  isEdited?: boolean;
  editedAt?: string | null;
}

interface Reaction { emoji: string; userId: number; }

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
  const [friendLastReadAt, setFriendLastReadAt] = useState<string | null>(null);
  const [friendTyping, setFriendTyping] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [reactions, setReactions] = useState<Record<number, Reaction[]>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const [replyTarget, setReplyTarget] = useState<{ id: number; senderName: string; content: string } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friendTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingEmittedRef = useRef(false);

  const { data: historyData, isLoading } = useQuery<{ messages: DmMessage[]; friendLastReadAt: string | null }>({
    queryKey: ['dm', friend.id],
    queryFn: () => apiFetch(`/dm/${friend.id}`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) return { messages: d, friendLastReadAt: null };
      return { messages: Array.isArray(d.messages) ? d.messages : [], friendLastReadAt: d.friendLastReadAt || null };
    }),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!historyData) return;
    const msgs = historyData.messages;
    setFriendLastReadAt(historyData.friendLastReadAt);
    msgs.forEach(m => seenIds.current.add(m.id));
    setMessages(prev => {
      const optimistic = prev.filter(m => m.id < 0);
      return [...msgs, ...optimistic];
    });
  }, [historyData]);

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
      if (!document.hidden) {
        socket.emit('dm:viewing', { friendId: friend.id, active: true });
      }
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

    socket.on('dm:deleted', (data: { messageId: number }) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId));
    });

    socket.on('dm:edited', (updated: DmMessage) => {
      setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, content: updated.content, isEdited: true } : m));
    });

    socket.on('dm:reaction', (data: { messageId: number; reactions: Reaction[] }) => {
      setReactions(prev => ({ ...prev, [data.messageId]: data.reactions }));
    });

    socket.on('dm:typing', (data: { fromUserId: number; isTyping: boolean }) => {
      if (data.fromUserId !== friend.id) return;
      setFriendTyping(data.isTyping);
      if (data.isTyping) {
        if (friendTypingTimeoutRef.current) clearTimeout(friendTypingTimeoutRef.current);
        friendTypingTimeoutRef.current = setTimeout(() => setFriendTyping(false), 3500);
      }
    });

    const onVisibilityChange = () => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('dm:viewing', { friendId: friend.id, active: !document.hidden });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      socket.emit('dm:viewing', { friendId: friend.id, active: false });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [friend.id, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (editingMsgId !== null) editInputRef.current?.focus();
  }, [editingMsgId]);

  const stopTyping = useCallback(() => {
    if (isTypingEmittedRef.current) {
      socketRef.current?.emit('dm:typing', { toUserId: friend.id, isTyping: false });
      isTypingEmittedRef.current = false;
    }
  }, [friend.id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (!socketRef.current) return;
    if (!isTypingEmittedRef.current) {
      socketRef.current.emit('dm:typing', { toUserId: friend.id, isTyping: true });
      isTypingEmittedRef.current = true;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, 2000);
  };

  const getSenderName = (senderId: number) => {
    if (senderId === user?.id) return user?.displayName || user?.username || '';
    return friend.displayName || friend.username;
  };

  const send = async () => {
    const content = text.trim();
    if (!content || sending || !user) return;
    stopTyping();
    setSending(true);
    setText('');
    const currentReply = replyTarget;
    setReplyTarget(null);

    const tempId = -Date.now();
    const optimistic: DmMessage = {
      id: tempId,
      senderId: user.id,
      receiverId: friend.id,
      content,
      createdAt: new Date().toISOString(),
      replyToId: currentReply?.id,
      replyToContent: currentReply?.content,
      replyToSenderName: currentReply?.senderName,
    };
    seenIds.current.add(tempId);
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await apiFetch(`/dm/${friend.id}`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          replyToId: currentReply?.id,
          replyToContent: currentReply?.content?.slice(0, 200),
          replyToSenderName: currentReply?.senderName,
        }),
      });
      if (res.ok) {
        const saved: DmMessage = await res.json();
        seenIds.current.add(saved.id);
        setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
      } else {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setText(content);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(content);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (msgId: number) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
    try {
      await apiFetch(`/dm/${msgId}`, { method: 'DELETE' });
    } catch {}
  };

  const handleEdit = async (msgId: number) => {
    const newContent = editText.trim();
    if (!newContent) return;
    setEditingMsgId(null);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: newContent, isEdited: true } : m));
    try {
      await apiFetch(`/dm/${msgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: newContent }),
      });
    } catch {}
  };

  const startEdit = (msg: DmMessage) => {
    setEditingMsgId(msg.id);
    setEditText(msg.content);
  };

  const handleReply = (msg: DmMessage) => {
    setReplyTarget({
      id: msg.id,
      senderName: getSenderName(msg.senderId),
      content: msg.content,
    });
    inputRef.current?.focus();
  };

  const handleReact = async (msgId: number, emoji: string) => {
    try {
      const res = await apiFetch(`/dm/${msgId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        setReactions(prev => ({ ...prev, [msgId]: data.reactions }));
      }
    } catch {}
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

  const getReactionSummary = (msgId: number): Record<string, number> => {
    const reacts = reactions[msgId] || [];
    return reacts.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {} as Record<string, number>);
  };

  return (
    <motion.div
      className="fixed inset-0 bg-background z-[200] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', ease: [0.25, 0.46, 0.45, 0.94], duration: 0.22 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/95 backdrop-blur-sm">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted/50 active:scale-95 transition-transform">
          <BackArrow className="w-5 h-5" />
        </button>
        <Avatar name={displayName} color={friend.avatarColor} url={friend.avatarUrl} size={40} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{displayName}</p>
          {friendTyping ? (
            <p className="text-xs text-primary animate-pulse">{t('typing') || 'يكتب...'}</p>
          ) : (
            <p className="text-xs text-muted-foreground">@{friend.username}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Avatar name={displayName} color={friend.avatarColor} url={friend.avatarUrl} size={64} />
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground/60">{t('startConversation') || 'ابدأ المحادثة'}</p>
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
                  const isRead = !!(friendLastReadAt && new Date(friendLastReadAt) >= new Date(msg.createdAt));
                  const reactionSummary = getReactionSummary(msg.id);
                  const hasReactions = Object.keys(reactionSummary).length > 0;

                  return (
                    <div key={msg.id}>
                      <MessageContextMenu
                        messageText={msg.content}
                        isOwnMessage={isMe}
                        onReply={() => handleReply(msg)}
                        onDelete={isMe && !isOptimistic ? () => handleDelete(msg.id) : undefined}
                        onEdit={isMe && !isOptimistic ? () => startEdit(msg) : undefined}
                        onReact={!isOptimistic ? (emoji) => handleReact(msg.id, emoji) : undefined}
                      >
                        <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] min-w-0 overflow-hidden px-3.5 py-2 rounded-2xl text-sm ${
                            isMe
                              ? `bg-primary text-primary-foreground ${dir === 'rtl' ? 'rounded-tl-sm' : 'rounded-tr-sm'} ${isOptimistic ? 'opacity-60' : ''}`
                              : `bg-muted text-foreground ${dir === 'rtl' ? 'rounded-tr-sm' : 'rounded-tl-sm'}`
                          }`}>
                            {msg.replyToId && msg.replyToSenderName && (
                              <QuotedMessage
                                senderName={msg.replyToSenderName}
                                text={msg.replyToContent || ''}
                              />
                            )}

                            {editingMsgId === msg.id ? (
                              <form onSubmit={e => { e.preventDefault(); handleEdit(msg.id); }}>
                                <input
                                  ref={editInputRef}
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  onKeyDown={e => e.key === 'Escape' && setEditingMsgId(null)}
                                  className={`w-full bg-white/20 rounded px-2 py-0.5 text-sm ${isMe ? 'text-primary-foreground' : 'text-foreground'} outline-none`}
                                />
                                <div className="flex gap-2 mt-1 justify-end">
                                  <button type="button" onClick={() => setEditingMsgId(null)} className="text-[10px] opacity-60">✗</button>
                                  <button type="submit" className="text-[10px] opacity-80">✓</button>
                                </div>
                              </form>
                            ) : (
                              <LinkifiedText text={msg.content} />
                            )}

                            <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                              {msg.isEdited && (
                                <span className={`text-[9px] ${isMe ? 'text-primary-foreground/40' : 'text-muted-foreground/50'}`}>
                                  {t('edited') || 'تم التعديل'}
                                </span>
                              )}
                              <p className={`text-[10px] ${isMe ? 'text-primary-foreground/50' : 'text-muted-foreground'}`}>
                                {isOptimistic ? '...' : formatTime(msg.createdAt)}
                              </p>
                              {isMe && !isOptimistic && (
                                isRead
                                  ? <CheckCheck className="w-3 h-3 text-primary-foreground/70" />
                                  : <Check className="w-3 h-3 text-primary-foreground/40" />
                              )}
                            </div>
                          </div>
                        </div>
                      </MessageContextMenu>

                      {hasReactions && (
                        <div className={`flex gap-0.5 mt-0.5 flex-wrap ${isMe ? 'justify-end pe-1' : 'justify-start ps-1'}`}>
                          {Object.entries(reactionSummary).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              onClick={() => handleReact(msg.id, emoji)}
                              className="text-xs bg-muted rounded-full px-1.5 py-0.5 flex items-center gap-0.5 border border-border hover:border-primary/40 transition-colors"
                            >
                              {emoji}{count > 1 && <span className="text-[10px] text-muted-foreground">{count}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {replyTarget && (
        <ReplyPreview
          senderName={replyTarget.senderName}
          text={replyTarget.content}
          onCancel={() => setReplyTarget(null)}
        />
      )}

      <div className="p-3 border-t border-border bg-card/95 backdrop-blur-sm" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={handleInputChange}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            onBlur={stopTyping}
            placeholder={t('typeMessage') || 'اكتب رسالة...'}
            className="flex-1 bg-muted/50 border border-border rounded-2xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ fontSize: '16px' }}
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
