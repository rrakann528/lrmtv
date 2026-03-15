import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from 'react';
import Hls from 'hls.js';
import { Play, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { onFullscreenChange } from '@/lib/fullscreen';
import PlayerControls, { type SubtitleTrack, type ToastMessage } from './player-controls';
import FullscreenChat from './fullscreen-chat';
import SubtitleSearch from './subtitle-search';
import { type ChatMessage } from './smart-player';

// ── SRT / VTT parser ─────────────────────────────────────────────────────────
interface SubtitleCue { start: number; end: number; text: string }

function parseSrtTime(t: string): number {
  // Handle both SRT (00:00:00,000) and VTT (00:00:00.000) formats
  const clean = t.replace(',', '.').trim();
  const parts = clean.split(':');
  if (parts.length < 3) return 0;
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function parseSubtitles(raw: string): SubtitleCue[] {
  // 1. Strip UTF-8 BOM (0xEF 0xBB 0xBF) if present
  const withoutBom = raw.replace(/^\uFEFF/, '');
  // 2. Normalize line endings: \r\n → \n, lone \r → \n
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
    // End time may be followed by position tags (X1:... etc.) — take first token only
    const endStr = timeLine.slice(arrowIdx + 3).trim().split(/\s+/)[0];

    const start = parseSrtTime(startStr);
    const end   = parseSrtTime(endStr);
    if (isNaN(start) || isNaN(end)) continue;

    // Everything after the time line, excluding pure numeric sequence numbers
    const textLines = lines
      .slice(lines.indexOf(timeLine) + 1)
      .filter(l => l.trim() && !/^\d+$/.test(l.trim()));

    const cueText = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '')  // strip HTML/SSA tags
      .replace(/\{[^}]+\}/g, '') // strip {ASS} override blocks
      .trim();

    if (cueText) cues.push({ start, end, text: cueText });
  }
  return cues;
}

export interface SubtitleSyncPayload {
  type: 'url' | 'content' | 'clear';
  url?: string;
  content?: string;
  label?: string;
  from: string;
}

interface HlsPlayerProps {
  src: string;
  playing: boolean;
  canControl?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
  username: string;
  onSendChatMessage: (content: string) => void;
  onFocusChat: () => void;
  lang?: 'en' | 'ar';
  /** Called when the local user applies a subtitle — emit to socket */
  onSubtitleApplied?: (payload: SubtitleSyncPayload) => void;
  /** Incoming subtitle from a room peer — apply silently */
  externalSubtitle?: SubtitleSyncPayload | null;
}

export interface HlsPlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
}

