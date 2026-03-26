import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Globe, X, Loader2, CheckCircle, Search, RefreshCw, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface PageBrowserProps {
  url: string;
  onVideoDetected: (videoUrl: string) => void;
  onClose: () => void;
}

type Status = 'searching' | 'found' | 'multiple' | 'not-found';

function shortenUrl(url: string, max = 60): string {
  try {
    const u = new URL(url);
    const short = u.hostname + u.pathname;
    return short.length > max ? short.slice(0, max) + '…' : short;
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url;
  }
}

function pickBest(urls: string[]): string {
  // Prefer HLS (.m3u8) over others
  const hls = urls.find(v => /\.m3u8/i.test(v));
  if (hls) return hls;
  // Then mp4
  const mp4 = urls.find(v => /\.mp4/i.test(v));
  if (mp4) return mp4;
  return urls[0];
}

export default function PageBrowser({ url, onVideoDetected, onClose }: PageBrowserProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>('searching');
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [showUrlList, setShowUrlList] = useState(false);
  const detectedRef = useRef(false);
  const allDetected = useRef<Set<string>>(new Set());

  const addDetected = useCallback((videoUrl: string) => {
    if (!videoUrl.startsWith('http')) return;
    if (allDetected.current.has(videoUrl)) return;
    allDetected.current.add(videoUrl);

    setDetectedUrls(prev => {
      const next = [...prev, videoUrl];
      if (!detectedRef.current) {
        detectedRef.current = true;
        const best = pickBest(next);
        setSelectedUrl(best);
        setStatus(next.length > 1 ? 'multiple' : 'found');
        // Auto-play best after short delay
        setTimeout(() => onVideoDetected(best), 1200);
      } else {
        setStatus(next.length > 1 ? 'multiple' : 'found');
      }
      return next;
    });
  }, [onVideoDetected]);

  // ── Virtual browser extraction (server-side Playwright) ──────────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 55000);

    fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        clearTimeout(fetchTimeout);
        if (cancelled) return;
        if (data?.videos?.length > 0) {
          (data.videos as string[]).forEach(v => addDetected(v));
        } else if (!detectedRef.current) {
          setStatus('not-found');
        }
      })
      .catch(() => {
        clearTimeout(fetchTimeout);
        if (!cancelled && !detectedRef.current) setStatus('not-found');
      });

    return () => { cancelled = true; controller.abort(); };
  }, [url, addDetected]);

  // ── Interactive iframe detection (postMessage from bridge script) ─────────────
  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'lrmtv-video-detected' && e.data.url) {
      addDetected(String(e.data.url));
    }
  }, [addDetected]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(url)}`;

  const handleManualPlay = (videoUrl: string) => {
    setSelectedUrl(videoUrl);
    onVideoDetected(videoUrl);
  };

  const handleRetry = () => {
    setStatus('searching');
    setDetectedUrls([]);
    detectedRef.current = false;
    allDetected.current = new Set();
    setSelectedUrl(null);
    // Reload the iframe
    if (iframeRef.current) {
      iframeRef.current.src = proxyUrl;
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black">
      {/* ── Header bar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-col bg-gray-900/98 border-b border-white/10">
        {/* Top row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs text-white/60 truncate max-w-[180px] md:max-w-[420px]">{url}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            {status === 'searching' && (
              <div className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                <span className="text-[11px] text-purple-400 hidden sm:block">
                  {t('pageBrowserVirtualBrowser') || 'جارٍ البحث عن الفيديو...'}
                </span>
              </div>
            )}
            {(status === 'found' || status === 'multiple') && selectedUrl && (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[11px] text-green-400">
                  {status === 'multiple'
                    ? `${detectedUrls.length} ${t('pageBrowserMultiple') || 'روابط'}`
                    : (t('pageBrowserFound') || 'تم الكشف')
                  }
                </span>
              </div>
            )}
            {status === 'not-found' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-orange-400">{t('pageBrowserNotFound') || 'لم يُكتشف — تفاعل مع الصفحة'}</span>
                <button
                  onClick={handleRetry}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  title="إعادة المحاولة"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-white/50" />
                </button>
              </div>
            )}
            {/* Multiple URLs toggle */}
            {status === 'multiple' && (
              <button
                onClick={() => setShowUrlList(v => !v)}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-xs text-white/70 transition-colors"
              >
                {showUrlList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {t('pageBrowserChoose') || 'اختر'}
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
              <X className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

        {/* URL list panel (expandable) */}
        {showUrlList && detectedUrls.length > 0 && (
          <div className="px-3 pb-2 space-y-1 max-h-40 overflow-y-auto border-t border-white/10 pt-2">
            {detectedUrls.map((v, i) => (
              <button
                key={i}
                onClick={() => handleManualPlay(v)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                  selectedUrl === v
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'bg-white/5 hover:bg-white/10 text-white/70'
                }`}
              >
                <Play className="w-3 h-3 shrink-0" />
                <span className="truncate">{shortenUrl(v)}</span>
                {/\.m3u8/i.test(v) && (
                  <span className="shrink-0 text-[10px] bg-blue-500/30 text-blue-300 px-1 rounded">HLS</span>
                )}
                {/\.mp4/i.test(v) && (
                  <span className="shrink-0 text-[10px] bg-green-500/30 text-green-300 px-1 rounded">MP4</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Page iframe ─────────────────────────────────────────────────────────── */}
      <div className="flex-grow relative overflow-hidden">
        <iframe
          ref={iframeRef}
          src={proxyUrl}
          referrerPolicy="no-referrer"
          className="w-full h-full border-0"
          style={{ background: '#000' }}
          allow="autoplay; fullscreen; encrypted-media"
        />

        {/* Found overlay — auto-dismisses */}
        {(status === 'found' || status === 'multiple') && selectedUrl && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 bg-black/80 backdrop-blur-sm border border-green-500/30 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
              <span className="text-xs text-green-300 max-w-[200px] truncate">
                {shortenUrl(selectedUrl, 40)}
              </span>
            </div>
          </div>
        )}

        {/* Searching overlay — subtle, doesn't block interaction */}
        {status === 'searching' && (
          <div className="absolute top-3 right-3 pointer-events-none">
            <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm border border-purple-500/20 rounded-lg px-2.5 py-1.5">
              <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
              <span className="text-[11px] text-purple-300">
                {t('pageBrowserVirtualBrowser') || 'يبحث...'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
