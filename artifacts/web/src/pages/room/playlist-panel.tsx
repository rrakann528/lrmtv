import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Trash2, GripVertical, Music2, ListVideo,
  ChevronRight, Loader2,
} from 'lucide-react';
import {
  useGetRoomPlaylist, useDeletePlaylistItem, useReorderPlaylist,
  getGetRoomPlaylistQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface PlaylistItem {
  id: number;
  url: string;
  title: string;
  sourceType: string;
  addedBy?: string | null;
  position?: number;
}

interface PlaylistPanelProps {
  slug: string;
  isDJ: boolean;
  canControl: boolean;
  currentUrl: string | null;
  isPlaying: boolean;
  /** null = still checking, true = via proxy, false = direct */
  isCurrentUsingProxy?: boolean | null;
  emitSync: (time: number, playing: boolean, url: string | null) => void;
  emitPlaylistUpdate: (action: string) => void;
}

function sourceIcon(sourceType: string) {
  if (sourceType === 'youtube')  return '▶ YouTube';
  if (sourceType === 'hls') return '📡 HLS';
  if (sourceType === 'twitch')   return '🟣 Twitch';
  if (sourceType === 'vimeo')    return '🎬 Vimeo';
  return `🎵 ${sourceType}`;
}

export default function PlaylistPanel({
  slug, isDJ, canControl, currentUrl, isPlaying,
  isCurrentUsingProxy = null,
  emitSync, emitPlaylistUpdate,
}: PlaylistPanelProps) {
  const { t } = useI18n();
  const { data: playlist, isLoading } = useGetRoomPlaylist(slug);
  const deleteMutation = useDeletePlaylistItem();
  const reorderMutation = useReorderPlaylist();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const invalidatePlaylist = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetRoomPlaylistQueryKey(slug) });
  }, [queryClient, slug]);

  useEffect(() => {
    const handler = () => invalidatePlaylist();
    window.addEventListener('playlist-updated', handler);
    return () => window.removeEventListener('playlist-updated', handler);
  }, [invalidatePlaylist]);

  const playItem = useCallback((url: string) => {
    if (!canControl) return;
    emitSync(0, true, url);
  }, [canControl, emitSync]);

  const removeItem = useCallback(async (itemId: number) => {
    if (!isDJ) return;
    setDeletingId(itemId);
    try {
      await deleteMutation.mutateAsync({ slug, itemId });
      invalidatePlaylist();
      emitPlaylistUpdate('remove');
    } catch {}
    setDeletingId(null);
  }, [isDJ, slug, deleteMutation, invalidatePlaylist, emitPlaylistUpdate]);

  const handleDragStart = (index: number) => { if (isDJ) setDragIndex(index); };
  const handleDragOver  = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index); };
  const handleDragEnd   = async () => {
    if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex || !playlist) {
      setDragIndex(null); setDragOverIndex(null); return;
    }
    const items = [...(playlist as PlaylistItem[])];
    const [moved] = items.splice(dragIndex, 1);
    items.splice(dragOverIndex, 0, moved);
    const reordered = items.map((item, i) => ({ id: item.id, position: i }));
    setDragIndex(null); setDragOverIndex(null);
    try {
      await reorderMutation.mutateAsync({ slug, data: { items: reordered } });
      invalidatePlaylist();
      emitPlaylistUpdate('reorder');
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const items = (playlist as PlaylistItem[] | undefined) ?? [];

  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex flex-col items-center justify-center gap-3 text-white/40 p-6"
      >
        <ListVideo className="w-10 h-10 opacity-30" />
        <p className="text-sm text-center">{t('playlistEmpty')}</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full"
     
    >
      {/* Header info */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between shrink-0">
        <span className="text-xs text-white/50 flex items-center gap-1.5">
          <Music2 className="w-3.5 h-3.5" />
          {items.length} {t('videoLabel')}
        </span>
        {!canControl && (
          <span className="text-[10px] text-amber-400/70 flex items-center gap-1">
            {t('viewOnly')}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const isCurrent = currentUrl === item.url;
            const isDragging  = dragIndex === index;
            const isDragOver  = dragOverIndex === index && dragIndex !== index;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                draggable={isDJ}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'flex items-center gap-2 rounded-xl border transition-all select-none',
                  isCurrent
                    ? 'bg-primary/15 border-primary/40 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                    : 'bg-white/5 border-white/5',
                  canControl && !isCurrent && 'hover:bg-white/10 active:bg-white/15 cursor-pointer',
                  isDragging  && 'opacity-40 scale-95',
                  isDragOver  && 'border-primary border-dashed',
                )}
                onClick={() => { if (!isCurrent && canControl) playItem(item.url); }}
              >
                {/* Drag handle — DJ only */}
                {isDJ && (
                  <div
                    className="ps-2 py-3 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                {/* Thumbnail / status icon */}
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border',
                  isCurrent ? 'bg-primary/20 border-primary/30' : 'bg-black/40 border-white/10',
                  !isDJ && 'ms-2',
                )}>
                  {isCurrent ? (
                    <div className="flex gap-[3px] items-end h-4">
                      {isPlaying ? (
                        <>
                          <div className="w-[3px] bg-primary rounded-full animate-[bounce_0.9s_ease-in-out_infinite] h-4" />
                          <div className="w-[3px] bg-primary rounded-full animate-[bounce_1.1s_ease-in-out_infinite] h-3" />
                          <div className="w-[3px] bg-primary rounded-full animate-[bounce_0.7s_ease-in-out_infinite] h-2" />
                        </>
                      ) : (
                        <Pause className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  ) : (
                    <Play className={cn('w-4 h-4', canControl ? 'text-white/60' : 'text-white/25')} />
                  )}
                </div>

                {/* Title + source */}
                <div className="flex-1 min-w-0 py-2.5">
                  <p className={cn(
                    'text-sm font-medium truncate leading-snug',
                    isCurrent ? 'text-primary' : 'text-white/90',
                  )}>
                    {item.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <p className="text-[10px] text-white/40 truncate">
                      {sourceIcon(item.sourceType)}
                      {item.addedBy ? ` • ${item.addedBy}` : ''}
                    </p>
                    {isCurrent && isCurrentUsingProxy !== null && (
                      <span className={cn(
                        'text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
                        isCurrentUsingProxy
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-emerald-500/20 text-emerald-400',
                      )}>
                        {isCurrentUsingProxy ? '⚡ بروكسي' : '✓ مباشر'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 pe-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {/* Play button — shown for canControl, non-current items */}
                  {canControl && !isCurrent && (
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 hover:bg-primary/30 active:bg-primary/40 text-primary transition-colors"
                      onClick={() => playItem(item.url)}
                      title={t('play')}
                    >
                      <Play className="w-3.5 h-3.5 fill-primary" />
                    </button>
                  )}

                  {/* Playing indicator button — tap to toggle play/pause */}
                  {canControl && isCurrent && (
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 hover:bg-primary/30 text-primary transition-colors"
                      onClick={() => emitSync(0, !isPlaying, item.url)}
                      title={isPlaying ? t('pause') : t('play')}
                    >
                      {isPlaying
                        ? <Pause className="w-3.5 h-3.5 fill-primary" />
                        : <Play  className="w-3.5 h-3.5 fill-primary" />
                      }
                    </button>
                  )}

                  {/* Delete — DJ only */}
                  {isDJ && (
                    <button
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-400/10 active:bg-red-400/20 transition-colors"
                      onClick={() => removeItem(item.id)}
                      disabled={deletingId === item.id}
                      title={t('remove')}
                    >
                      {deletingId === item.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2  className="w-3.5 h-3.5" />
                      }
                    </button>
                  )}

                  {/* Arrow hint when canControl but not DJ (no delete) */}
                  {canControl && !isDJ && !isCurrent && (
                    <ChevronRight className="w-4 h-4 text-white/20 ms-0.5" />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
