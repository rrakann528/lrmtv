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
import { MessageContextMenu } from '@/components/chat/message-context-menu';
import { ReplyPreview } from '@/components/chat/reply-preview';
import { QuotedMessage } from '@/components/chat/quoted-message';
import { LinkifiedText } from '@/components/chat/linkified-text';
import { useSettings } from '@/lib/settings';

const chatSoundUrl = 'data:audio/wav;base64,UklGRl4AAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YToAAAA/P0A+Pzw9Oj04OjY3NDUyMzAxLi8sLSorKCkmJyQlIiMgIR4fHB0aGxgZFhcUFRITEBEODw==';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

const MAX_MESSAGES = 200;

interface ChatMessage {
  id: number;
  roomId: number;
  username: string;
  content: string;
  type: string;
  createdAt: string;
  replyToId?: number;
  replyToUsername?: string;
  replyToContent?: string;
}

interface ChatPanelProps {
  slug: string;
  emitChatMessage: (content: string, type?: 'message' | 'emoji', replyTo?: { id: number; username: string; content: string }) => void;
  emitDeleteMessage: (messageId: number) => void;
  username: string;
  liveMessages: ChatMessage[];
  chatDisabled?: boolean;
  isAdmin?: boolean;
  isGuest?: boolean;
  users?: RoomUser[];
}

export default function ChatPanel({
  slug, emitChatMessage, emitDeleteMessage, username, liveMessages,
  chatDisabled, isAdmin, isGuest, users = [],
}: ChatPanelProps) {
  const { t } = useI18n();
  const [settings] = useSettings();
  const inputBlocked = (chatDisabled && !isAdmin) || isGuest;
  const { data: history } = useGetRoomMessages(slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [profileTarget, setProfileTarget] = useState<{ username: string; userId?: number } | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ id: number; username: string; content: string } | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);

  const fontSizeClass = settings.chatFontSize === 'small' ? 'text-xs' : settings.chatFontSize === 'large' ? 'text-base' : 'text-sm';

  const playNotifSound = useCallback(() => {
    if (!settings.chatSounds) return;
    try {
      if (!chatAudioRef.current) chatAudioRef.current = new Audio(chatSoundUrl);
      chatAudioRef.current.currentTime = 0;
      chatAudioRef.current.volume = 0.3;
      chatAudioRef.current.play().catch(() => {});
    } catch {}
  }, [settings.chatSounds]);

  useEffect(() => {
    if (history) {
      const hist = history as ChatMessage[];
      setMessages(hist.slice(-MAX_MESSAGES));
    }
  }, [history]);

  const prevLiveRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    const prev = prevLiveRef.current;
    prevLiveRef.current = liveMessages;

    if (liveMessages.length > prev.length) {
      const existingIds = new Set(messages.map(m => m.id));
      const newMsgs = liveMessages.filter(m => !existingIds.has(m.id));
      if (newMsgs.length > 0) {
        const hasOtherMsg = newMsgs.some(m => m.username !== username && m.type !== 'system');
        if (hasOtherMsg) playNotifSound();
        setMessages(p => {
          const next = [...p, ...newMsgs];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
      }
    } else if (liveMessages.length < prev.length) {
      const liveIds = new Set(liveMessages.map(m => m.id));
      const deletedIds = prev.filter(m => !liveIds.has(m.id)).map(m => m.id);
      if (deletedIds.length > 0) {
        const deletedSet = new Set(deletedIds);
        setMessages(p => p.filter(m => !deletedSet.has(m.id)));
      }
    }
  }, [liveMessages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    emitChatMessage(input.trim(), 'message', replyTarget || undefined);
    setInput('');
    setReplyTarget(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && settings.enterSends) {
      handleSubmit(e);
    }
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

  const handleReply = (msg: ChatMessage) => {
    setReplyTarget({ id: msg.id, username: msg.username, content: msg.content });
    inputRef.current?.focus();
  };

  const handleDelete = (msgId: number) => {
    emitDeleteMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full bg-black/20"
    >
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
            if (!settings.showJoinLeave) return null;
            return (
              <div key={msg.id || i} className="flex justify-center my-2">
                <span className="bg-white/10 px-3 py-1 rounded-full text-xs text-white/50">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <MessageContextMenu
              key={msg.id || i}
              messageText={msg.content}
              isOwnMessage={isMe || !!isAdmin}
              onReply={() => handleReply(msg)}
              onDelete={() => handleDelete(msg.id)}
            >
              <div
                className={cn(
                  'flex items-end gap-2',
                  isMe ? 'flex-row-reverse' : 'flex-row',
                  isFirstInGroup ? (settings.compactMode ? 'mt-1' : 'mt-2') : 'mt-0.5',
                )}
              >
                {!isMe && !settings.compactMode && (
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

                <div className={cn('flex flex-col max-w-[75%]', isMe ? 'items-end' : 'items-start')}>
                  {!isMe && isFirstInGroup && (
                    <button
                      onClick={() => openProfile(msg.username)}
                      className={cn(
                        'font-bold px-1 active:opacity-70 transition-opacity',
                        settings.compactMode ? 'text-[10px] mb-0.5' : 'text-[11px] mb-1',
                      )}
                      style={{ color: generateColorFromString(msg.username) }}
                    >
                      {roomUser?.displayName || msg.username}
                    </button>
                  )}

                  <div
                    className={cn(
                      settings.compactMode ? 'px-2.5 py-1.5' : 'px-3 py-2',
                      fontSizeClass,
                      'break-words',
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
                    {msg.replyToId && msg.replyToUsername && (
                      <QuotedMessage
                        senderName={msg.replyToUsername}
                        text={msg.replyToContent || ''}
                      />
                    )}
                    <LinkifiedText text={msg.content} />
                  </div>

                  {isLastInGroup && settings.showTimestamps && (
                    <span className="text-[10px] text-white/30 mt-1 px-1">
                      {format(new Date(msg.createdAt), 'HH:mm')}
                    </span>
                  )}
                </div>
              </div>
            </MessageContextMenu>
          );
        })}
      </div>

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

      {replyTarget && (
        <ReplyPreview
          senderName={replyTarget.username}
          text={replyTarget.content}
          onCancel={() => setReplyTarget(null)}
        />
      )}

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
            ref={inputRef}
            value={input}
            onChange={e => !inputBlocked && setInput(e.target.value)}
            onKeyDown={!inputBlocked ? handleKeyDown : undefined}
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
