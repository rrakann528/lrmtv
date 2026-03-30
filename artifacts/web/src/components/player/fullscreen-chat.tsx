import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Smile } from 'lucide-react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { generateColorFromString, cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useI18n } from '@/lib/i18n';

interface ChatMessage {
  id: number;
  username: string;
  content: string;
  type: string;
  createdAt: string;
}

interface FullscreenChatProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  username: string;
  onSend: (content: string) => void;
  lang?: 'en' | 'ar';
}

export default function FullscreenChat({
  isOpen,
  onClose,
  messages,
  username,
  onSend,
  lang = 'en',
}: FullscreenChatProps) {
  const { t } = useI18n();
  const [input,     setInput]     = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) setShowEmoji(false);
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    inputRef.current?.focus();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 60 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="absolute inset-y-0 right-0 z-30 flex flex-col w-72 bg-black/90 backdrop-blur-xl border-l border-white/10 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <span className="text-sm font-semibold text-white">
              {t('liveChat')}
            </span>
            <button
              className="p-1 rounded-full hover:bg-white/10 transition text-white/60 hover:text-white"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Messages ── */}
          <div
            className="flex-grow overflow-y-auto p-3 flex flex-col gap-3"
            ref={scrollRef}
          >
            {messages.map((msg, i) => {
              const isMe     = msg.username === username;
              const isSystem = msg.type === 'system';

              if (isSystem) {
                return (
                  <div key={msg.id || i} className="flex justify-center">
                    <span className="bg-white/10 px-3 py-1 rounded-full text-[10px] text-white/50">
                      {msg.content}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id || i}
                  className={cn(
                    'flex flex-col max-w-[85%]',
                    isMe ? 'self-start items-start' : 'self-end items-end',
                  )}
                >
                  <div className={cn("flex items-end gap-1.5", !isMe && "flex-row-reverse")}>
                    {!isMe && (
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: generateColorFromString(msg.username) }}
                      >
                        {msg.username.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div
                      className={cn(
                        'px-3 py-1.5 rounded-2xl text-[13px] shadow-md overflow-hidden',
                        isMe
                          ? 'bg-primary text-primary-foreground rounded-bl-sm'
                          : 'bg-white/10 text-white rounded-br-sm border border-white/5',
                      )}
                    >
                      {!isMe && (
                        <div className="text-[9px] font-bold text-white/50 mb-0.5">
                          {msg.username}
                        </div>
                      )}
                      <span className="whitespace-pre-wrap break-all">{msg.content}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-white/30 mt-0.5 px-1">
                    {format(new Date(msg.createdAt), 'HH:mm')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── Input area ── */}
          <div className="border-t border-white/10 shrink-0 relative">
            {/* Emoji picker */}
            <AnimatePresence>
              {showEmoji && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute bottom-full right-0 mb-1 z-50"
                >
                  <EmojiPicker
                    theme={Theme.DARK}
                    onEmojiClick={emojiObj => {
                      setInput(prev => prev + emojiObj.emoji);
                      setShowEmoji(false);
                      inputRef.current?.focus();
                    }}
                    width={280}
                    height={320}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-1.5 px-2 py-2">
              <button
                type="button"
                className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition shrink-0"
                onClick={() => setShowEmoji(s => !s)}
              >
                <Smile className="w-4 h-4" />
              </button>

              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder={t('typeMessage')}
                className="flex-grow min-w-0 h-9 px-3 rounded-full bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-primary transition"
              />

              <button
                type="button"
                className={cn(
                  'w-9 h-9 rounded-full shrink-0 flex items-center justify-center transition',
                  input.trim()
                    ? 'bg-primary text-white hover:opacity-90'
                    : 'bg-white/10 text-white/30',
                )}
                onClick={handleSend}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
