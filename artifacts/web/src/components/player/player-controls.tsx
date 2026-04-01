import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Maximize, Minimize,
  MessageSquare, Lock,
  MoreVertical, ChevronRight, ChevronLeft, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateColorFromString } from '@/lib/utils';
import { enterFullscreen, exitFullscreen, isFullscreenActive, isSimulatedFullscreen, onFullscreenChange } from '@/lib/fullscreen';
import { useI18n } from '@/lib/i18n';

export interface SubtitleTrack {
  id: number;
  name: string;
  lang?: string;
}

export interface QualityLevel {
  id: number;
  label: string;
}

export interface AudioTrack {
  id: number;
  label: string;
  lang?: string;
}

export interface ToastMessage {
  id: string;
  username: string;
  content: string;
}

type SettingsView = null | 'main' | 'quality' | 'fit' | 'subtitle' | 'audio';

export type VideoFit = 'contain' | 'cover' | 'fill';

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
  mutedForAutoplay?: boolean;
  onUnmuteAutoplay?: () => void;
  // Quality
  qualityLevels?: QualityLevel[];
  activeQuality?: number;
  onQualityChange?: (id: number) => void;
  // Video fit
  videoFit?: VideoFit;
  onVideoFitChange?: (fit: VideoFit) => void;
  // Subtitle style
  subtitleFontSize?: number;
  onSubtitleFontSizeChange?: (size: number) => void;
  subtitleHasBg?: boolean;
  onSubtitleHasBgChange?: (bg: boolean) => void;
  // Audio tracks / dubbing
  audioTracks?: AudioTrack[];
  activeAudioTrack?: number;
  onAudioTrackChange?: (id: number) => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const FIT_LABELS: Record<VideoFit, { ar: string; en: string }> = {
  contain: { ar: 'عادي',        en: 'Normal' },
  cover:   { ar: 'تملأ الشاشة', en: 'Fill' },
  fill:    { ar: 'ممتد',        en: 'Stretch' },
};

