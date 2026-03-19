import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Smile, MessageSquareOff } from 'lucide-react';
import { useGetRoomMessages } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserProfileSheet } from '@/components/user-profile-sheet';
import { generateColorFromString, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { format } from 'date-fns';
import type { RoomUser } from '@/hooks/use-socket';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

const MAX_MESSAGES = 200;

interface ChatMessage {
  id: number;
  roomId: number;
  username: string;
  content: string;
  type: string;
  createdAt: string;
}

interface ChatPanelProps {
  slug: string;
  emitChatMessage: (content: string, type?: 'message' | 'emoji') => void;
  username: string;
  liveMessages: ChatMessage[];
  chatDisabled?: boolean;
  isAdmin?: boolean;
  isGuest?: boolean;
  users?: RoomUser[];
}

export default function ChatPanel({
  slug, emitChatMessage, username, liveMessages,
  chatDisabled, isAdmin, isGuest, users = [],
}: ChatPanelProps) {
  const { t } = useI18n();
  const inputBlocked = (chatDisabled && !isAdmin) || isGuest;
  const { data: history } = useGetRoomMessages(slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [profileTarget, setProfileTarget] = useState<{ username: string; userId?: number } | null>(null);

  useEffect(() => {
    if (history) {
      const hist = history as ChatMessage[];
      setMessages(hist.slice(-MAX_MESSAGES));
    }
  }, [history]);

  useEffect(() => {
    if (liveMessages.length > 0) {
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMsgs = liveMessages.filter(m => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;
        const next = [...prev, ...newMsgs];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    }
  }, [liveMessages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    emitChatMessage(input.trim());
    setInput('');
  };

  const handleEmojiClick = (emojiObj: { emoji: string }) => {
    setInput(prev => prev + emojiObj.emoji);
    setShowEmoji(false);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const openProfile = (msgUsername: string) => {
    const roomUser = users.find(u => u.username === msgUsername);
    setProfileTarget({ username: msgUsername, userId: roomUser?.userId });
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full bg-black/20"
    >
      {/* Messages area */}
      <div className="flex-grow overflow-y-auto px-3 py-3 flex flex-col gap-1" ref={scrollRef}>
        {messages.map((msg, i) => {
          const isMe = msg.username === username;
          const isSystem = msg.type === 'system';
          const prevMsg = messages[i - 1];
          const nextMsg = messages[i + 1];

          const isFirstInGroup = !prevMsg || prevMsg.type === 'system' || prevMsg.username !== msg.username;
          const isLastInGroup  = !nextMsg || nextMsg.type === 'system'  || nextMsg.username !== msg.username;

          const roomUser = users.find(u => u.username === msg.username);

          if (isSystem) {
            // Admin broadcast messages (from 'النظام') appear as prominent banners
            const isAdminBroadcast = msg.username === 'النظام';
            if (isAdminBroadcast) {
              return (
                <div key={msg.id || i} className="flex justify-center my-3">
                  <div className="w-full bg-cyan-500/15 border border-cyan-500/40 rounded-xl px-4 py-2.5 flex items-start gap-2">
                    <span className="text-cyan-400 mt-0.5 shrink-0">📢</span>
                    <div>
                      <p className="text-[10px] font-bold text-cyan-400 mb-0.5">رسالة من الإدارة</p>
                      <p className="text-xs text-white/90 leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={msg.id || i} className="flex justify-center my-2">
                <span className="bg-white/10 px-3 py-1 rounded-full text-xs text-white/50">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div
              key={msg.id || i}
              className={cn(
                'flex items-end gap-2',
                isMe ? 'flex-row-reverse' : 'flex-row',
                isFirstInGroup ? 'mt-2' : 'mt-0.5',
              )}
            >
              {/* Avatar — only on last message of group, for others */}
              {!isMe && (
                <div className="w-8 shrink-0 flex items-end">
                  {isLastInGroup ? (
                    <button
                      onClick={() => openProfile(msg.username)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-lg active:scale-95 transition-transform shrink-0"
                      style={{ backgroundColor: generateColorFromString(msg.username) }}
                    >
                      {(roomUser?.displayName || msg.username).substring(0, 2).toUpperCase()}
                    </button>
                  ) : (
                    <div className="w-8 h-8" />
                  )}
                </div>
              )}

              {/* Bubble + name */}
              <div className={cn('flex flex-col max-w-[75%]', isMe ? 'items-end' : 'items-start')}>
                {/* Sender name — only on first message of group */}
                {!isMe && isFirstInGroup && (
                  <button
                    onClick={() => openProfile(msg.username)}
                    className="text-[11px] font-bold mb-1 px-1 active:opacity-70 transition-opacity"
                    style={{ color: generateColorFromString(msg.username) }}
                  >
                    {roomUser?.displayName || msg.username}
                  </button>
                )}

                {/* Message bubble */}
                <div
                  className={cn(
                    'px-3 py-2 text-sm break-words',
                    isMe
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white/10 text-white border border-white/8',
                    isMe ? (
                      isFirstInGroup && isLastInGroup ? 'rounded-2xl rounded-ee-sm'
                      : isFirstInGroup                ? 'rounded-2xl rounded-ee-sm rounded-es-2xl'
                      : isLastInGroup                 ? 'rounded-2xl rounded-es-2xl rounded-ss-2xl'
                      :                                 'rounded-2xl rounded-ss-2xl rounded-es-2xl'
                    ) : (
                      isFirstInGroup && isLastInGroup ? 'rounded-2xl rounded-ss-sm'
                      : isFirstInGroup                ? 'rounded-2xl rounded-ss-sm rounded-se-2xl'
                      : isLastInGroup                 ? 'rounded-2xl rounded-se-2xl rounded-ee-2xl'
                      :                                 'rounded-2xl rounded-se-2xl rounded-ee-2xl'
                    ),
                  )}
                >
                  {msg.content}
                </div>

                {/* Timestamp — only on last message of group */}
                {isLastInGroup && (
                  <span className="text-[10px] text-white/30 mt-1 px-1">
                    {format(new Date(msg.createdAt), 'HH:mm')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chat disabled banner */}
      {chatDisabled && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-t ${
          isAdmin
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <MessageSquareOff className="w-3.5 h-3.5 shrink-0" />
          {isAdmin ? t('chatDisabledHostMsg') : t('chatDisabledByHostMsg')}
        </div>
      )}

      {/* Input area */}
      <div className="p-3 bg-black/40 border-t border-white/10 relative">
        {showEmoji && !inputBlocked && (
          <div className="absolute bottom-full right-4 mb-2 z-50">
            <Suspense fallback={
              <div className="w-[300px] h-[400px] rounded-xl bg-zinc-900 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            }>
              <EmojiPicker theme={"dark" as any} onEmojiClick={handleEmojiClick} />
            </Suspense>
          </div>
        )}

        <form
          onSubmit={inputBlocked ? e => e.preventDefault() : handleSubmit}
          className="flex gap-2 relative"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={inputBlocked}
            className="absolute start-1 top-1 text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => !inputBlocked && setShowEmoji(!showEmoji)}
          >
            <Smile className="w-5 h-5" />
          </Button>

          <Input
            value={input}
            onChange={e => !inputBlocked && setInput(e.target.value)}
            disabled={inputBlocked}
            className="ps-10 rounded-full bg-white/5 border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            placeholder={
              isGuest
                ? t('signInToChat')
                : inputBlocked
                ? t('chatDisabledDots')
                : t('typeMessage')
            }
          />

          <Button
            type="submit"
            size="icon"
            disabled={inputBlocked}
            className="rounded-full shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>

      {/* User Profile Sheet */}
      <AnimatePresence>
        {profileTarget && (
          <UserProfileSheet
            username={profileTarget.username}
            userId={profileTarget.userId}
            onClose={() => setProfileTarget(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
