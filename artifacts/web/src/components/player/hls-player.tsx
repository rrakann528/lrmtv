import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from 'react';
import Hls from 'hls.js';
import { Play, AlertTriangle, RotateCcw, Loader2, VolumeX } from 'lucide-react';
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
  /** Position (seconds) to seek to when the player becomes ready (late-join sync) */
  initialTime?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  /** Fired once the player has loaded enough to accept seeks — used by room to gate sync */
  onReady?: () => void;
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
  /**
   * Hint from the room server that the current stream is a live broadcast.
   * When true, startPosition is set to -1 (live edge) instead of a specific timestamp,
   * preventing the guest player from trying to seek to an exact position in the sliding window.
   */
  isLiveHint?: boolean;
  /** Fired after the manifest loads and live/VOD status is determined */
  onIsLive?: (isLive: boolean) => void;
}

export interface HlsPlayerHandle {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
  getVideoElement: () => HTMLVideoElement | null;
}

export const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      src,
      playing,
      canControl = true,
      initialTime = 0,
      onPlay,
      onPause,
      onSeek,
      onReady,
      containerRef,
      chatMessages,
      username,
      onSendChatMessage,
      onFocusChat,
      lang = 'en',
      onSubtitleApplied,
      externalSubtitle,
      isLiveHint = false,
      onIsLive,
    },
    ref,
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef   = useRef<Hls | null>(null);
    const dashRef  = useRef<{ destroy: () => void } | null>(null);
    const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const forceProxyFnRef = useRef<(() => void) | null>(null);
    // Prevents stall-recovery nudges from emitting a seek event to the whole room
    const isInternalNudgeRef = useRef(false);
    // Debounces the buffering spinner (avoids 1-frame flicker on seek)
    const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Keep latest onReady in a ref so closures inside useEffect always call the current prop
    const onReadyRef = useRef(onReady);
    useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
    // Keep latest onIsLive in a ref
    const onIsLiveRef = useRef(onIsLive);
    useEffect(() => { onIsLiveRef.current = onIsLive; }, [onIsLive]);
    // Keep latest initialTime in a ref so signalReady always uses the most up-to-date position
    const initialTimeRef = useRef(initialTime);
    useEffect(() => { initialTimeRef.current = initialTime; }, [initialTime]);
    // Fire onReady only once per src load (reset in the load effect)
    const readyFiredRef = useRef(false);
    // Synchronous live flag (React state is async — closures need a ref)
    const isLiveRef = useRef(false);
    // Buffering overlay: true while waiting for first playable frame after seek
    const [buffering, setBuffering] = useState(true);
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
      getVideoElement: () => videoRef.current,
    }));

    // ── PWA / tab-switch recovery: resume HLS after page comes back ───────────
    useEffect(() => {
      const onVisible = () => {
        if (document.hidden) return;
        const video = videoRef.current;
        if (!video) return;
        // Small delay so browser finishes its own resume logic first
        setTimeout(() => {
          if (document.hidden) return;
          const hls = hlsRef.current;
          if (hls) {
            // Kick HLS.js to resume fetching segments (browser may have frozen it)
            try { hls.startLoad(); } catch { /* ignore if not attached */ }
            // For live: jump to live edge if we've drifted more than 4 s behind
            if (isLiveRef.current) {
              const edge = hls.liveSyncPosition;
              if (edge && isFinite(edge) && video.currentTime < edge - 4) {
                video.currentTime = edge;
              }
            }
          }
          // If video is supposed to be playing but has no data, nudge it
          if (!video.paused && video.readyState < 2) {
            video.play().catch(() => {});
          }
        }, 400);
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    // ── Universal player — detect stream type then route to best engine ────────
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;

      setError(null);
      setStatusMsg(null);
      setAutoplayBlocked(false);
      setMutedForAutoplay(false);
      setSubtitleTracks([]);
      setActiveSubtitleId(-1);

      if (reconnTimerRef.current) { clearTimeout(reconnTimerRef.current); reconnTimerRef.current = null; }

      readyFiredRef.current = false;
      isLiveRef.current = false;
      setBuffering(true);
      let cancelled = false;

      // Helper: show buffering spinner with a debounce so 1-frame glitches don't flicker
      const showBuffering = () => {
        if (bufferingTimerRef.current) return; // already pending
        bufferingTimerRef.current = setTimeout(() => {
          bufferingTimerRef.current = null;
          if (!cancelled) setBuffering(true);
        }, 400);
      };
      const hideBuffering = () => {
        if (bufferingTimerRef.current) { clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
        setBuffering(false);
      };

      // Clear buffering spinner and signal ready once the browser has buffered enough to play.
      const onCanPlay = () => { if (!cancelled) { hideBuffering(); signalReady(); } };
      // Also clear when frames actually start rendering (belt-and-suspenders)
      const onPlaying  = () => { if (!cancelled) hideBuffering(); };
      // Show spinner only after a 400 ms delay to avoid flicker on tiny rebuffers
      const onWaiting  = () => { if (!cancelled) showBuffering(); };
      // Network fetch stalled → kick HLS/native to restart
      const onStalled  = () => {
        if (cancelled) return;
        const hls = hlsRef.current;
        if (hls) {
          if (isLiveRef.current) {
            // Live: snap to live edge so we don't resume from a stale position
            const edge = hls.liveSyncPosition;
            const loadPos = (edge && isFinite(edge)) ? edge : -1;
            try { hls.stopLoad(); hls.startLoad(loadPos); } catch { /* ignore */ }
          } else {
            try { hls.startLoad(); } catch { /* ignore */ }
          }
        } else if (!video.paused) {
          video.load(); video.play().catch(() => {});
        }
      };

      video.addEventListener('canplay',  onCanPlay);
      video.addEventListener('playing',  onPlaying);
      video.addEventListener('waiting',  onWaiting);
      video.addEventListener('stalled',  onStalled);

      // Called once the player has loaded enough to seek — seeks to initialTime if needed, then fires onReady.
      // When called from canplay (HLS path), startPosition has already positioned the player correctly,
      // so we only seek if we are actually more than 4 seconds away from the target.
      const signalReady = () => {
        if (cancelled || readyFiredRef.current) return;
        readyFiredRef.current = true;
        const targetTime = initialTimeRef.current;
        const currentPos = video?.currentTime ?? 0;
        // For live streams skip seek entirely — just play from the live edge.
        // For VOD: only seek if startPosition didn't already place us close enough.
        if (!isLiveRef.current && targetTime > 2 && video && Math.abs(currentPos - targetTime) > 4) {
          video.currentTime = targetTime;
        }
        onReadyRef.current?.();
      };

      // ── Destroy all active engines ────────────────────────────────────────
      const destroyAll = () => {
        hlsRef.current?.destroy();  hlsRef.current  = null;
        if (dashRef.current) {
          try { dashRef.current.destroy(); } catch { /* ignore */ }
          dashRef.current = null;
        }
        video.removeAttribute('src');
        video.load();
      };

      // ── Duration / live detection ─────────────────────────────────────────
      const onDurationChange = () => {
        const d = video.duration;
        if (!isNaN(d)) {
          const live = !d || !isFinite(d) || d === Infinity;
          isLiveRef.current = live;
          setIsLive(live);
        }
      };
      video.addEventListener('durationchange', onDurationChange);

      // Capture startPosition at load time — tells HLS.js to begin fetching
      // from this position directly instead of starting at 0 then seeking.
      // For live streams (isLiveHint=true), always start at the live edge (-1).
      // Seeking to a specific time in the live sliding window causes buffering
      // because computedTime may overshoot the available segment window.
      const startPos = isLiveHint ? -1 : (initialTimeRef.current > 2 ? initialTimeRef.current : -1);

      const HLS_CONFIG: Partial<Hls['config']> = {
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: startPos,
        startFragPrefetch: true,

        liveSyncDurationCount:       2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate:     1.2,

        backBufferLength:   20,
        maxBufferLength:    60,
        maxMaxBufferLength: 120,

        manifestLoadingMaxRetry:   1,
        manifestLoadingTimeOut:    6_000,
        manifestLoadingRetryDelay: 500,
        levelLoadingMaxRetry:      3,
        levelLoadingTimeOut:       10_000,
        levelLoadingRetryDelay:    500,
        fragLoadingMaxRetry:       5,
        fragLoadingTimeOut:        12_000,
        fragLoadingRetryDelay:     300,

        startLevel:             -1,
        abrEwmaDefaultEstimate: 2_000_000,
        abrBandWidthFactor:     0.9,
        abrBandWidthUpFactor:   0.7,
        testBandwidth:          true,

        progressive:   true,
        nudgeMaxRetry: 10,
        nudgeOffset:   0.1,
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
        const onMeta = () => {
          if (!cancelled) {
            const live = !isFinite(video.duration) || video.duration === Infinity;
            isLiveRef.current = live; setIsLive(live);
            onIsLiveRef.current?.(live);
            setStatusMsg(null); setError(null); signalReady();
          }
        };
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
          player.on(Events.STREAM_INITIALIZED ?? 'streamInitialized', () => { if (!cancelled) { setStatusMsg(null); setError(null); onDurationChange(); signalReady(); } });
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

      // ── Stall watchdog — detects frozen playback and recovers ───────────────
      let stallWatchdog: ReturnType<typeof setInterval> | null = null;
      const startStallWatchdog = () => {
        if (stallWatchdog) clearInterval(stallWatchdog);
        let lastTime = -1;
        let stalledFor = 0;
        let edgeTick = 0; // for periodic live-edge drift correction

        stallWatchdog = setInterval(() => {
          if (cancelled || !video || video.paused || video.ended) return;
          const now = video.currentTime;
          const hls = hlsRef.current;

          // ── Periodic live-edge drift correction (every 10 s while playing) ─
          edgeTick++;
          if (isLiveRef.current && edgeTick >= 10 && hls) {
            edgeTick = 0;
            const edge = hls.liveSyncPosition;
            // If we've drifted more than 12 s behind the live edge, snap forward.
            // HLS.js normally handles this via maxLiveSyncPlaybackRate speed-up,
            // but if it drifted too far (e.g. after a network hiccup), snap it.
            if (edge && isFinite(edge) && now < edge - 12) {
              video.currentTime = edge;
            }
          } else if (!isLiveRef.current) {
            edgeTick = 0; // don't accumulate for VOD
          }

          // ── Stall detection: currentTime not advancing + not enough buffer ─
          if (now === lastTime && video.readyState < 3) {
            stalledFor += 1;
            if (stalledFor >= 2) {  // 2 s of true stall → act
              stalledFor = 0;
              const buf = video.buffered;
              const ahead = buf.length > 0 ? buf.end(buf.length - 1) - now : 0;
              if (ahead > 0.3) {
                // Buffer exists but decoder froze — nudge past stuck frame
                isInternalNudgeRef.current = true;
                video.currentTime = now + 0.1;
                setTimeout(() => { isInternalNudgeRef.current = false; }, 200);
              } else if (hls) {
                if (isLiveRef.current) {
                  // Live: reload from live edge, not the stale current position
                  const edge = hls.liveSyncPosition;
                  const loadPos = (edge && isFinite(edge)) ? edge : -1;
                  try { hls.stopLoad(); hls.startLoad(loadPos); } catch { /* ignore */ }
                } else {
                  // VOD: reload from where we stopped
                  try { hls.stopLoad(); hls.startLoad(now); } catch { /* ignore */ }
                }
              } else if (dashRef.current) {
                // DASH auto-recovers
              } else {
                // Native video
                if (isLiveRef.current) {
                  // Live: just reload — native live streams always start at edge
                  video.load(); video.play().catch(() => {});
                } else {
                  const t = video.currentTime;
                  video.load(); video.currentTime = t; video.play().catch(() => {});
                }
              }
            }
          } else {
            stalledFor = 0;
          }
          lastTime = now;
        }, 1000);
      };

      // ── HLS instance factory with built-in error recovery ────────────────
      const makeHls = (onFatal: () => void) => {
        const hls = new Hls(HLS_CONFIG as Hls['config']);
        let mediaErrCount = 0;
        let netErrCount   = 0;
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (cancelled) return;
          if (!d.fatal) {
            // Non-fatal errors are handled by HLS.js internally — do NOT call recoverMediaError()
            // on non-fatal errors as it triggers an unnecessary rebuffer cycle.
            // For non-fatal network errors, just let HLS.js retry via its built-in retry logic.
            return;
          }
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrCount < 4) {
            mediaErrCount++;
            if (mediaErrCount === 1) {
              // First attempt: soft recovery (stops and restarts the codec)
              hls.recoverMediaError();
            } else if (mediaErrCount === 2) {
              // Second attempt: swap audio codec, then recover
              setTimeout(() => { if (!cancelled) { hls.swapAudioCodec(); hls.recoverMediaError(); } }, 300);
            } else {
              // Subsequent: full reload of segments
              setTimeout(() => { if (!cancelled) { hls.stopLoad(); hls.startLoad(); } }, 500);
            }
            return;
          }
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
            const httpCode = d.response?.code;
            const isManifestErr = d.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
                               || d.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
            if (isManifestErr && (httpCode === 404 || httpCode === 410)) {
              hls.destroy();
              if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
              setStatusMsg(null);
              setError('link-dead');
              return;
            }
            if (netErrCount < 3) {
              const isCorsBlock = !httpCode || httpCode === 0;
              if (isCorsBlock) {
                hls.destroy();
                if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
                setStatusMsg(null);
                onFatal();
                return;
              }
              netErrCount++;
              const delay = netErrCount * 1500;
              setTimeout(() => { if (!cancelled) hls.startLoad(); }, delay);
              return;
            }
          }
          hls.destroy();
          if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
          setStatusMsg(null);
          onFatal();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          // Resolve live status synchronously before signalReady so the seek decision is correct
          const d = video.duration;
          if (!isNaN(d)) {
            const live = !d || !isFinite(d) || d === Infinity;
            isLiveRef.current = live;
            setIsLive(live);
            // Notify the room so late-joiners know to start at live edge
            onIsLiveRef.current?.(live);
          }
          setStatusMsg(null); setError(null);
          setSubtitleTracks(hls.subtitleTracks.map((tk, i) => ({ id: i, name: tk.name || tk.lang || `Track ${i + 1}`, lang: tk.lang })));
          startStallWatchdog();
          // signalReady() is intentionally NOT called here.
          // It fires from the 'canplay' event once the buffer at startPosition is truly
          // ready — this prevents the triple-seek that caused heavy join-time stuttering.
        });
        return hls;
      };

      // ── S-HLS chain: Direct → Native → CF-Manifest → CF-Full ────────────────
      // Order rationale:
      //   S1 HLS.js direct  — fastest, best quality switching
      //   S2 native <video>  — no CORS restriction, works for IP-locked streams on any Safari
      //   S3 CF manifest     — manifest via CF (CORS headers added), segments direct
      //   S4 CF full proxy   — everything via CF (for fully CORS-blocked, non-IP-locked streams)
      //   S5 API server proxy — manifest + segments via our own API (handles HTTP→HTTPS, always available)
      const loadViaHls = () => {
        if (cancelled) return;

        const s2_native = (onFail?: () => void, timeoutMs = 15_000) => {
          if (cancelled) return;
          destroyAll();
          setStatusMsg('native');
          const setup = () => {
            if (cancelled) return;
            video.removeAttribute('crossorigin');
            video.setAttribute('referrerpolicy', 'no-referrer');
            video.removeAttribute('src');
            video.load();
            video.src = src;
            video.load();
            let nativeDone = false;
            const onSuccess = () => {
              if (nativeDone || cancelled) return;
              nativeDone = true;
              clearTimeout(fallbackTimer);
              video.removeEventListener('loadedmetadata', onSuccess);
              video.removeEventListener('canplay', onSuccess);
              video.removeEventListener('playing', onSuccess);
              video.removeEventListener('error', onErrWrapped);
              const live = !isFinite(video.duration) || video.duration === Infinity;
              isLiveRef.current = live; setIsLive(live);
              onDurationChange(); setStatusMsg(null); setError(null); startStallWatchdog(); signalReady();
            };
            const onErrWrapped = () => {
              if (nativeDone || cancelled) return;
              nativeDone = true;
              clearTimeout(fallbackTimer);
              video.removeEventListener('loadedmetadata', onSuccess);
              video.removeEventListener('canplay', onSuccess);
              video.removeEventListener('playing', onSuccess);
              video.removeEventListener('error', onErrWrapped);
              if (onFail) { onFail(); }
              else { setError('ip-locked'); setStatusMsg(null); }
            };
            const fallbackTimer = setTimeout(() => {
              if (nativeDone) return;
              nativeDone = true;
              video.removeEventListener('loadedmetadata', onSuccess);
              video.removeEventListener('canplay', onSuccess);
              video.removeEventListener('playing', onSuccess);
              video.removeEventListener('error', onErrWrapped);
              if (!cancelled) {
                if (onFail) { onFail(); }
                else { setError('ip-locked'); setStatusMsg(null); }
              }
            }, timeoutMs);
            video.addEventListener('loadedmetadata', onSuccess);
            video.addEventListener('canplay', onSuccess);
            video.addEventListener('playing', onSuccess);
            video.addEventListener('error', onErrWrapped);
          };
          if (hlsRef.current) {
            setTimeout(setup, 150);
          } else {
            setup();
          }
        };

        // Final fallback when no CF proxy: try native video directly from browser (works
        // for IP-locked streams on Safari since native <video> doesn't enforce CORS)
        const s6_nativeFinal = () => {
          if (cancelled) return;
          s2_native(undefined, 20_000);
        };

        const s5_cfFullProxy = () => {
          if (cancelled) return;
          if (!CF_PROXY) { s6_nativeFinal(); return; }
          const cfUrl = `${CF_PROXY}?url=${encodeURIComponent(src)}&ref=${encodeURIComponent(src)}&mode=full`;
          setStatusMsg('hls-proxy');
          const hls = makeHls(() => { s6_nativeFinal(); });
          hlsRef.current = hls;
          hls.loadSource(cfUrl);
          hls.attachMedia(video);
        };

        // S4 — full proxy via CF Worker (all segments through CF, only when CF_PROXY is set)
        const s4_cfFullProxy = () => {
          if (cancelled) return;
          const cfUrl = buildCfUrl(src);
          if (!cfUrl) { s5_cfFullProxy(); return; }
          setStatusMsg('hls-proxy');
          const hls = makeHls(() => s5_cfFullProxy());
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

        if (src.startsWith('http:') && window.location.protocol === 'https:') {
          s5_cfFullProxy();
          return;
        }

        setStatusMsg('hls-direct');
        const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

        if (canNativeHls) {
          s2_native(() => {
            if (cancelled) return;
            if (Hls.isSupported()) {
              destroyAll();
              setStatusMsg('hls-direct');
              const onHlsFail = () => s3_cfManifestProxy();
              const hls = makeHls(onHlsFail);
              hlsRef.current = hls;
              hls.loadSource(src);
              hls.attachMedia(video);
            } else {
              s5_cfFullProxy();
            }
          }, 8_000);
        } else if (Hls.isSupported()) {
          const onS1Fail = () => s3_cfManifestProxy();
          const hls = makeHls(onS1Fail);
          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);
        } else {
          setStatusMsg(null); setError('unsupported');
        }
      };

      // ── Main: detect type from URL, route to best engine ─────────────────
      const run = async () => {
        // For server-proxy URLs (/api/proxy/stream?url=...) the type must be
        // inferred from the *inner* original URL, not the proxy URL itself.
        // Many CDN streams have no .m3u8 extension visible in the proxy URL.
        let detectSrc = src;
        if (src.includes('/api/proxy/stream?')) {
          try {
            const qs = src.split('?').slice(1).join('?');
            const innerEncoded = new URLSearchParams(qs).get('url');
            if (innerEncoded) detectSrc = decodeURIComponent(innerEncoded);
          } catch { /* use src as-is */ }
        }
        const lower = detectSrc.toLowerCase();

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
          let tid: ReturnType<typeof setTimeout> | null = null;
          try {
            const ctrl = new AbortController();
            tid = setTimeout(() => ctrl.abort(), 3500);
            const r = await fetch(`/api/proxy/check?url=${encodeURIComponent(src)}`, { signal: ctrl.signal });
            if (r.ok) {
              const data = await r.json();
              if (data.httpStatus === 404 || data.httpStatus === 410) {
                if (!cancelled) { setStatusMsg(null); setError('link-dead'); }
                return;
              }
            }
          } catch { /* timeout / error — proceed to player chain */ }
          finally { if (tid) clearTimeout(tid); }
          if (!cancelled) loadViaHls();
          return;
        }

        // Ambiguous URL — ask server to detect type.
        // Use detectSrc (inner URL for proxy URLs) so the server can fetch it.
        setStatusMsg('detecting');
        let type = 'hls';
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 3000);
          const r = await fetch(`/api/proxy/detect?url=${encodeURIComponent(detectSrc)}`, { signal: ctrl.signal });
          clearTimeout(tid);
          if (r.ok) type = (await r.json()).type ?? 'unknown';
        } catch { /* timeout — default to hls */ }

        if (cancelled) return;

        if      (type === 'dash')                   loadViaDash();
        else if (type === 'mp4' || type === 'webm') loadViaNative();
        // For proxy URLs with unknown type, try HLS — most CDN streams are HLS
        else if (type === 'unknown' && !src.includes('/api/proxy/stream?')) { setStatusMsg(null); setError('unsupported'); }
        else                                        loadViaHls();
      };

      // ── Network-back recovery: restart loading when device comes back online ──
      const onOnline = () => {
        if (cancelled) return;
        setTimeout(() => {
          if (cancelled) return;
          if (hlsRef.current) { try { hlsRef.current.startLoad(); } catch { /* ignore */ } }
          else if (video && !video.paused && video.readyState < 3) {
            video.play().catch(() => {});
          }
        }, 1000);
      };
      window.addEventListener('online', onOnline);

      run();

      return () => {
        cancelled = true;
        if (bufferingTimerRef.current) { clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
        if (reconnTimerRef.current) { clearTimeout(reconnTimerRef.current); reconnTimerRef.current = null; }
        if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
        video.removeEventListener('durationchange', onDurationChange);
        video.removeEventListener('canplay',  onCanPlay);
        video.removeEventListener('playing',  onPlaying);
        video.removeEventListener('waiting',  onWaiting);
        video.removeEventListener('stalled',  onStalled);
        window.removeEventListener('online',  onOnline);
        destroyAll();
      };
    }, [src, retryKey]);

    const [mutedForAutoplay, setMutedForAutoplay] = useState(false);

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      if (playing) {
        v.play().catch((err: Error) => {
          if (err.name === 'NotAllowedError') {
            v.muted = true;
            v.play().then(() => {
              setMutedForAutoplay(true);
              setAutoplayBlocked(false);
            }).catch(() => {
              setAutoplayBlocked(true);
            });
          }
        });
      } else {
        v.pause();
      }
    }, [playing]);

    // Loading timeout — fires once per src/retryKey; if video never plays within 20 s → show error
    useEffect(() => {
      if (!src) return;
      const timer = setTimeout(() => {
        // Only show error if still loading (statusMsg truthy) and no error yet
        setStatusMsg(prev => {
          if (prev) { setError(e => e ?? 'ip-locked'); return null; }
          return prev;
        });
      }, 20_000);
      return () => clearTimeout(timer);
    }, [src, retryKey]);

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
        {/* Initial load overlay — full screen, only while statusMsg is set (before manifest parsed) */}
        {statusMsg && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-20">
            <div className="text-center space-y-3">
              <Loader2 className="w-10 h-10 text-white/70 mx-auto animate-spin" />
              <p className="text-white/70 text-sm">
                {statusLabel[statusMsg]?.[lang] ?? t('loading')}
              </p>
            </div>
          </div>
        )}

        {error && !statusMsg && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
            <div className="text-center space-y-3 px-6">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
              <p className="text-white font-semibold">
                {error === 'link-dead'       ? t('videoErrorLinkDead')
                : error === 'ip-locked'      ? t('videoErrorIpLocked')
                : error === 'proxy-required' ? t('videoErrorProxyRequired')
                : t('videoError')}
              </p>
              <p className="text-white/50 text-sm max-w-md">
                {error === 'link-dead'       ? t('videoErrorLinkDeadDesc')
                : error === 'ip-locked'      ? t('videoErrorIpLockedDesc')
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
                <div className="flex flex-col items-center gap-2 mt-1">
                  <button
                    onClick={handleRetry}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 text-white text-sm font-medium transition-colors border border-white/15"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t('retry')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {autoplayBlocked && !error && !statusMsg && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60 z-20 cursor-pointer"
            onClick={() => {
              setAutoplayBlocked(false);
              const v = videoRef.current;
              if (v) { v.muted = false; v.play().catch(() => {}); }
              onPlay?.();
            }}
          >
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mx-auto border border-white/30">
                <Play className="w-10 h-10 text-white fill-white" />
              </div>
              <p className="text-white/80 text-sm">{t('tapToPlay')}</p>
            </div>
          </div>
        )}

        {mutedForAutoplay && !autoplayBlocked && !error && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
            <button
              onClick={() => {
                const v = videoRef.current;
                if (v) { v.muted = false; }
                setMutedForAutoplay(false);
              }}
              className="flex items-center gap-2 bg-black/80 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm border border-white/20 hover:bg-white/20 transition-colors shadow-lg"
            >
              <VolumeX className="w-4 h-4" />
              {t('mutedTapUnmute')}
            </button>
          </div>
        )}

        <video
          ref={videoRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          playsInline
          onPlay={() => { setAutoplayBlocked(false); setError(null); onPlay?.(); }}
          onPause={onPause}
          onSeeked={() => {
            if (isInternalNudgeRef.current) return;
            if (!readyFiredRef.current) return;
            const video = videoRef.current;
            if (!video) return;
            const t = video.currentTime;
            // For live streams: if the player jumped back to 0 or near-start after
            // a failed seek, snap to the live edge instead of broadcasting time=0
            // which would reset everyone's playback.
            if (isLiveRef.current && t < 1) {
              const hls = hlsRef.current;
              const edge = hls?.liveSyncPosition;
              if (edge && isFinite(edge) && edge > 5) {
                video.currentTime = edge;
                return;
              }
            }
            onSeek?.(t);
          }}
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