const FONT_SIZES = [
  { value: 75,  label: { ar: 'صغير',     en: 'Small'   } },
  { value: 100, label: { ar: 'متوسط',    en: 'Medium'  } },
  { value: 130, label: { ar: 'كبير',     en: 'Large'   } },
  { value: 170, label: { ar: 'كبير جداً', en: 'X-Large' } },
];

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
  mutedForAutoplay = false,
  onUnmuteAutoplay,
  qualityLevels = [],
  activeQuality = -1,
  onQualityChange,
  videoFit = 'contain',
  onVideoFitChange,
  subtitleFontSize = 100,
  onSubtitleFontSizeChange,
  subtitleHasBg = true,
  onSubtitleHasBgChange,
  audioTracks = [],
  activeAudioTrack = 0,
  onAudioTrackChange,
}: PlayerControlsProps) {
  const { t } = useI18n();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  const lastTouchTimeRef = useRef(0);
  const settingsRef = useRef<HTMLDivElement>(null);

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
    if (!isDragging && isPlaying) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 4000);
    }
  }, [isDragging, isPlaying]);

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

  // Close settings when controls hide
  useEffect(() => {
    if (!showControls) setSettingsView(null);
  }, [showControls]);

  const togglePlay = useCallback(() => {
    if (isPlaying) onPause(); else onPlay();
  }, [isPlaying, onPlay, onPause]);

  const handleVideoAreaTap = useCallback(() => {
    const isTouchEvent = Date.now() - lastTouchTimeRef.current < 500;
    if (isTouchEvent) {
      if (settingsView !== null) { setSettingsView(null); return; }
      if (showControls) {
        setShowControls(false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        resetTimer();
      }
    } else {
      togglePlay();
    }
  }, [showControls, resetTimer, togglePlay, settingsView]);

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

  const activeQualityLabel = qualityLevels.find(q => q.id === activeQuality)?.label ?? 'Auto';

  // ── Settings panel content ─────────────────────────────────────────────────
  const renderSettingsContent = () => {
    if (settingsView === 'quality') {
      return (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setSettingsView('main')}>
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'جودة الفيديو' : 'Quality'}</span>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {qualityLevels.map(q => (
              <button
                key={q.id}
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/10 transition"
                onClick={() => { onQualityChange?.(q.id); setSettingsView(null); }}
              >
                <span className={cn(q.id === activeQuality ? 'text-primary font-medium' : 'text-white/80')}>{q.label}</span>
                {q.id === activeQuality && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
            {qualityLevels.length === 0 && (
              <p className="text-center text-white/40 text-sm py-3">{lang === 'ar' ? 'غير متاح' : 'N/A'}</p>
            )}
          </div>
        </>
      );
    }

    if (settingsView === 'fit') {
      const fits: VideoFit[] = ['contain', 'cover', 'fill'];
      return (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setSettingsView('main')}>
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'نسبة الصورة' : 'Aspect Ratio'}</span>
          </div>
          <div className="py-1">
            {fits.map(f => (
              <button
                key={f}
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/10 transition"
                onClick={() => { onVideoFitChange?.(f); setSettingsView(null); }}
              >
                <span className={cn(f === videoFit ? 'text-primary font-medium' : 'text-white/80')}>
                  {FIT_LABELS[f][lang === 'ar' ? 'ar' : 'en']}
                </span>
                {f === videoFit && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </>
      );
    }

    if (settingsView === 'audio') {
      return (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setSettingsView('main')}>
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'الصوت / الدبلجة' : 'Audio / Dubbing'}</span>
          </div>
          <div className="py-1 max-h-48 overflow-y-auto">
            {audioTracks.length === 0 ? (
              <p className="text-center text-white/40 text-sm py-3">{lang === 'ar' ? 'لا توجد مسارات صوتية' : 'No audio tracks'}</p>
            ) : audioTracks.map(at => (
              <button
                key={at.id}
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/10 transition"
                onClick={() => { onAudioTrackChange?.(at.id); setSettingsView(null); }}
              >
                <span className={cn(at.id === activeAudioTrack ? 'text-primary font-medium' : 'text-white/80')}>
                  {at.label}{at.lang ? ` (${at.lang})` : ''}
                </span>
                {at.id === activeAudioTrack && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </>
      );
    }

    if (settingsView === 'subtitle') {
      return (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setSettingsView('main')}>
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'إعدادات الترجمة' : 'Subtitle Style'}</span>
          </div>
          <div className="p-3 space-y-4">
            {/* Font size */}
            <div>
              <p className="text-xs text-white/50 mb-2">{lang === 'ar' ? 'حجم الخط' : 'Font Size'}</p>
              <div className="flex gap-1.5">
                {FONT_SIZES.map(fs => (
                  <button
                    key={fs.value}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-xs font-medium transition border',
                      subtitleFontSize === fs.value
                        ? 'bg-primary/20 border-primary text-primary'
                        : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10',
                    )}
                    onClick={() => onSubtitleFontSizeChange?.(fs.value)}
                  >
                    {fs.label[lang === 'ar' ? 'ar' : 'en']}
                  </button>
                ))}
              </div>
            </div>
            {/* Background */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/80">{lang === 'ar' ? 'خلفية الترجمة' : 'Background'}</span>
              <button
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors',
                  subtitleHasBg ? 'bg-primary' : 'bg-white/20',
                )}
                onClick={() => onSubtitleHasBgChange?.(!subtitleHasBg)}
              >
                <span
                  className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all',
                    subtitleHasBg ? 'left-6' : 'left-1',
                  )}
                />
              </button>
            </div>
          </div>
        </>
      );
    }

    // Main menu
    return (
      <>
        <div className="px-3 py-2 border-b border-white/10">
          <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'الإعدادات' : 'Settings'}</span>
        </div>
        <div className="py-1">
          {/* Quality */}
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
            onClick={() => setSettingsView('quality')}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">🎬</span>
              <span className="text-white/90">{lang === 'ar' ? 'جودة الفيديو' : 'Quality'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/40">{activeQualityLabel}</span>
              <ChevronRight className="w-4 h-4 text-white/30" />
            </div>
          </button>

          {/* Video fit */}
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
            onClick={() => setSettingsView('fit')}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">▢</span>
              <span className="text-white/90">{lang === 'ar' ? 'نسبة الصورة' : 'Aspect Ratio'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/40">
                {FIT_LABELS[videoFit][lang === 'ar' ? 'ar' : 'en']}
              </span>
              <ChevronRight className="w-4 h-4 text-white/30" />
            </div>
          </button>

          {/* Subtitle settings */}
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
            onClick={() => setSettingsView('subtitle')}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">CC</span>
              <span className="text-white/90">{lang === 'ar' ? 'إعدادات الترجمة' : 'Subtitle Style'}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-white/30" />
          </button>

          {/* Audio / dubbing */}
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
            onClick={() => setSettingsView('audio')}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">🎧</span>
              <span className="text-white/90">{lang === 'ar' ? 'الصوت / الدبلجة' : 'Audio / Dubbing'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {audioTracks.length > 0 && (
                <span className="text-xs text-white/40">
                  {audioTracks.find(a => a.id === activeAudioTrack)?.label ?? ''}
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-white/30" />
            </div>
          </button>

          <div className="border-t border-white/10 mt-1 pt-1">
            {/* Subtitle tracks */}
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
              onClick={() => { onSubtitleChange?.(-1); setSettingsView(null); }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">🚫</span>
                <span className={cn(activeSubtitleId === -1 ? 'text-primary' : 'text-white/90')}>
                  {lang === 'ar' ? 'إيقاف الترجمة' : 'Subtitles Off'}
                </span>
              </div>
              {activeSubtitleId === -1 && <Check className="w-4 h-4 text-primary" />}
            </button>

            {customSubtitleLabel && (
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
                onClick={() => { onSubtitleChange?.(-2); setSettingsView(null); }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">✓</span>
                  <span className={cn('truncate max-w-[140px]', activeSubtitleId === -2 ? 'text-primary' : 'text-white/90')}>
                    {customSubtitleLabel}
                  </span>
                </div>
                {activeSubtitleId === -2 && <Check className="w-4 h-4 text-primary" />}
              </button>
            )}

            {subtitleTracks.map((tk) => (
              <button
                key={tk.id}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
                onClick={() => { onSubtitleChange?.(tk.id); setSettingsView(null); }}
              >
                <span className={cn(activeSubtitleId === tk.id ? 'text-primary' : 'text-white/90')}>
                  {tk.name || tk.lang || `Track ${tk.id + 1}`}
                </span>
                {activeSubtitleId === tk.id && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}

            {/* Search subtitles */}
            <button
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/10 transition"
              onClick={() => { onSearchSubtitles?.(); setSettingsView(null); }}
            >
              <span className="text-base">🔍</span>
              <span className="text-white/70">{lang === 'ar' ? 'البحث عن ترجمة' : 'Search Subtitle'}</span>
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col justify-between select-none"
      onMouseMove={resetTimer}
      onTouchStart={() => { lastTouchTimeRef.current = Date.now(); resetTimer(); }}
      onClick={handleVideoAreaTap}
    >
      {/* Toast notifications */}
      <div className="absolute bottom-20 right-4 z-40 flex flex-col gap-2 pointer-events-none">
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

      {/* ── Three-dots settings button — top-left ── */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute left-2 z-30"
            style={{ top: 'calc(8px + env(safe-area-inset-top, 0px))' }}
            onClick={(e) => e.stopPropagation()}
            ref={settingsRef}
          >
            <button
              className={cn(
                'p-2 rounded-full transition bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm',
                settingsView !== null && 'bg-black/60',
              )}
              onClick={() => setSettingsView(v => v === null ? 'main' : null)}
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            <AnimatePresence>
              {settingsView !== null && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-10 left-0 w-64 bg-zinc-900/97 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                >
                  {renderSettingsContent()}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

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
            <div className="relative">
              {/* Progress bar */}
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
                      className={cn('absolute left-0 top-0 h-full rounded-full', canControl ? 'bg-primary' : 'bg-white/40')}
                      style={{ width: `${progress}%` }}
                    >
                      {canControl && (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full bg-white shadow-lg" />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[11px] font-bold text-white/70 tracking-wider">LIVE</span>
                </div>
              )}

              {/* Buttons row */}
              <div className="flex items-center justify-between gap-1" dir="ltr">

                {/* LEFT: Skip · Play/Pause · Volume */}
                <div className="flex items-center">
                  {!canControl && (
                    <div className="flex items-center gap-1 px-2 py-1 me-1 rounded-full bg-amber-500/20 border border-amber-400/30">
                      <Lock className="w-3 h-3 text-amber-400" />
                      <span className="text-[10px] text-amber-300 font-medium">{t('viewOnly')}</span>
                    </div>
                  )}

                  <button
                    className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                    onClick={() => seekRelative(-10)}
                    disabled={!canControl}
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>

                  <button
                    className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                    onClick={togglePlay}
                    disabled={!canControl}
                  >
                    {isPlaying
                      ? <Pause className="w-5 h-5 fill-white" />
                      : <Play  className="w-5 h-5 fill-white" />}
                  </button>

                  <button
                    className={cn('p-2.5 rounded-full transition', canControl ? 'hover:bg-white/10 active:bg-white/20 text-white' : 'text-white/25 cursor-not-allowed')}
                    onClick={() => seekRelative(10)}
                    disabled={!canControl}
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>

                  <div className="flex items-center gap-1">
                    <div className="relative">
                      <button
                        className="p-2.5 rounded-full hover:bg-white/10 transition"
                        onClick={() => {
                          if (mutedForAutoplay) {
                            onUnmuteAutoplay?.();
                            setIsMuted(false);
                          } else {
                            setIsMuted((m) => !m);
                          }
                        }}
                      >
                        {(isMuted || volume === 0 || mutedForAutoplay)
                          ? <VolumeX className={cn('w-5 h-5', mutedForAutoplay ? 'text-amber-400' : 'text-white')} />
                          : <Volume2 className="w-5 h-5 text-white" />}
                      </button>
                      {mutedForAutoplay && (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse pointer-events-none" />
                      )}
                    </div>
                    <input
                      type="range"
                      min={0} max={1} step={0.05}
                      value={(isMuted || mutedForAutoplay) ? 0 : volume}
                      onChange={(e) => {
                        if (mutedForAutoplay) onUnmuteAutoplay?.();
                        setVolume(+e.target.value);
                        setIsMuted(false);
                      }}
                      className="hidden md:block w-16 lg:w-20 accent-primary cursor-pointer"
                    />
                  </div>

                  {!isLive && duration > 0 && (
                    <span className="hidden sm:inline text-[11px] text-white/60 font-mono ms-0.5 tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  )}
                </div>

                {/* RIGHT: Subtitle · Chat · Fullscreen */}
                <div className="flex items-center">
                  <button
                    className={cn('p-2.5 rounded-full hover:bg-white/10 transition text-white', isChatOpen && 'text-primary bg-white/10')}
                    onClick={onToggleChat}
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>

                  <button
                    className="p-2.5 rounded-full hover:bg-white/10 transition text-white"
                    onClick={toggleFullscreen}
                  >
                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
