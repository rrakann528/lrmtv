import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import ReactPlayer from 'react-player';
import { motion, AnimatePresence } from 'framer-motion';
import { normalizeUrl, detectVideoType } from '@/lib/detect-video-type';
import {
  AlertTriangle, Play, Pause, Maximize, Minimize,
  MessageSquare, SkipBack, SkipForward, Volume2, VolumeX, Lock, Subtitles,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { enterFullscreen, exitFullscreen, isFullscreenActive, isSimulatedFullscreen, onFullscreenChange } from '@/lib/fullscreen';
import { HlsPlayer, type HlsPlayerHandle } from './hls-player';
import FullscreenChat from './fullscreen-chat';
import SubtitleSearch from './subtitle-search';
import { generateColorFromString, cn } from '@/lib/utils';
import type { ToastMessage } from './player-controls';
import { fetchSponsorSegments, findActiveSegment, isYouTubeUrl, type SponsorSegment, AD_CATEGORIES } from '@/lib/sponsorblock';
import { getSettings } from '@/lib/settings';

interface SubtitleCue { start: number; end: number; text: string }

function parseSrtTime(t: string): number {
  const clean = t.replace(',', '.').trim();
  const parts = clean.split(':');
  if (parts.length < 3) return 0;
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function parseSubtitles(raw: string): SubtitleCue[] {
  const withoutBom = raw.replace(/^\uFEFF/, '');
  const normalized = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isVtt = normalized.trimStart().startsWith('WEBVTT');
  const text = isVtt ? normalized.replace(/^WEBVTT[^\n]*/m, '') : normalized;
  const blocks = text.trim().split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const arrowIdx = timeLine.indexOf('-->');
    const startStr = timeLine.slice(0, arrowIdx).trim();
    const endStr = timeLine.slice(arrowIdx + 3).trim().split(/\s+/)[0];
    const start = parseSrtTime(startStr);
    const end   = parseSrtTime(endStr);
    if (isNaN(start) || isNaN(end)) continue;
    const textLines = lines
      .slice(lines.indexOf(timeLine) + 1)
      .filter(l => l.trim() && !/^\d+$/.test(l.trim()));
    const cueText = textLines.join('\n').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  return cues;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export interface SmartPlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number, type?: string) => void;
  play: () => void;
  pause: () => void;
  getVideoElement: () => HTMLVideoElement | null;
}

export interface ChatMessage {
  id: number;
  username: string;
  content: string;
  type: string;
  createdAt: string;
}

interface SmartPlayerProps {
  url: string;
  playing: boolean;
  controls: boolean;
  /** When false, play/pause/seek buttons are disabled for this user */
  canControl?: boolean;
  /** Seek to this position once the player is ready (for joining mid-stream) */
  initialTime?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  /** Fired once the underlying player is loaded enough to accept seeks */
  onReady?: () => void;
  chatMessages?: ChatMessage[];
  username?: string;
  onSendChatMessage?: (content: string) => void;
  onFocusChat?: () => void;
  lang?: 'en' | 'ar';
  onSubtitleApplied?: (payload: { type: 'url' | 'content' | 'clear'; url?: string; content?: string; label?: string; from: string }) => void;
  externalSubtitle?: { type: 'url' | 'content' | 'clear'; url?: string; content?: string; label?: string; from: string } | null;
  /** Hint from server that the current stream is live — skip time-based startPosition */
  isLiveHint?: boolean;
  /** Fired when HLS manifest is parsed and live/VOD status is known */
  onIsLive?: (isLive: boolean) => void;
  sponsorSkipEnabled?: boolean;
}

export const SmartPlayer = forwardRef<SmartPlayerHandle, SmartPlayerProps>(
  (
    {
      url,
      playing,
      controls,
      canControl = true,
      initialTime = 0,
      onPlay,
      onPause,
      onSeek,
      onReady,
      chatMessages = [],
      username = '',
      onSendChatMessage,
      onFocusChat,
      lang = 'en',
      onSubtitleApplied,
      externalSubtitle,
      isLiveHint = false,
      onIsLive,
      sponsorSkipEnabled = true,
    },
    ref,
  ) => {
    const reactPlayerRef = useRef<ReactPlayer>(null);
    const hlsPlayerRef = useRef<HlsPlayerHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [proxyUrl, setProxyUrl] = useState<string | null>(null);
    const [nativeVideo, setNativeVideo] = useState(false);
    const nativeVideoRef = useRef<HTMLVideoElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [showOverlay, setShowOverlay] = useState(true);
    const [toastQueue, setToastQueue] = useState<ToastMessage[]>([]);
    const prevMsgCountRef = useRef(0);
    const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // ReactPlayer playback tracking
    const [rpCurrentTime, setRpCurrentTime] = useState(0);
    const [rpDuration, setRpDuration] = useState(0);
    const [rpVolume, setRpVolume] = useState(() => getSettings().defaultVolume / 100);
    const [rpMuted, setRpMuted] = useState(false);

    // ── Subtitle state (ReactPlayer branch only) ─────────────────────────────
    const [showSubtitleSearch, setShowSubtitleSearch] = useState(false);
    const [customSubtitleCues, setCustomSubtitleCues] = useState<SubtitleCue[]>([]);
    const [currentSubtitleText, setCurrentSubtitleText] = useState('');
    const [customSubtitleLabel, setCustomSubtitleLabel] = useState('');

    const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
    const lastSkippedRef = useRef<string | null>(null);
    const [sponsorSkipNotice, setSponsorSkipNotice] = useState(false);
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { t } = useI18n();

    const normalizedUrl = normalizeUrl(url);
    const videoType = detectVideoType(normalizedUrl);
    const isHls = videoType === 'hls';

    useEffect(() => {
      setError(null);
      setReady(false);
      setAutoplayBlocked(false);
      setProxyUrl(null);
      setNativeVideo(false);
      lastSkippedRef.current = null;
      setSponsorSegments([]);
      if (isYouTubeUrl(normalizedUrl)) {
        fetchSponsorSegments(normalizedUrl, setSponsorSegments);
      }
    }, [normalizedUrl]);

    // Fullscreen tracking
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      return onFullscreenChange(el, (fs) => {
        setIsFullscreen(fs);
        if (!fs) setIsChatOpen(false);
      });
    }, []);

    useEffect(() => {
      return () => { if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current); };
    }, []);

    const resetOverlayTimer = useCallback(() => {
      setShowOverlay(true);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      // Only auto-hide when playing; keep visible when paused
      if (playing) {
        overlayTimerRef.current = setTimeout(() => setShowOverlay(false), 4000);
      }
    }, [playing]);

    // Show overlay whenever paused
    useEffect(() => {
      if (!playing) {
        setShowOverlay(true);
        if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      }
    }, [playing]);

    // Direct player control — gated on canControl so guests can't bypass permissions.
    // Must be called synchronously inside a user gesture on mobile (iOS/Android).
    const directPlay = useCallback(() => {
      if (!canControl) return;
      try {
        const ip = reactPlayerRef.current?.getInternalPlayer();
        if (ip?.playVideo) ip.playVideo();      // YouTube API
        else if (ip?.play) ip.play();           // Vimeo / HTML5
      } catch {}
      onPlay?.();
    }, [canControl, onPlay]);

    const directPause = useCallback(() => {
      if (!canControl) return;
      try {
        const ip = reactPlayerRef.current?.getInternalPlayer();
        if (ip?.pauseVideo) ip.pauseVideo();    // YouTube API
        else if (ip?.pause) ip.pause();         // Vimeo / HTML5
      } catch {}
      onPause?.();
    }, [canControl, onPause]);

    const directSeek = useCallback((t: number) => {
      if (!canControl) return;
      reactPlayerRef.current?.seekTo(t, 'seconds');
      onSeek?.(t);
      resetOverlayTimer();
    }, [canControl, onSeek, resetOverlayTimer]);

    const toggleReactPlayerFullscreen = useCallback(async () => {
      const el = containerRef.current;
      if (!el) return;
      if (isFullscreenActive() || isSimulatedFullscreen(el)) await exitFullscreen(el);
      else await enterFullscreen(el);
    }, []);

    const handleToggleChatReactPlayer = useCallback(() => {
      if (isFullscreen) setIsChatOpen((o) => !o);
      else onFocusChat?.();
    }, [isFullscreen, onFocusChat]);

    // Toast notifications for ReactPlayer sources (YouTube etc) when fullscreen
    useEffect(() => {
      if (isHls) return; // handled inside HlsPlayer
      const count = chatMessages.length;
      if (!isFullscreen || count <= prevMsgCountRef.current) {
        prevMsgCountRef.current = count;
        return;
      }
      const newMsgs = chatMessages.slice(prevMsgCountRef.current);
      prevMsgCountRef.current = count;

      newMsgs
        .filter((m) => m.type !== 'system' && m.username !== username)
        .forEach((m) => {
          const toast: ToastMessage = { id: `${m.id}-${Date.now()}`, username: m.username, content: m.content };
          setToastQueue((q) => [...q, toast]);
          setTimeout(() => setToastQueue((q) => q.filter((t) => t.id !== toast.id)), 5000);
        });
    }, [chatMessages, isFullscreen, username, isHls]);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => {
        if (isHls) return hlsPlayerRef.current?.getCurrentTime() ?? 0;
        if (!ready || !reactPlayerRef.current) return 0;
        return reactPlayerRef.current.getCurrentTime() || 0;
      },
      seekTo: (time: number) => {
        if (isHls) { hlsPlayerRef.current?.seekTo(time); return; }
        if (!ready || !reactPlayerRef.current) return;
        reactPlayerRef.current.seekTo(time, 'seconds');
      },
      play: () => {
        if (isHls) { hlsPlayerRef.current?.play(); return; }
        try {
          const ip = reactPlayerRef.current?.getInternalPlayer();
          if (ip?.playVideo) ip.playVideo();
          else if (ip?.play) ip.play().catch?.(() => {});
        } catch {}
      },
      pause: () => {
        if (isHls) { hlsPlayerRef.current?.pause(); return; }
        try {
          const ip = reactPlayerRef.current?.getInternalPlayer();
          if (ip?.pauseVideo) ip.pauseVideo();
          else if (ip?.pause) ip.pause();
        } catch {}
      },
      getVideoElement: () => {
        if (isHls) return hlsPlayerRef.current?.getVideoElement() ?? null;
        try {
          const ip = reactPlayerRef.current?.getInternalPlayer();
          if (ip instanceof HTMLVideoElement) return ip;
        } catch {}
        return null;
      },
    }));

    // ── Subtitle: update current cue as video progresses ────────────────────
    useEffect(() => {
      if (isHls) return;
      if (customSubtitleCues.length === 0) { setCurrentSubtitleText(''); return; }
      const cue = customSubtitleCues.find(c => rpCurrentTime >= c.start && rpCurrentTime <= c.end);
      setCurrentSubtitleText(cue ? cue.text : '');
    }, [rpCurrentTime, customSubtitleCues, isHls]);

    // ── Subtitle: apply external subtitle from a room peer ───────────────────
    useEffect(() => {
      if (isHls) return;
      if (!externalSubtitle) return;
      if (externalSubtitle.type === 'clear') {
        setCustomSubtitleCues([]);
        setCustomSubtitleLabel('');
        return;
      }
      if (externalSubtitle.type === 'content' && externalSubtitle.content) {
        setCustomSubtitleCues(parseSubtitles(externalSubtitle.content));
        setCustomSubtitleLabel(externalSubtitle.label ?? '');
      } else if (externalSubtitle.type === 'url' && externalSubtitle.url) {
        fetch(`/api/proxy/subtitle?url=${encodeURIComponent(externalSubtitle.url)}`)
          .then(r => r.text())
          .then(text => {
            setCustomSubtitleCues(parseSubtitles(text));
            setCustomSubtitleLabel(externalSubtitle.label ?? '');
          })
          .catch(err => console.warn('[subtitle] failed to fetch external URL', err));
      }
    }, [externalSubtitle, isHls]);

    // ── Subtitle: handle apply from search dialog ────────────────────────────
    const handleApplySubtitle = useCallback((raw: string, label: string, sourceUrl?: string) => {
      const cues = parseSubtitles(raw);
      setCustomSubtitleCues(cues);
      setCustomSubtitleLabel(label);
      if (onSubtitleApplied) {
        onSubtitleApplied(sourceUrl
          ? { type: 'url', url: sourceUrl, label, from: '' }
          : { type: 'content', content: raw, label, from: '' });
      }
    }, [onSubtitleApplied]);

    // ── PWA / tab-switch recovery: resume ReactPlayer (YouTube/Twitch) ─────────
    useEffect(() => {
      if (isHls) return; // HLS handled in hls-player.tsx
      const onVisible = () => {
        if (document.hidden) return;
        setTimeout(() => {
          if (document.hidden) return;
          if (!ready || !reactPlayerRef.current) return;
          try {
            const ip = reactPlayerRef.current.getInternalPlayer();
            // YouTube: call playVideo() directly to resume after background freeze
            if (ip?.playVideo && playing) ip.playVideo();
            // Twitch/other HTML5: call play()
            else if (ip?.play && playing) ip.play().catch?.(() => {});
          } catch { /* ignore */ }
        }, 500);
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }, [isHls, ready, playing]);

    const handleError = useCallback((err: unknown) => {
      // YouTube IFrame API error codes (passed as numeric data)
      // 101 / 150 = video not allowed in embedded players → show "blocked" not error
      const ytCode = (err as { data?: number })?.data;
      if (ytCode === 101 || ytCode === 150) {
        setError('embed_blocked');
        return;
      }
      const e = err as { name?: string } | null;
      if (e?.name === 'NotAllowedError' || (typeof err === 'string' && err.toLowerCase().includes('not allowed'))) {
        setAutoplayBlocked(true);
        return;
      }
      // Generic YouTube errors (2=bad param, 5=html5, 100=not found) — show tap-to-play
      // instead of a hard error so the user can try manually
      if (typeof ytCode === 'number') {
        setAutoplayBlocked(true);
        return;
      }
      if (videoType === 'html5' && !proxyUrl && !nativeVideo) {
        const CF_PROXY = (import.meta.env.VITE_CF_PROXY_URL as string | undefined)?.replace(/\/$/, '');
        if (CF_PROXY) {
          const px = `${CF_PROXY}?url=${encodeURIComponent(normalizedUrl)}&ref=${encodeURIComponent(normalizedUrl)}&mode=video`;
          setProxyUrl(px);
          setError(null);
          setReady(false);
          return;
        }
        setNativeVideo(true);
        setError(null);
        setReady(false);
        return;
      }
      // If proxy also failed — last resort: try a bare <video> element with the
      // original URL (no ReactPlayer, no crossOrigin). Works for IP-locked CDN
      // tokens where only the user's browser IP is accepted.
      if (videoType === 'html5' && proxyUrl && !nativeVideo) {
        setNativeVideo(true);
        setProxyUrl(null);
        setError(null);
        setReady(false);
        return;
      }
      setError('playback');
    }, [videoType, normalizedUrl, proxyUrl, nativeVideo]);

    // ── HLS: custom player with built-in controls ────────────────────────────
    if (isHls) {
      return (
        <div ref={containerRef} className="absolute inset-0 bg-black">
          <HlsPlayer
            ref={hlsPlayerRef}
            src={normalizedUrl}
            playing={playing}
            canControl={canControl}
            initialTime={initialTime}
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
            onReady={onReady}
            containerRef={containerRef}
            chatMessages={chatMessages}
            username={username}
            onSendChatMessage={onSendChatMessage ?? (() => {})}
            onFocusChat={onFocusChat ?? (() => {})}
            lang={lang}
            onSubtitleApplied={onSubtitleApplied}
            externalSubtitle={externalSubtitle}
            isLiveHint={isLiveHint}
            onIsLive={onIsLive}
          />
        </div>
      );
    }

    // ── All other sources: ReactPlayer + custom overlay ──────────────────────
    return (
      <div
        ref={containerRef}
        className="absolute inset-0 bg-black"
        onMouseMove={resetOverlayTimer}
        onTouchStart={resetOverlayTimer}
      >
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
            <div className="text-center space-y-3 px-6">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
              <p className="text-white font-semibold">
                {error === 'embed_blocked'
                  ? t('videoNoEmbed')
                  : t('videoError')}
              </p>
              <p className="text-white/50 text-sm max-w-md">
                {error === 'embed_blocked'
                  ? t('videoNoEmbedDesc')
                  : t('videoErrorDesc')}
              </p>
            </div>
          </div>
        )}

        {autoplayBlocked && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 cursor-pointer"
            onClick={() => { setAutoplayBlocked(false); directPlay(); }}
          >
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mx-auto border border-white/30">
                <Play className="w-10 h-10 text-white fill-white" />
              </div>
              <p className="text-white/80 text-sm">{t('tapToPlay')}</p>
            </div>
          </div>
        )}

        <AnimatePresence>
          {sponsorSkipNotice && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-green-600/90 backdrop-blur px-4 py-2 rounded-full text-white text-sm font-medium shadow-lg flex items-center gap-2"
            >
              <SkipForward className="w-4 h-4" />
              {t('sponsorSkipped')}
            </motion.div>
          )}
        </AnimatePresence>

        {/* S3: last-resort native <video> — no crossOrigin, direct browser fetch */}
        {nativeVideo && (
          <video
            ref={nativeVideoRef}
            key={normalizedUrl + '__native'}
            src={normalizedUrl}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
            autoPlay={playing}
            playsInline
            controls={false}
            onLoadedMetadata={() => { setError(null); setReady(true); onReady?.(); }}
            onError={() => setError('playback')}
            onPlay={() => { setError(null); onPlay?.(); }}
            onPause={onPause}
          />
        )}

        <ReactPlayer
          key={proxyUrl ?? normalizedUrl}
          ref={reactPlayerRef}
          url={proxyUrl ?? normalizedUrl}
          width="100%"
          height="100%"
          playing={nativeVideo ? false : (autoplayBlocked ? false : playing)}
          controls={false}
          volume={rpMuted ? 0 : rpVolume}
          muted={rpMuted}
          playsinline
          onPlay={() => { setAutoplayBlocked(false); setError(null); onPlay?.(); }}
          onPause={onPause}
          onProgress={({ playedSeconds }) => {
            setRpCurrentTime(playedSeconds);
            if (sponsorSegments.length > 0 && isYouTubeUrl(normalizedUrl) && sponsorSkipEnabled) {
              const seg = findActiveSegment(sponsorSegments, playedSeconds, AD_CATEGORIES as unknown as string[]);
              if (seg && lastSkippedRef.current !== seg.UUID) {
                lastSkippedRef.current = seg.UUID;
                reactPlayerRef.current?.seekTo(seg.segment[1], 'seconds');
                setSponsorSkipNotice(true);
                setTimeout(() => setSponsorSkipNotice(false), 3000);
              }
            }
          }}
          onDuration={(d) => setRpDuration(d)}
          onSeek={onSeek}
          onReady={() => {
            setError(null);
            setReady(true);
            onReady?.();

            if (initialTime > 2) {
              try { reactPlayerRef.current?.seekTo(initialTime, 'seconds'); } catch {}
            }
          }}
          onError={handleError}
          style={{ position: 'absolute', top: 0, left: 0, display: nativeVideo ? 'none' : undefined }}
          config={{
            youtube: {
              playerVars: {
                origin: window.location.origin,
                rel: 0,
                iv_load_policy: 3,
                fs: 0,
                modestbranding: 1,
              },
            },
            twitch: {
              options: { parent: [window.location.hostname] },
            },
          }}
        />

        {!showOverlay && !error && (
          <div
            className="absolute inset-0 z-[9]"
            onMouseMove={resetOverlayTimer}
            onTouchStart={resetOverlayTimer}
            onClick={() => {
              if (getSettings().doubleClickFullscreen) {
                if (clickTimerRef.current) {
                  clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                  toggleReactPlayerFullscreen();
                  return;
                }
                clickTimerRef.current = setTimeout(() => {
                  clickTimerRef.current = null;
                  if (!playing && canControl) directPlay();
                  else resetOverlayTimer();
                }, 250);
              } else {
                if (!playing && canControl) directPlay();
                else resetOverlayTimer();
              }
            }}
          />
        )}


        {/* Full custom controls overlay */}
        <AnimatePresence>
          {showOverlay && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col justify-end select-none"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                if (getSettings().doubleClickFullscreen) {
                  if (clickTimerRef.current) {
                    clearTimeout(clickTimerRef.current);
                    clickTimerRef.current = null;
                    toggleReactPlayerFullscreen();
                    return;
                  }
                  clickTimerRef.current = setTimeout(() => {
                    clickTimerRef.current = null;
                    if (playing) directPause(); else directPlay();
                  }, 250);
                } else {
                  if (playing) directPause(); else directPlay();
                }
              }}
            >
              {/* Center play/pause indicator */}
              {!playing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur flex items-center justify-center border border-white/20">
                    <Play className="w-8 h-8 text-white fill-white ms-1" />
                  </div>
                </div>
              )}

              {/* Gradient + controls bar */}
              <div
                className="bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-16 pb-2 px-3 space-y-1"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Progress bar — blocked for guests */}
                <div className="relative">
                  {!canControl && (
                    <div
                      className="absolute inset-0 z-10 cursor-not-allowed"
                      onClickCapture={(e) => e.stopPropagation()}
                      onPointerDownCapture={(e) => e.stopPropagation()}
                      onTouchStartCapture={(e) => e.stopPropagation()}
                    />
                  )}
                  {rpDuration > 0 && (
                    <div
                      className={cn('py-2 group', canControl ? 'cursor-pointer' : 'cursor-default')}
                      onClick={(e) => {
                        if (!canControl) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
                        directSeek(ratio * rpDuration);
                      }}
                    >
                      <div className="h-1 md:h-1.5 bg-white/20 rounded-full relative">
                        <div
                          className={cn('absolute left-0 top-0 h-full rounded-full', canControl ? 'bg-primary' : 'bg-white/40')}
                          style={{ width: `${rpDuration > 0 ? (rpCurrentTime / rpDuration) * 100 : 0}%` }}
                        >
                          {canControl && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow" />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Buttons row — dir=ltr forces physical left→right */}
                <div className="flex items-center justify-between" dir="ltr">
                  {/* ── LEFT: lock badge · Back · Play/Pause · Forward · Time — blocked for guests ── */}
                  <div className="relative flex items-center">
                    {!canControl && (
                      <div
                        className="absolute inset-0 z-10 cursor-not-allowed"
                        onClickCapture={(e) => e.stopPropagation()}
                        onPointerDownCapture={(e) => e.stopPropagation()}
                        onTouchStartCapture={(e) => e.stopPropagation()}
                      />
                    )}
                    {!canControl && (
                      <div className="flex items-center gap-1 px-2 py-1 me-1 rounded-full bg-amber-500/20 border border-amber-400/30">
                        <Lock className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] text-amber-300 font-medium">
                          {t('viewOnly')}
                        </span>
                      </div>
                    )}
                    <button
                      className={cn('p-2.5 rounded-full transition', canControl ? 'text-white hover:bg-white/10 active:scale-90' : 'text-white/25 cursor-not-allowed')}
                      onClick={() => directSeek(Math.max(0, rpCurrentTime - 10))}
                      disabled={!canControl}
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>
                    <button
                      className={cn('p-2.5 rounded-full transition', canControl ? 'text-white hover:bg-white/10 active:scale-90' : 'text-white/25 cursor-not-allowed')}
                      onClick={() => { if (playing) directPause(); else directPlay(); }}
                      disabled={!canControl}
                    >
                      {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                    </button>
                    <button
                      className={cn('p-2.5 rounded-full transition', canControl ? 'text-white hover:bg-white/10 active:scale-90' : 'text-white/25 cursor-not-allowed')}
                      onClick={() => directSeek(rpCurrentTime + 10)}
                      disabled={!canControl}
                    >
                      <SkipForward className="w-5 h-5" />
                    </button>
                    {rpDuration > 0 && (
                      <span className="hidden sm:inline text-[11px] text-white/60 font-mono ms-0.5 tabular-nums">
                        {formatTime(rpCurrentTime)} / {formatTime(rpDuration)}
                      </span>
                    )}
                  </div>

                  {/* ── RIGHT: Subtitles · Volume · Chat · Fullscreen — always interactive for ALL users ── */}
                  <div className="flex items-center">
                    {/* Subtitles */}
                    <button
                      className={cn(
                        'p-2.5 rounded-full hover:bg-white/10 transition text-white',
                        customSubtitleCues.length > 0 && 'text-primary',
                      )}
                      onClick={() => setShowSubtitleSearch(true)}
                    >
                      <Subtitles className="w-5 h-5" />
                    </button>
                    <button
                      className="p-2.5 text-white hover:bg-white/10 rounded-full transition"
                      onClick={() => setRpMuted((m) => !m)}
                    >
                      {rpMuted || rpVolume === 0
                        ? <VolumeX className="w-5 h-5" />
                        : <Volume2 className="w-5 h-5" />
                      }
                    </button>
                    <button
                      className={cn('p-2.5 text-white hover:bg-white/10 rounded-full transition', isChatOpen && 'text-primary bg-white/10')}
                      onClick={handleToggleChatReactPlayer}
                    >
                      <MessageSquare className="w-5 h-5" />
                    </button>
                    <button
                      className="p-2.5 text-white hover:bg-white/10 rounded-full transition"
                      onClick={toggleReactPlayerFullscreen}
                    >
                      {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom subtitle overlay */}
        {currentSubtitleText && (
          <div
            className="absolute inset-x-0 bottom-16 z-10 flex justify-center pointer-events-none px-4"
            style={{ userSelect: 'none' }}
          >
            <div
              className="text-white text-center font-medium leading-snug px-3 py-1.5 rounded-lg max-w-[90%]"
              style={{
                fontSize: 'clamp(13px, 2.2vw, 20px)',
                textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
                background: 'rgba(0,0,0,0.45)',
                whiteSpace: 'pre-line',
              }}
            >
              {currentSubtitleText}
            </div>
          </div>
        )}

        {/* Fullscreen chat panel */}
        <FullscreenChat
          isOpen={isChatOpen && isFullscreen}
          onClose={() => setIsChatOpen(false)}
          messages={chatMessages}
          username={username}
          onSend={onSendChatMessage ?? (() => {})}
          lang={lang}
        />

        {/* Toast notifications — bottom-right, 5s, fullscreen only */}
        <div className="absolute bottom-16 right-4 z-40 flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {toastQueue.map((msg) => (
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
                  <p className="text-[11px] font-semibold text-white/60 mb-0.5">{msg.username}</p>
                  <p className="text-sm text-white break-words">{msg.content}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {/* Subtitle search dialog */}
        <SubtitleSearch
          isOpen={showSubtitleSearch}
          onClose={() => setShowSubtitleSearch(false)}
          onApply={handleApplySubtitle}
          lang={lang}
        />
      </div>
    );
  },
);

SmartPlayer.displayName = 'SmartPlayer';
