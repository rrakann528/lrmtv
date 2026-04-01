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
  MessageSquare, SkipBack, SkipForward, Volume2, VolumeX, Lock,
  MoreVertical, ChevronRight, ChevronLeft, Check,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { enterFullscreen, exitFullscreen, isFullscreenActive, isSimulatedFullscreen, onFullscreenChange } from '@/lib/fullscreen';
import { HlsPlayer, type HlsPlayerHandle } from './hls-player';
import FullscreenChat from './fullscreen-chat';
import SubtitleSearch from './subtitle-search';
import { generateColorFromString, cn } from '@/lib/utils';
import type { ToastMessage } from './player-controls';
import { fetchSponsorSegments, findActiveSegment, isYouTubeUrl, type SponsorSegment } from '@/lib/sponsorblock';

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

export interface RoomEventNotif {
  id: string;
  username: string;
  type: 'join' | 'leave';
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
  /** User join/leave notifications to show as fullscreen overlays */
  roomNotifications?: RoomEventNotif[];
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
      roomNotifications = [],
    },
    ref,
  ) => {
    const reactPlayerRef = useRef<ReactPlayer>(null);
    const hlsPlayerRef = useRef<HlsPlayerHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [showOverlay, setShowOverlay] = useState(true);
    const [toastQueue, setToastQueue] = useState<ToastMessage[]>([]);
    const prevMsgCountRef = useRef(0);
    const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // pendingPlayRef: set when play() is called via imperative handle but the YouTube
    // internal player isn't initialized yet. Consumed in onReady to flush the request.
    const pendingPlayRef = useRef(false);
    // Mirror of the playing prop so onReady can read the latest value without stale closure
    const playingRef = useRef(playing);
    useEffect(() => { playingRef.current = playing; }, [playing]);
    // ReactPlayer playback tracking
    const [rpCurrentTime, setRpCurrentTime] = useState(0);
    const [rpDuration, setRpDuration] = useState(0);
    const [rpVolume, setRpVolume] = useState(1);
    const [rpMuted, setRpMuted] = useState(false);
    const [mutedAutoplay, setMutedAutoplay] = useState(false);

    // ── YouTube mute sync: after every render where rpMuted changes, push state
    // directly to the IFrame API. ReactPlayer's own prop handling can race with
    // the IFrame API on mobile — this effect fires *after* ReactPlayer has
    // processed the new props, so it always wins.
    const rpMutedRef = useRef(rpMuted);
    useEffect(() => {
      rpMutedRef.current = rpMuted;
      if (isHls) return;
      const timer = setTimeout(() => {
        try {
          const ip = reactPlayerRef.current?.getInternalPlayer() as any;
          if (!ip) return;
          if (rpMuted) {
            if (ip.mute) ip.mute();
          } else {
            if (ip.unMute) ip.unMute();
            if (ip.setVolume) ip.setVolume(100);
          }
        } catch {}
      }, 80);
      return () => clearTimeout(timer);
    // isHls is intentionally omitted from deps — it's declared later in the
    // function body and would cause a TDZ error in the dep array.
    // The callback closure always captures the correct value at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rpMuted]);

    // ── Subtitle state (ReactPlayer branch only) ─────────────────────────────
    const [showSubtitleSearch, setShowSubtitleSearch] = useState(false);
    const [customSubtitleCues, setCustomSubtitleCues] = useState<SubtitleCue[]>([]);
    const [currentSubtitleText, setCurrentSubtitleText] = useState('');
    const [customSubtitleLabel, setCustomSubtitleLabel] = useState('');

    const [sponsorSegments, setSponsorSegments] = useState<SponsorSegment[]>([]);
    const lastSkippedRef = useRef<string | null>(null);
    const [sponsorSkipNotice, setSponsorSkipNotice] = useState(false);

    // ReactPlayer settings menu state
    type RpSettingsView = null | 'main' | 'fit' | 'subtitle';
    const [rpSettingsView, setRpSettingsView] = useState<RpSettingsView>(null);
    const [rpSubtitleFontSize, setRpSubtitleFontSize] = useState(100);
    const [rpSubtitleHasBg, setRpSubtitleHasBg] = useState(true);
    const [rpVideoFit, setRpVideoFit] = useState<'contain' | 'cover' | 'fill'>('contain');
    const rpLastTouchTimeRef = useRef(0);

    const { t } = useI18n();

    const normalizedUrl = normalizeUrl(url);
    const videoType = detectVideoType(normalizedUrl);
    const isHls = videoType === 'hls';

    // On iOS Safari, direct mp4/html5 video works natively without proxy.
    const isIosBrowser = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Types that could potentially bypass the proxy if the server allows CORS
    const mightNeedProxy = isIosBrowser
      ? (videoType === 'hls' || videoType === 'dash')
      : (videoType === 'hls' || videoType === 'dash' || videoType === 'html5');

    const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(normalizedUrl)}`;

    // ── Smart proxy resolution ────────────────────────────────────────────────
    // Player is hidden (corsChecking=true) until the CORS HEAD check resolves.
    // This guarantees Cast/AirPlay only ever sees ONE video source — never
    // the proxy first and then the direct URL.
    const [playableUrl, setPlayableUrl] = useState<string>(
      mightNeedProxy ? proxyUrl : normalizedUrl
    );
    const [corsChecking, setCorsChecking] = useState(mightNeedProxy);

    useEffect(() => {
      if (!mightNeedProxy) {
        // YouTube / Twitch / non-proxied — set immediately, no check needed
        setPlayableUrl(normalizedUrl);
        setCorsChecking(false);
        return;
      }

      // Hold playback until we know which URL wins
      setPlayableUrl(proxyUrl);
      setCorsChecking(true);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500); // 2.5 s max wait

      fetch(normalizedUrl, {
        method: 'HEAD',
        mode: 'cors',
        signal: controller.signal,
      })
        .then((res) => {
          // Any response (even 4xx) means CORS headers were present → direct OK
          if (res.status < 500) {
            setPlayableUrl(normalizedUrl);
          }
          // 5xx or unreachable → keep proxy URL already set above
        })
        .catch(() => {
          // NetworkError = CORS blocked or server unreachable → keep proxy
        })
        .finally(() => {
          clearTimeout(timer);
          // Reveal the player now that we have a definitive URL
          setCorsChecking(false);
        });

      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedUrl]);

    useEffect(() => {
      setError(null);
      setReady(false);
      setAutoplayBlocked(false);
      lastSkippedRef.current = null;
      setSponsorSegments([]);
      pendingPlayRef.current = false;
      if (isYouTubeUrl(normalizedUrl)) {
        fetchSponsorSegments(normalizedUrl, setSponsorSegments);
        // Always start YouTube muted to bypass browser autoplay policy
        setRpMuted(true);
        setMutedAutoplay(true);
      } else {
        setMutedAutoplay(false);
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
      // Only auto-hide when playing and settings not open; keep visible when paused
      if (playing && rpSettingsView === null) {
        overlayTimerRef.current = setTimeout(() => setShowOverlay(false), 4000);
      }
    }, [playing, rpSettingsView]);

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
          if (ip?.playVideo) { ip.playVideo(); return; }
          if (ip?.play)      { ip.play().catch?.(() => {}); return; }
        } catch {}
        // Internal player not ready yet — store the request so onReady flushes it.
        // This handles the case where the user clicks "Press to Watch" before the
        // YouTube IFrame API has fully initialised.
        pendingPlayRef.current = true;
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

    // ── Apply video fit (aspect ratio) for ReactPlayer sources ─────────────────
    // For HTML5 <video>: objectFit is applied directly.
    // For YouTube/iframe: the iframe is scaled via transform to simulate contain/cover/fill.
    useEffect(() => {
      if (isHls) return;
      const container = containerRef.current;
      if (!container) return;

      const apply = () => {
        const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
        const videoEl = container.querySelector('video') as HTMLVideoElement | null;

        if (videoEl) {
          videoEl.style.objectFit = rpVideoFit === 'contain' ? 'contain' : rpVideoFit === 'cover' ? 'cover' : 'fill';
          return;
        }

        if (!iframe) return;

        // Ensure the container clips overflowing content when scaled beyond bounds
        container.style.overflow = rpVideoFit !== 'contain' ? 'hidden' : '';

        if (rpVideoFit === 'contain') {
          iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;transform:none;';
        } else if (rpVideoFit === 'cover') {
          // Scale the 16:9 iframe so it fully covers the container without black bars
          const { width: cw, height: ch } = container.getBoundingClientRect();
          if (!cw || !ch) return;
          const videoRatio = 16 / 9;
          const containerRatio = cw / ch;
          const scale = containerRatio > videoRatio
            ? containerRatio / videoRatio   // wider container: scale by x
            : videoRatio / containerRatio;  // taller container: scale by y
          iframe.style.cssText = `position:absolute;top:50%;left:50%;width:100%;height:100%;transform:translate(-50%,-50%) scale(${scale.toFixed(4)});transform-origin:center;`;
        } else {
          // fill: stretch the iframe to fill the container ignoring aspect ratio
          const { width: cw, height: ch } = container.getBoundingClientRect();
          if (!cw || !ch) return;
          const videoRatio = 16 / 9;
          const containerRatio = cw / ch;
          const scaleX = containerRatio > videoRatio ? containerRatio / videoRatio : 1;
          const scaleY = containerRatio < videoRatio ? videoRatio / containerRatio : 1;
          iframe.style.cssText = `position:absolute;top:50%;left:50%;width:100%;height:100%;transform:translate(-50%,-50%) scaleX(${scaleX.toFixed(4)}) scaleY(${scaleY.toFixed(4)});transform-origin:center;`;
        }
      };

      apply();
      const ro = new ResizeObserver(apply);
      ro.observe(container);
      return () => ro.disconnect();
    }, [rpVideoFit, isHls, ready]);

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

    // Belt-and-suspenders: when playing transitions false→true and the player is
    // already ready, call playVideo() directly.  ReactPlayer does the same internally
    // but this catches any edge-cases where its internal call doesn't fire.
    const prevPlayingForForceRef = useRef(false);
    useEffect(() => {
      if (isHls) { prevPlayingForForceRef.current = playing; return; }
      const was = prevPlayingForForceRef.current;
      prevPlayingForForceRef.current = playing;
      if (playing && !was && ready) {
        try {
          const ip = reactPlayerRef.current?.getInternalPlayer();
          if (ip?.playVideo) ip.playVideo();
        } catch {}
      }
    }, [playing, isHls, ready]);

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
        // Autoplay blocked → show "Press to Watch" button so user can start with a gesture
        setRpMuted(true);
        setMutedAutoplay(true);
        setAutoplayBlocked(true);
        return;
      }
      // Generic YouTube errors (2=bad param, 5=html5, 100=not found) — try muted autoplay
      if (typeof ytCode === 'number') {
        setRpMuted(true);
        setMutedAutoplay(true);
        return;
      }
      setError('playback');
    }, [videoType, normalizedUrl]);

    // ── HLS: custom player with built-in controls ────────────────────────────
    if (isHls) {
      return (
        <div ref={containerRef} className="absolute inset-0 bg-black">
          {/* While the CORS check is running, hide the player entirely so
              Cast/AirPlay only ever sees ONE video source (no proxy→direct switch). */}
          {corsChecking ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-[12px] text-white/60">
                {lang === 'ar' ? 'جارٍ التحقق من الاتصال…' : 'Checking connection…'}
              </span>
            </div>
          ) : (
            <>
              <HlsPlayer
                key={playableUrl}
                ref={hlsPlayerRef}
                src={playableUrl}
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
              {/* Join/leave toast notifications — bottom-right, fullscreen only */}
              <div className="absolute bottom-20 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none">
                <AnimatePresence>
                  {roomNotifications.map((n) => (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: 30, scale: 0.92 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 30, scale: 0.92 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                      className="flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-2xl rounded-br-sm px-3 py-2 shadow-xl border border-white/10 max-w-[220px]"
                      dir="rtl"
                    >
                      <div
                        className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ backgroundColor: generateColorFromString(n.username) }}
                      >
                        {n.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="text-[11px] font-semibold text-white/80 leading-none">{n.username}</p>
                        <p className={`text-[10px] mt-0.5 leading-none ${n.type === 'join' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {n.type === 'join'
                            ? (lang === 'ar' ? 'دخل الغرفة' : 'joined')
                            : (lang === 'ar' ? 'غادر الغرفة' : 'left')}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}
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

        {/* "Press to Watch" overlay — shown when browser blocks autoplay entirely */}
        <AnimatePresence>
          {autoplayBlocked && !error && (
            <motion.div
              key="autoplay-blocked-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setAutoplayBlocked(false);
                setRpMuted(true);
                setMutedAutoplay(true);
                // Must play inside user gesture — call YouTube IFrame API directly
                try {
                  const ip = reactPlayerRef.current?.getInternalPlayer() as any;
                  if (ip?.playVideo) ip.playVideo();
                } catch {}
              }}
            >
              <div className="flex flex-col items-center gap-3 select-none">
                <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur">
                  <Play className="w-7 h-7 text-white fill-white translate-x-0.5" />
                </div>
                <span className="text-white font-semibold text-base">
                  {lang === 'ar' ? 'اضغط للمشاهدة' : 'Tap to watch'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mutedAutoplay && !error && (
            <motion.div
              key="muted-autoplay-banner"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 cursor-pointer"
              onClick={() => {
                setRpMuted(false);
                setMutedAutoplay(false);
                // useEffect handles direct YouTube IFrame API call after render
              }}
            >
              <div className="flex items-center gap-2 bg-black/75 backdrop-blur-md rounded-full px-4 py-2 border border-white/15 shadow-xl select-none">
                <VolumeX className="w-4 h-4 text-white/80 shrink-0" />
                <span className="text-white/90 text-sm font-medium whitespace-nowrap">
                  {lang === 'ar' ? 'الصوت مكتوم — اضغط لرفع الصوت' : 'Muted — tap to unmute'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

        <ReactPlayer
          key={normalizedUrl}
          ref={reactPlayerRef}
          url={playableUrl}
          width="100%"
          height="100%"
          playing={playing}
          controls={false}
          volume={rpMuted ? 0 : rpVolume}
          muted={rpMuted}
          playsinline
          onPlay={() => { setAutoplayBlocked(false); setError(null); onPlay?.(); }}
          onPause={onPause}
          onProgress={({ playedSeconds }) => {
            setRpCurrentTime(playedSeconds);
            if (sponsorSkipEnabled && sponsorSegments.length > 0 && isYouTubeUrl(normalizedUrl)) {
              const seg = findActiveSegment(sponsorSegments, playedSeconds);
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

            // Flush a pending play that was requested while the player was still
            // loading (e.g. user clicked "Press to Watch" before onReady fired).
            // Also cover the common case where playing=true is already set but
            // ReactPlayer's own internal play() hasn't executed yet.
            if (pendingPlayRef.current || playingRef.current) {
              pendingPlayRef.current = false;
              try {
                const ip = reactPlayerRef.current?.getInternalPlayer();
                if (ip?.playVideo) ip.playVideo();
              } catch {}
            }
          }}
          onError={handleError}
          style={{ position: 'absolute', top: 0, left: 0 }}
          config={{
            youtube: {
              playerVars: {
                origin: window.location.origin,
                rel: 0,
                iv_load_policy: 3,
                fs: 0,
                modestbranding: 1,
                autoplay: 1,
                mute: 1,
              },
            },
            twitch: {
              options: { parent: [window.location.hostname] },
            },
          }}
        />

        {/* Tap-catcher: when controls are hidden, tap anywhere to show them */}
        {!showOverlay && !error && (
          <div
            className="absolute inset-0 z-[9]"
            onMouseMove={resetOverlayTimer}
            onTouchStart={resetOverlayTimer}
            onClick={() => {
              resetOverlayTimer();
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
              onTouchStart={() => { rpLastTouchTimeRef.current = Date.now(); }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  resetOverlayTimer();
                }
              }}
            >
              {/* ── Three-dots settings button — top-left ── */}
              <div
                className="absolute left-2 z-30"
                style={{ top: 'calc(8px + env(safe-area-inset-top, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className={cn(
                    'p-2 rounded-full transition bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm',
                    rpSettingsView !== null && 'bg-black/60',
                  )}
                  onClick={() => setRpSettingsView(v => v === null ? 'main' : null)}
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
                <AnimatePresence>
                  {rpSettingsView !== null && (() => {
                    const rpFitLabels = {
                      contain: { ar: 'عادي', en: 'Normal' },
                      cover:   { ar: 'تملأ الشاشة', en: 'Fill' },
                      fill:    { ar: 'ممتد', en: 'Stretch' },
                    } as const;
                    const rpFontSizes = [
                      { value: 75,  label: { ar: 'صغير', en: 'Small' } },
                      { value: 100, label: { ar: 'متوسط', en: 'Medium' } },
                      { value: 130, label: { ar: 'كبير', en: 'Large' } },
                      { value: 170, label: { ar: 'كبير جداً', en: 'X-Large' } },
                    ];
                    const renderRpSettings = () => {
                      if (rpSettingsView === 'fit') {
                        return (
                          <>
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                              <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setRpSettingsView('main')}>
                                <ChevronLeft className="w-4 h-4 text-white" />
                              </button>
                              <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'نسبة الصورة' : 'Aspect Ratio'}</span>
                            </div>
                            <div className="py-1">
                              {(['contain', 'cover', 'fill'] as const).map(f => (
                                <button
                                  key={f}
                                  className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/10 transition"
                                  onClick={() => { setRpVideoFit(f); setRpSettingsView(null); }}
                                >
                                  <span className={cn(f === rpVideoFit ? 'text-primary font-medium' : 'text-white/80')}>
                                    {rpFitLabels[f][lang === 'ar' ? 'ar' : 'en']}
                                  </span>
                                  {f === rpVideoFit && <Check className="w-4 h-4 text-primary" />}
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      }
                      if (rpSettingsView === 'subtitle') {
                        return (
                          <>
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                              <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setRpSettingsView('main')}>
                                <ChevronLeft className="w-4 h-4 text-white" />
                              </button>
                              <span className="text-sm font-semibold text-white">{lang === 'ar' ? 'إعدادات الترجمة' : 'Subtitle Style'}</span>
                            </div>
                            <div className="p-3 space-y-4">
                              <div>
                                <p className="text-xs text-white/50 mb-2">{lang === 'ar' ? 'حجم الخط' : 'Font Size'}</p>
                                <div className="flex gap-1.5">
                                  {rpFontSizes.map(fs => (
                                    <button
                                      key={fs.value}
                                      className={cn(
                                        'flex-1 py-1.5 rounded-lg text-xs font-medium transition border',
                                        rpSubtitleFontSize === fs.value
                                          ? 'bg-primary/20 border-primary text-primary'
                                          : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10',
                                      )}
                                      onClick={() => setRpSubtitleFontSize(fs.value)}
                                    >
                                      {fs.label[lang === 'ar' ? 'ar' : 'en']}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-white/80">{lang === 'ar' ? 'خلفية الترجمة' : 'Background'}</span>
                                <button
                                  className={cn('relative w-11 h-6 rounded-full transition-colors', rpSubtitleHasBg ? 'bg-primary' : 'bg-white/20')}
                                  onClick={() => setRpSubtitleHasBg(b => !b)}
                                >
                                  <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all', rpSubtitleHasBg ? 'left-6' : 'left-1')} />
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
                            <button
                              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
                              onClick={() => setRpSettingsView('fit')}
                            >
                              <div className="flex items-center gap-2.5">
                                <span>▢</span>
                                <span className="text-white/90">{lang === 'ar' ? 'نسبة الصورة' : 'Aspect Ratio'}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-white/40">{rpFitLabels[rpVideoFit][lang === 'ar' ? 'ar' : 'en']}</span>
                                <ChevronRight className="w-4 h-4 text-white/30" />
                              </div>
                            </button>
                            <button
                              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10 transition"
                              onClick={() => setRpSettingsView('subtitle')}
                            >
                              <div className="flex items-center gap-2.5">
                                <span>CC</span>
                                <span className="text-white/90">{lang === 'ar' ? 'إعدادات الترجمة' : 'Subtitle Style'}</span>
                              </div>
                              <ChevronRight className="w-4 h-4 text-white/30" />
                            </button>
                            <div className="border-t border-white/10 mt-1 pt-1">
                              <button
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/10 transition"
                                onClick={() => { setShowSubtitleSearch(true); setRpSettingsView(null); }}
                              >
                                <span>🔍</span>
                                <span className="text-white/70">{lang === 'ar' ? 'البحث عن ترجمة' : 'Search Subtitle'}</span>
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    };
                    return (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-10 left-0 w-64 bg-zinc-900/97 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                      >
                        {renderRpSettings()}
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>

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

                  {/* ── RIGHT: Volume · Chat · Fullscreen — always interactive for ALL users ── */}
                  <div className="flex items-center">
                    <button
                      className="p-2.5 text-white hover:bg-white/10 rounded-full transition"
                      onClick={() => {
                        if (rpMuted) setMutedAutoplay(false);
                        setRpMuted(m => !m);
                        // useEffect handles direct YouTube IFrame API call after render
                      }}
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
                fontSize: `clamp(${Math.round(13 * rpSubtitleFontSize / 100)}px, ${(2.2 * rpSubtitleFontSize / 100).toFixed(2)}vw, ${Math.round(20 * rpSubtitleFontSize / 100)}px)`,
                textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
                background: rpSubtitleHasBg ? 'rgba(0,0,0,0.45)' : 'transparent',
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

        {/* Room event notifications (join/leave) — bottom-right, styled as chat bubble */}
        <div className="absolute bottom-20 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none">
          <AnimatePresence>
            {roomNotifications.map((n) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, x: 30, scale: 0.92 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 30, scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-2xl rounded-br-sm px-3 py-2 shadow-xl border border-white/10 max-w-[220px]"
                dir="rtl"
              >
                <div
                  className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: generateColorFromString(n.username) }}
                >
                  {n.username.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[11px] font-semibold text-white/80 leading-none">{n.username}</p>
                  <p className={`text-[10px] mt-0.5 leading-none ${n.type === 'join' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {n.type === 'join'
                      ? (lang === 'ar' ? 'دخل الغرفة' : 'joined')
                      : (lang === 'ar' ? 'غادر الغرفة' : 'left')}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

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
