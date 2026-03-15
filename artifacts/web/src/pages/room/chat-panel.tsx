import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Send, Smile, MessageSquareOff } from 'lucide-react';
import { useGetRoomMessages } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { generateColorFromString, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { format } from 'date-fns';

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
}

export default function ChatPanel({ slug, emitChatMessage, username, liveMessages, chatDisabled, isAdmin }: ChatPanelProps) {
  const { t, lang } = useI18n();
  const (lang === 'ar') = lang === 'ar';
  const inputBlocked = chatDisabled && !isAdmin;
  const { data: history } = useGetRoomMessages(slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      // Use scrollIntoView on a sentinel instead of setting scrollTop
      // — faster and triggers native smooth scrolling
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full bg-black/20"
    >
      <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-4" ref={scrollRef}>
        {messages.map((msg, i) => {
          const isMe = msg.username === username;
          const isSystem = msg.type === 'system';
          
          if (isSystem) {
            return (
              <div key={msg.id || i} className="flex justify-center">
                <span className="bg-white/10 px-3 py-1 rounded-full text-xs text-white/60">
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id || i} className={cn("flex flex-col max-w-[85%]", isMe ? "self-end items-end" : "self-start items-start")}>
              <div className="flex items-end gap-2">
                {!isMe && (
                  <div 
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-lg"
                    style={{ backgroundColor: generateColorFromString(msg.username) }}
                  >
                    {msg.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                
                <div className={cn(
                  "px-4 py-2 rounded-2xl text-sm shadow-md",
                  isMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-white/10 text-white rounded-bl-sm border border-white/5"
                )}>
                  {!isMe && <div className="text-[10px] font-bold text-white/50 mb-1">{msg.username}</div>}
                  {msg.content}
                </div>
              </div>
              <span className="text-[10px] text-white/40 mt-1 px-1">
                {format(new Date(msg.createdAt), 'HH:mm')}
              </span>
            </div>
          );
        })}
      </div>

      {/* Chat disabled banner */}
      {chatDisabled && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-t ${isAdmin ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          <MessageSquareOff className="w-3.5 h-3.5 shrink-0" />
          {isAdmin
            ? ((lang === 'ar') ? 'الدردشة معطلة — أنت المضيف ويمكنك الكتابة' : 'Chat is disabled — you can still write as host')
            : ((lang === 'ar') ? 'الدردشة معطّلة من المضيف' : 'Chat has been disabled by the host')}
        </div>
      )}

      <div className="p-3 bg-black/40 border-t border-white/10 relative">
        {showEmoji && !inputBlocked && (
          <div className="absolute bottom-full right-4 mb-2 z-50">
            <Suspense fallback={<div className="w-[300px] h-[400px] rounded-xl bg-zinc-900 flex items-center justify-center"><div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>}>
              <EmojiPicker theme={"dark" as any} onEmojiClick={handleEmojiClick} />
            </Suspense>
          </div>
        )}
        
        <form onSubmit={inputBlocked ? e => e.preventDefault() : handleSubmit} className="flex gap-2 relative">
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
            placeholder={inputBlocked
              ? ((lang === 'ar') ? 'الدردشة معطّلة...' : 'Chat is disabled...')
              : t('typeMessage')}
          />
          
          <Button type="submit" size="icon" disabled={inputBlocked} className="rounded-full shrink-0 disabled:opacity-30 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </motion.div>
  );
}
