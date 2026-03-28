import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Reply, Trash2, Pencil, SmilePlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface Props {
  children: ReactNode;
  messageText: string;
  isOwnMessage: boolean;
  onReply?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onReact?: (emoji: string) => void;
}

export function MessageContextMenu({ children, messageText, isOwnMessage, onReply, onDelete, onEdit, onReact }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setShowEmojis(false); };
    window.addEventListener('pointerdown', close, { once: true });
    window.addEventListener('scroll', close, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [open]);

  const items: MenuItem[] = [];

  if (onReact) {
    items.push({
      id: 'react',
      label: t('chatReact') || 'تفاعل',
      icon: <SmilePlus className="w-4 h-4" />,
      onClick: () => setShowEmojis(v => !v),
    });
  }

  if (onReply) {
    items.push({
      id: 'reply',
      label: t('chatReply'),
      icon: <Reply className="w-4 h-4" />,
      onClick: () => { setOpen(false); onReply(); },
    });
  }

  items.push({
    id: 'copy',
    label: t('chatCopy'),
    icon: <Copy className="w-4 h-4" />,
    onClick: () => {
      setOpen(false);
      navigator.clipboard.writeText(messageText).catch(() => {});
    },
  });

  if (isOwnMessage && onEdit) {
    items.push({
      id: 'edit',
      label: t('chatEdit') || 'تعديل',
      icon: <Pencil className="w-4 h-4" />,
      onClick: () => { setOpen(false); onEdit(); },
    });
  }

  if (isOwnMessage && onDelete) {
    items.push({
      id: 'delete',
      label: t('chatDelete'),
      icon: <Trash2 className="w-4 h-4" />,
      danger: true,
      onClick: () => { setOpen(false); onDelete(); },
    });
  }

  const showMenu = (clientX: number, clientY: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = 180;
    const menuH = items.length * 44 + 16 + (onReact ? 48 : 0);
    const x = Math.min(clientX, vw - menuW - 8);
    const y = clientY + menuH > vh ? clientY - menuH : clientY;
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
    setShowEmojis(false);
    setOpen(true);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const sx = touch.clientX;
    const sy = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      showMenu(sx, sy);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className="select-none"
      >
        {children}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            className="fixed z-[9999] min-w-[170px] rounded-xl border border-white/10 py-1.5 shadow-2xl"
            style={{
              left: pos.x,
              top: pos.y,
              backgroundColor: 'rgba(20,20,30,0.96)',
              backdropFilter: 'blur(16px)',
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            {showEmojis && onReact && (
              <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
                {QUICK_EMOJIS.map(e => (
                  <button
                    key={e}
                    onClick={() => { onReact(e); setOpen(false); setShowEmojis(false); }}
                    className="text-lg hover:scale-125 transition-transform active:scale-110"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {items.map(item => (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-white/10 ${
                  item.danger ? 'text-red-400' : 'text-white/80'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
