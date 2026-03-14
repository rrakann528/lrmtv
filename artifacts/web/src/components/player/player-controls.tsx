import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Maximize, Minimize,
  MessageSquare, Subtitles, X, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateColorFromString } from '@/lib/utils';
import { enterFullscreen, exitFullscreen, isFullscreenActive, isSimulatedFullscreen, onFullscreenChange } from '@/lib/fullscreen';

export interface SubtitleTrack {
  id: number;
  name: string;
  lang?: string;
}

export interface ToastMessage {
  id: string;
  username: string;
  content: string;
}

interface PlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isLive?: boolean;
  canControl?: boolean;
  subtitleTracks?: SubtitleTrack[];
  activeSubtitleId?: number;
  customSubtitleLabel?: string;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onSubtitleChange?: (id: number) => void;
  onSearchSubtitles?: () => void;
  onToggleChat: () => void;
  isChatOpen: boolean;
  toastMessages: ToastMessage[];
  lang?: 'en' | 'ar';
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function PlayerControls({
  videoRef,
  containerRef,
  isPlaying,
  isLive = false,
  canControl = true,
  subtitleTracks = [],
  activeSubtitleId = -1,
  customSubtitleLabel,
  onPlay,
  onPause,
  onSeek,
  onSubtitleChange,
  onSearchSubtitles,
  onToggleChat,
  isChatOpen,
  toastMessages,
  lang = 'en',
}: PlayerControlsProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        setCurrentTime(v.currentTime);
        setDuration(isNaN(v.duration) ? 0 : v.duration);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = isMuted ? 0 : volume;
  }, [volume, isMuted, videoRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return onFullscreenChange(el, (fs) => setIsFullscreen(fs));
  }, [containerRef]);

  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // Only auto-hide when playing and not dragging
    if (!isDragging && isPlaying) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 4000);
    }
  }, [isDragging, isPlaying]);

  // Show controls whenever paused
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [resetTimer]);

  const togglePlay = useCallback(() => {
    if (isPlaying) onPause(); else onPlay();
  }, [isPlaying, onPlay, onPause]);

  const seekRelative = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.currentTime + delta, v.duration || 0));
    v.currentTime = t;
    onSeek(t);
  }, [videoRef, onSeek]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isLive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    const t = ratio * duration;
    if (videoRef.current) videoRef.current.currentTime = t;
    onSeek(t);
  }, [isLive, duration, videoRef, onSeek]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (isFullscreenActive() || isSimulatedFullscreen(el)) await exitFullscreen(el);
    else await enterFullscreen(el);
  }, [containerRef]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col justify-between select-none"
      onMouseMove={resetTimer}
      onTouchStart={resetTimer}
      onClick={togglePlay}
    >
      {/* Toast notifications — top priority, always visible */}
      <div className="absolute bottom-20 end-4 z-40 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toastMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="max-w-[260px] bg-black/85 backdrop-blur-md rounded-xl p-3 flex items-start gap-3 border border-white/10 shadow-2xl"
            >
              <div
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: generateColorFromString(msg.username) }}
              >
                {msg.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-white/60 leading-none mb-0.5">{msg.username}</p>
                <p className="text-sm text-white break-words leading-snug">{msg.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Controls bar */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-auto bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-14 pb-2 md:pb-3 px-3 md:px-4 space-y-1 md:space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress bar + playback buttons — wrapped for guest-lock */}
            <div className="relative">
              {/* Transparent blocker absorbs ALL events for guests */}
              {!canControl && (
                <div
                  className="absolute inset-0 z-10 cursor-not-allowed"
                  onClickCapture={(e) => e.stopPropagation()}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onTouchStartCapture={(e) => e.stopPropagation()}
                />
              )}

            {/* Progress bar — tall hit-area for easy touch */}
            {!isLive ? (
              <div
                className={cn('py-2 group relative', canControl ? 'cursor-pointer' : 'cursor-default')}
                onClick={canControl ? handleProgressClick : undefined}
                onMouseDown={() => canControl && setIsDragging(true)}
                onMouseUp={() => setIsDragging(false)}
                onTouchStart={() => canControl && setIsDragging(true)}
                onTouchEnd={() => setIsDragging(false)}
              >
                <div className="h-1 md:h-1.5 bg-white/20 rounded-full relative">
                  <div
                    className={cn('h-full rounded-full relative', canControl ? 'bg-primary' : 'bg-white/40')}
                    style={{ width: `${progress}%` }}
                  >
                    {canControl && <div className="absolute end-0 top-1/2 -translate-y-1/2 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full bg-white shadow-lg" />}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] font-bold text-white/70 tracking-wider">LIVE</span>
              </div>
            )}

            {/* Buttons row */}
            <div className="flex items-center justify-between gap-1">
              {/* Left group */}
              <div className="flex items-center">
                {/* Lock badge */}
                {!canControl && (
                  <div className="flex items-center gap-1 px-2 py-1 me-1 rounded-full bg-amber-500/20 border border-amber-400/30">
                    <Lock className="w-3 h-3 text-amber-400" />
                    <span className="text-[10px] text-amber-300 font-medium">
                      {lang === 'ar' ? 'للمشاهدة فقط' : 'View only'}
                    </span>
                  </div>
                )}
                <button
                  className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                  onClick={togglePlay}
                  disabled={!canControl}
                >
                  {isPlaying
                    ? <Pause className="w-5 h-5 fill-white" />
                    : <Play className="w-5 h-5 fill-white" />}
                </button>

                <button
                  className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                  onClick={() => seekRelative(-10)}
                  disabled={!canControl}
                >
                  <SkipBack className="w-5 h-5" />
                </button>

                <button
                  className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                  onClick={() => seekRelative(10)}
                  disabled={!canControl}
                >
                  <SkipForward className="w-5 h-5" />
                </button>

                {/* Volume — icon only on mobile, icon+slider on md+ */}
                <div className="flex items-center gap-1 group/vol">
                  <button
                    className="p-2.5 rounded-full hover:bg-white/10 transition text-white"
                    onClick={() => setIsMuted((m) => !m)}
                  >
                    {isMuted || volume === 0
                      ? <VolumeX className="w-5 h-5" />
                      : <Volume2 className="w-5 h-5" />}
                  </button>
                  <input
                    type="range"
                    min={0} max={1} step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => { setVolume(+e.target.value); setIsMuted(false); }}
                    className="hidden md:block w-16 lg:w-20 accent-primary cursor-pointer"
                  />
                </div>

                {!isLive && duration > 0 && (
                  <span className="hidden sm:inline text-[11px] text-white/60 font-mono ms-0.5 tabular-nums">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                )}
              </div>

              {/* Right group */}
              <div className="flex items-center">
                {/* Subtitles — always visible */}
                <div className="relative">
                  <button
                    className={cn(
                      'p-2.5 rounded-full hover:bg-white/10 transition text-white',
                      (activeSubtitleId >= 0 || activeSubtitleId === -2) && 'text-primary',
                    )}
                    onClick={() => setShowSubMenu((s) => !s)}
                  >
                    <Subtitles className="w-5 h-5" />
                  </button>
                  <AnimatePresence>
                    {showSubMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        className="absolute bottom-full end-0 mb-2 bg-zinc-900/95 backdrop-blur rounded-xl border border-white/10 p-1 min-w-[170px] shadow-2xl z-20"
                      >
                        {/* Off */}
                        <button
                          className={cn(
                            'w-full text-start px-3 py-1.5 rounded-lg text-sm hover:bg-white/10',
                            activeSubtitleId === -1 ? 'text-primary' : 'text-white/70',
                          )}
                          onClick={() => { onSubtitleChange?.(-1); setShowSubMenu(false); }}
                        >
                          {lang === 'ar' ? 'إيقاف' : 'Off'}
                        </button>

                        {/* Custom subtitle (from search) */}
                        {customSubtitleLabel && (
                          <button
                            className={cn(
                              'w-full text-start px-3 py-1.5 rounded-lg text-sm hover:bg-white/10 truncate',
                              activeSubtitleId === -2 ? 'text-primary' : 'text-white/70',
                            )}
                            onClick={() => { onSubtitleChange?.(-2); setShowSubMenu(false); }}
                          >
                            {customSubtitleLabel}
                          </button>
                        )}

                        {/* Embedded HLS tracks */}
                        {subtitleTracks.map((t) => (
                          <button
                            key={t.id}
                            className={cn(
                              'w-full text-start px-3 py-1.5 rounded-lg text-sm hover:bg-white/10',
                              activeSubtitleId === t.id ? 'text-primary' : 'text-white/70',
                            )}
                            onClick={() => { onSubtitleChange?.(t.id); setShowSubMenu(false); }}
                          >
                            {t.name || t.lang || `Track ${t.id + 1}`}
                          </button>
                        ))}

                        {/* Divider + search online */}
                        <div className="border-t border-white/10 mt-1 pt-1">
                          <button
                            className="w-full text-start px-3 py-1.5 rounded-lg text-sm text-white/50 hover:bg-white/10 hover:text-white transition flex items-center gap-2"
                            onClick={() => { onSearchSubtitles?.(); setShowSubMenu(false); }}
                          >
                            <span className="text-base leading-none">🔍</span>
                            {lang === 'ar' ? 'البحث عن ترجمة' : 'Search subtitles…'}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Chat */}
                <button
                  className={cn(
                    'p-2.5 rounded-full hover:bg-white/10 transition text-white',
                    isChatOpen && 'text-primary bg-white/10',
                  )}
                  onClick={onToggleChat}
                >
                  <MessageSquare className="w-5 h-5" />
                </button>

                {/* Fullscreen */}
                <button
                  className="p-2.5 rounded-full hover:bg-white/10 transition text-white"
                  onClick={toggleFullscreen}
                >
                  {isFullscreen
                    ? <Minimize className="w-5 h-5" />
                    : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>
            </div>{/* end relative wrapper */}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