export const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      src,
      playing,
      canControl = true,
      onPlay,
      onPause,
      onSeek,
      containerRef,
      chatMessages,
      username,
      onSendChatMessage,
      onFocusChat,
      lang = 'en',
      onSubtitleApplied,
      externalSubtitle,
    },
    ref,
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef   = useRef<Hls | null>(null);
    const dashRef  = useRef<{ destroy: () => void } | null>(null);
    const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const forceProxyFnRef = useRef<(() => void) | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
    const [activeSubtitleId, setActiveSubtitleId] = useState(-1);
    const [isLive, setIsLive] = useState(false);
    const [toastQueue, setToastQueue] = useState<ToastMessage[]>([]);
    const prevMsgCountRef = useRef(0);
    const { t } = useI18n();

    // Custom subtitle state (loaded from SubtitleSearch)
    const [customSubtitleCues, setCustomSubtitleCues] = useState<SubtitleCue[]>([]);
    const [customSubtitleLabel, setCustomSubtitleLabel] = useState('');
    const [currentSubtitleText, setCurrentSubtitleText] = useState('');
    const [showSubtitleSearch, setShowSubtitleSearch] = useState(false);
    const subtitleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Poll video.currentTime to find the active subtitle cue
    useEffect(() => {
      if (subtitleIntervalRef.current) clearInterval(subtitleIntervalRef.current);
      if (customSubtitleCues.length === 0) { setCurrentSubtitleText(''); return; }
      subtitleIntervalRef.current = setInterval(() => {
        const videoTime = videoRef.current?.currentTime ?? 0;
        const cue = customSubtitleCues.find(c => videoTime >= c.start && videoTime <= c.end);
        setCurrentSubtitleText(cue?.text ?? '');
      }, 200);
      return () => { if (subtitleIntervalRef.current) clearInterval(subtitleIntervalRef.current); };
    }, [customSubtitleCues]);

    const handleApplySubtitle = useCallback((raw: string, label: string, sourceUrl?: string) => {
      const cues = parseSubtitles(raw);
      setCustomSubtitleCues(cues);
      setCustomSubtitleLabel(label);
      setActiveSubtitleId(-2);
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      // Notify room peers
      if (onSubtitleApplied) {
        onSubtitleApplied(sourceUrl
          ? { type: 'url', url: sourceUrl, label, from: '' }
          : { type: 'content', content: raw, label, from: '' });
      }
    }, [onSubtitleApplied]);

    // Apply subtitle coming from a room peer
    useEffect(() => {
      if (!externalSubtitle) return;
      if (externalSubtitle.type === 'clear') {
        setCustomSubtitleCues([]);
        setCustomSubtitleLabel('');
        setCurrentSubtitleText('');
        setActiveSubtitleId(-1);
        return;
      }
      if (externalSubtitle.type === 'content' && externalSubtitle.content) {
        setCustomSubtitleCues(parseSubtitles(externalSubtitle.content));
        setCustomSubtitleLabel(externalSubtitle.label ?? '');
        setActiveSubtitleId(-2);
        if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      } else if (externalSubtitle.type === 'url' && externalSubtitle.url) {
        // Fetch through proxy so we have the text
        fetch(`/api/proxy/subtitle?url=${encodeURIComponent(externalSubtitle.url)}`)
          .then(r => r.ok ? r.text() : Promise.reject(r.status))
          .then(text => {
            setCustomSubtitleCues(parseSubtitles(text));
            setCustomSubtitleLabel(externalSubtitle.label ?? '');
            setActiveSubtitleId(-2);
            if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
          })
          .catch(err => console.warn('[subtitle] failed to fetch external URL', err));
      }
    }, [externalSubtitle]);

    const handleRetry = useCallback(() => {
      setError(null);
      setAutoplayBlocked(false);
      setRetryKey((k) => k + 1);
    }, []);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      seekTo: (time: number) => { if (videoRef.current) videoRef.current.currentTime = time; },
      play: () => { videoRef.current?.play().catch(() => {}); },
      pause: () => { videoRef.current?.pause(); },
    }));

    // ── Universal player — detect stream type then route to best engine ────────
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;

      setError(null);
      setStatusMsg(null);
      setAutoplayBlocked(false);
      setSubtitleTracks([]);
      setActiveSubtitleId(-1);

      if (reconnTimerRef.current) { clearTimeout(reconnTimerRef.current); reconnTimerRef.current = null; }

      let cancelled = false;

      // ── Destroy all active engines ────────────────────────────────────────
      const destroyAll = () => {
        hlsRef.current?.destroy();  hlsRef.current  = null;
        if (dashRef.current) {
          try { dashRef.current.destroy(); } catch { /* ignore */ }
          dashRef.current = null;
        }
        if (video.src) { video.src = ''; }
      };

      // ── Duration / live detection ─────────────────────────────────────────
      const onDurationChange = () => {
        const d = video.duration;
        if (!isNaN(d)) setIsLive(!d || !isFinite(d) || d === Infinity);
      };
      video.addEventListener('durationchange', onDurationChange);

      const HLS_CONFIG: Partial<Hls['config']> = {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 45,
        maxMaxBufferLength: 90,
        manifestLoadingMaxRetry: 1,
        manifestLoadingTimeOut: 8000,
        manifestLoadingRetryDelay: 500,
        levelLoadingMaxRetry: 3,
        levelLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 4,
        fragLoadingTimeOut: 20000,
        fragLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 1_000_000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.6,
        testBandwidth: false,
        progressive: true,
        nudgeMaxRetry: 5,
        nudgeOffset: 0.2,
      };

      // ── S-Native: HTML5 <video> element (MP4, WebM, native HLS on Safari) ─
      const loadViaNative = (nativeSrc?: string, _isCfRetry = false) => {
        if (cancelled) return;
        destroyAll();
        setStatusMsg('native');
        video.removeAttribute('crossorigin');
        video.setAttribute('referrerpolicy', 'no-referrer');
        const targetSrc = nativeSrc ?? src;
        video.src = targetSrc;
        const onMeta = () => { if (!cancelled) { setIsLive(!isFinite(video.duration) || video.duration === Infinity); setStatusMsg(null); setError(null); } };
        const onErr  = () => {
          if (cancelled) return;
          // If direct load failed and we haven't tried CF proxy yet, try through it
          if (!_isCfRetry) {
            const cfUrl = buildCfUrl(targetSrc);
            if (cfUrl) { loadViaNative(cfUrl, true); return; }
          }
          const code = video.error?.code;
          setError(code === 4 ? 'unsupported' : 'ip-locked');
          setStatusMsg(null);
        };
        video.addEventListener('loadedmetadata', onMeta, { once: true });
        video.addEventListener('error',          onErr,  { once: true });
      };

      // ── S-Dash: dash.js (dynamic import to avoid ESM issues) ─────────────
      const loadViaDash = async () => {
        if (cancelled) return;
        destroyAll();
        setStatusMsg('dash');
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const djs: any = await import('dashjs');
          if (cancelled) return;
          const MediaPlayer = (djs.MediaPlayer ?? djs.default?.MediaPlayer);
          const player = MediaPlayer().create();
          dashRef.current = player as { destroy: () => void };
          player.initialize(video, src, false);
          const Events = (djs.MediaPlayer?.events ?? djs.default?.MediaPlayer?.events ?? {});
          player.on(Events.STREAM_INITIALIZED ?? 'streamInitialized', () => { if (!cancelled) { setStatusMsg(null); setError(null); onDurationChange(); } });
          player.on(Events.ERROR ?? 'error', () => { if (!cancelled) { setError('ip-locked'); setStatusMsg(null); } });
        } catch {
          if (!cancelled) loadViaHls();
        }
      };

      // CF Worker URL (optional — set VITE_CF_PROXY_URL to enable hard-link support)
      const CF_PROXY = (import.meta.env.VITE_CF_PROXY_URL as string | undefined)?.replace(/\/$/, '');
      const buildCfUrl = (url: string, mode?: string) => {
        if (!CF_PROXY) return null;
        return `${CF_PROXY}?ref=${encodeURIComponent(url)}&url=${encodeURIComponent(url)}${mode ? `&mode=${mode}` : ''}`;
      };

      // Show proxy-required button (only shown if CF Worker is configured)
      const requireProxy = (fn: () => void) => {
        if (!CF_PROXY) { setStatusMsg(null); setError('unsupported'); return; }
        forceProxyFnRef.current = fn;
        setStatusMsg(null);
        setError('proxy-required');
      };

      // ── Stall watchdog — detects frozen playback and nudges forward ─────────
      let stallWatchdog: ReturnType<typeof setInterval> | null = null;
      const startStallWatchdog = () => {
        if (stallWatchdog) clearInterval(stallWatchdog);
        let lastTime = -1;
        let stalledFor = 0;
        stallWatchdog = setInterval(() => {
          if (cancelled || !video || video.paused || video.ended) return;
          const now = video.currentTime;
          // Only fire on readyState < 3 (no future data at all) to avoid false positives
          if (now === lastTime && video.readyState < 3) {
            stalledFor += 1;
            if (stalledFor >= 5) {  // 10 seconds of true stall before acting
              stalledFor = 0;
              const buf = video.buffered;
              if (buf.length > 0) {
                const ahead = buf.end(buf.length - 1) - now;
                if (ahead > 0.5) {
                  video.currentTime = now + 0.1;
                } else if (hlsRef.current) {
                  hlsRef.current.startLoad();
                }
              } else if (hlsRef.current) {
                hlsRef.current.startLoad();
              }
            }
          } else {
            stalledFor = 0;
          }
          lastTime = now;
        }, 2000);
      };

      // ── HLS instance factory with built-in error recovery ────────────────
      const makeHls = (onFatal: () => void) => {
        const hls = new Hls(HLS_CONFIG as Hls['config']);
        let mediaErrCount = 0;
        let netErrCount   = 0;
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (cancelled) return;
          if (!d.fatal) {
            if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            return;
          }
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrCount < 3) {
            mediaErrCount++;
            setTimeout(() => { if (!cancelled) hls.recoverMediaError(); }, 500);
            return;
          }
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netErrCount < 2) {
            netErrCount++;
            setTimeout(() => { if (!cancelled) hls.startLoad(); }, 2000);
            return;
          }
          hls.destroy();
          if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
          setStatusMsg(null);
          onFatal();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setStatusMsg(null); setError(null);
          setSubtitleTracks(hls.subtitleTracks.map((tk, i) => ({ id: i, name: tk.name || tk.lang || `Track ${i + 1}`, lang: tk.lang })));
          startStallWatchdog();
        });
        return hls;
      };

      // ── S-HLS chain: Direct → Native → CF-Manifest → CF-Full ────────────────
      // Order rationale:
      //   S1 HLS.js direct  — fastest, best quality switching
      //   S2 native <video>  — no CORS restriction, works for IP-locked streams on any Safari
      //   S3 CF manifest     — manifest via CF (CORS headers added), segments direct
      //   S4 CF full proxy   — everything via CF (for fully CORS-blocked, non-IP-locked streams)
      const loadViaHls = () => {
        if (cancelled) return;

        // S4 — full proxy via CF Worker (all segments through CF)
        const s4_cfFullProxy = () => {
          if (cancelled) return;
          const cfUrl = buildCfUrl(src);
          if (!cfUrl) { setError('ip-locked'); setStatusMsg(null); return; }
          setStatusMsg('hls-proxy');
          const hls = makeHls(() => { setError('ip-locked'); setStatusMsg(null); });
          hlsRef.current = hls;
          hls.loadSource(cfUrl);
          hls.attachMedia(video);
        };

        // S3 — manifest-only proxy via CF (adds CORS headers, segments still direct)
        const s3_cfManifestProxy = () => {
          if (cancelled) return;
          const cfUrl = buildCfUrl(src, 'manifest');
          if (!cfUrl) { s4_cfFullProxy(); return; }
          setStatusMsg('hls-manifest');
          const hls = makeHls(() => s4_cfFullProxy());
          hlsRef.current = hls;
          hls.loadSource(cfUrl);
          hls.attachMedia(video);
        };

        // S2 — native <video> (no CORS, no crossorigin — bypasses CORS & works for IP-locked streams on Safari)
        const s2_native = () => {
          if (cancelled) return;
          destroyAll();
          setStatusMsg('native');
          // Full reset: remove crossorigin, clear src, then reload — critical on iOS Safari
          // after HLS.js was previously attached to the same video element
          video.removeAttribute('crossorigin');
          video.setAttribute('referrerpolicy', 'no-referrer'); // Don't leak app domain as Referer to CDN
          video.removeAttribute('src');
          video.load();
          video.src = src;
          video.load();
          const onMeta = () => {
            if (!cancelled) { setIsLive(!isFinite(video.duration) || video.duration === Infinity); onDurationChange(); setStatusMsg(null); setError(null); startStallWatchdog(); }
          };
          const onErr = () => {
            if (!cancelled) s3_cfManifestProxy();
          };
          video.addEventListener('loadedmetadata', onMeta, { once: true });
          video.addEventListener('error',          onErr,  { once: true });
        };

        // S1 — HLS.js direct (best features: adaptive bitrate, quality switching)
        setStatusMsg('hls-direct');
        if (Hls.isSupported()) {
          const hls = makeHls(() => s2_native());
          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
          // Safari (iOS/macOS) without MSE: native HLS only
          s2_native();
        } else {
          setStatusMsg(null); setError('unsupported');
        }
      };

      // ── Main: detect type from URL, route to best engine ─────────────────
      const run = async () => {
        const lower = src.toLowerCase();

        if (lower.startsWith('rtsp://') || lower.startsWith('rtsps://') ||
            lower.startsWith('rtmp://') || lower.startsWith('rtmps://')) {
          setError('unsupported'); return;
        }
        if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mkv') || lower.endsWith('.avi')) {
          loadViaNative(); return;
        }
        if (lower.includes('.mpd') || lower.includes('/manifest.mpd')) {
          loadViaDash(); return;
        }
        if (lower.endsWith('.ts') || lower.endsWith('.flv')) {
          setError('unsupported'); return;
        }
        if (lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('/hls/') || lower.includes('hls.m3u')) {
          loadViaHls(); return;
        }

        // Ambiguous URL — ask server to detect type
        setStatusMsg('detecting');
        let type = 'hls';
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 3000);
          const r = await fetch(`/api/proxy/detect?url=${encodeURIComponent(src)}`, { signal: ctrl.signal });
          clearTimeout(tid);
          if (r.ok) type = (await r.json()).type ?? 'unknown';
        } catch { /* timeout — default to hls */ }

        if (cancelled) return;

        if      (type === 'dash')                   loadViaDash();
        else if (type === 'mp4' || type === 'webm') loadViaNative();
        else if (type === 'unknown')                { setStatusMsg(null); setError('unsupported'); }
        else                                        loadViaHls();
      };

      run();

      return () => {
        cancelled = true;
        if (reconnTimerRef.current) { clearTimeout(reconnTimerRef.current); reconnTimerRef.current = null; }
        if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
        video.removeEventListener('durationchange', onDurationChange);
        destroyAll();
      };
    }, [src, retryKey]);

    // Play / pause sync
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      if (playing) {
        v.play().catch((err: Error) => {
          if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
        });
      } else {
        v.pause();
      }
    }, [playing]);

    // Fullscreen tracking (native + webkit + simulated)
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      return onFullscreenChange(el, (fs) => {
        setIsFullscreen(fs);
        if (!fs) setIsChatOpen(false);
      });
    }, [containerRef]);

    // Toast — new messages while in fullscreen
    useEffect(() => {
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
    }, [chatMessages, isFullscreen, username]);

    const handleSubtitleChange = useCallback((id: number) => {
      setActiveSubtitleId(id);
      if (id === -2) return; // custom subtitle — managed separately
      if (id === -1) {
        // Turning off: clear both HLS and custom
        setCustomSubtitleCues([]);
        setCustomSubtitleLabel('');
        setCurrentSubtitleText('');
      }
      if (hlsRef.current) hlsRef.current.subtitleTrack = id;
    }, []);

    const handleToggleChat = useCallback(() => {
      if (isFullscreen) setIsChatOpen((o) => !o);
      else onFocusChat();
    }, [isFullscreen, onFocusChat]);

    const statusLabel: Record<string, { en: string; ar: string }> = {
      detecting:      { en: 'Loading…', ar: 'جاري التحميل…' },
      'hls-direct':   { en: 'Loading…', ar: 'جاري التحميل…' },
      'hls-manifest': { en: 'Loading…', ar: 'جاري التحميل…' },
      'hls-proxy':    { en: 'Loading…', ar: 'جاري التحميل…' },
      dash:           { en: 'Loading…', ar: 'جاري التحميل…' },
      native:         { en: 'Loading…', ar: 'جاري التحميل…' },
    };

    return (
      <>
        {/* Loading status indicator */}
        {statusMsg && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-20">
            <div className="text-center space-y-3">
              <Loader2 className="w-10 h-10 text-white/70 mx-auto animate-spin" />
              <p className="text-white/70 text-sm">
                {statusLabel[statusMsg]?.[lang] ?? (lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…')}
              </p>
            </div>
          </div>
        )}

        {error && !statusMsg && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
            <div className="text-center space-y-3 px-6">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
              <p className="text-white font-semibold">
                {error === 'ip-locked'       ? t('videoErrorIpLocked')
                : error === 'proxy-required' ? t('videoErrorProxyRequired')
                : t('videoError')}
              </p>
              <p className="text-white/50 text-sm max-w-md">
                {error === 'ip-locked'       ? t('videoErrorIpLockedDesc')
                : error === 'proxy-required' ? t('videoErrorProxyRequiredDesc')
                : t('videoErrorDesc')}
              </p>
              {error === 'proxy-required' ? (
                <button
                  onClick={() => {
                    const fn = forceProxyFnRef.current;
                    forceProxyFnRef.current = null;
                    setError(null);
                    fn?.();
                  }}
                  className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 active:bg-primary/40 text-primary text-sm font-medium transition-colors border border-primary/30"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  {t('videoErrorProxyBtn')}
                </button>
              ) : (
                <button
                  onClick={handleRetry}
                  className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 text-white text-sm font-medium transition-colors border border-white/15"
                >
                  <RotateCcw className="w-4 h-4" />
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              )}
            </div>
          </div>
        )}

        {autoplayBlocked && !error && !statusMsg && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 cursor-pointer"
            onClick={() => { setAutoplayBlocked(false); videoRef.current?.play().catch(() => {}); onPlay?.(); }}
          >
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mx-auto border border-white/30">
                <Play className="w-10 h-10 text-white fill-white" />
              </div>
              <p className="text-white/80 text-sm">{t('tapToPlay')}</p>
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          playsInline
          referrerPolicy="no-referrer"
          onPlay={() => { setAutoplayBlocked(false); setError(null); onPlay?.(); }}
          onPause={onPause}
          onSeeked={() => { if (videoRef.current) onSeek?.(videoRef.current.currentTime); }}
        />

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

        <PlayerControls
          videoRef={videoRef}
          containerRef={containerRef}
          isPlaying={playing}
          isLive={isLive}
          canControl={canControl}
          subtitleTracks={subtitleTracks}
          activeSubtitleId={activeSubtitleId}
          customSubtitleLabel={customSubtitleLabel}
          onPlay={onPlay ?? (() => {})}
          onPause={onPause ?? (() => {})}
          onSeek={onSeek ?? (() => {})}
          onSubtitleChange={handleSubtitleChange}
          onSearchSubtitles={() => setShowSubtitleSearch(true)}
          onToggleChat={handleToggleChat}
          isChatOpen={isChatOpen}
          toastMessages={toastQueue}
          lang={lang}
        />

        <FullscreenChat
          isOpen={isChatOpen && isFullscreen}
          onClose={() => setIsChatOpen(false)}
          messages={chatMessages}
          username={username}
          onSend={onSendChatMessage}
        />

        <SubtitleSearch
          isOpen={showSubtitleSearch}
          onClose={() => setShowSubtitleSearch(false)}
          onApply={handleApplySubtitle}
          lang={lang}
        />
      </>
    );
  },
);

HlsPlayer.displayName = 'HlsPlayer';
