import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Globe, X, Loader2, CheckCircle, AlertCircle, RefreshCw, Play, Film, Wifi
} from 'lucide-react';

interface PageBrowserProps {
  url: string;
  onVideoDetected: (videoUrl: string) => void;
  onClose: () => void;
}

type Status = 'scanning' | 'found' | 'not-found' | 'error';

interface Step {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
}

function getHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function getFaviconUrl(url: string): string {
  try { const u = new URL(url); return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`; }
  catch { return ''; }
}

function pickBest(urls: string[]): string {
  const hls = urls.find(v => /\.m3u8/i.test(v));
  if (hls) return hls;
  const mp4 = urls.find(v => /\.mp4/i.test(v));
  if (mp4) return mp4;
  return urls[0];
}

function getVideoType(url: string): string {
  if (/\.m3u8/i.test(url)) return 'HLS';
  if (/\.mp4/i.test(url)) return 'MP4';
  if (/\.webm/i.test(url)) return 'WebM';
  if (/\.dash|\.mpd/i.test(url)) return 'DASH';
  return 'Stream';
}

export default function PageBrowser({ url, onVideoDetected, onClose }: PageBrowserProps) {
  const [status, setStatus] = useState<Status>('scanning');
  const [foundUrl, setFoundUrl] = useState<string | null>(null);
  const [allUrls, setAllUrls] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [steps, setSteps] = useState<Step[]>([
    { id: 'open',    label: 'فتح المتصفح',       done: false, active: true  },
    { id: 'nav',     label: 'تحميل الصفحة',      done: false, active: false },
    { id: 'scan',    label: 'البحث عن الفيديو',  done: false, active: false },
    { id: 'extract', label: 'استخراج الرابط',    done: false, active: false },
  ]);

  const detectedRef = useRef(false);
  const hostname = getHostname(url);
  const favicon = getFaviconUrl(url);

  // Progress steps animation
  useEffect(() => {
    if (status !== 'scanning') return;
    const timings = [0, 2000, 5000, 10000];
    const timers = timings.map((delay, i) =>
      setTimeout(() => {
        setSteps(prev => prev.map((s, idx) => ({
          ...s,
          done: idx < i,
          active: idx === i,
        })));
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [status]);

  // Elapsed timer
  useEffect(() => {
    if (status !== 'scanning') return;
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const handleFound = useCallback((videos: string[]) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    const best = pickBest(videos);
    setFoundUrl(best);
    setAllUrls(videos);
    setSteps(prev => prev.map(s => ({ ...s, done: true, active: false })));
    setStatus('found');
    // Auto-play after showing success for 1.5 seconds
    setTimeout(() => {
      onVideoDetected(best);
    }, 1500);
  }, [onVideoDetected]);

  // Server-side Playwright extraction
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (cancelled) return;
        if (data?.videos?.length > 0) {
          handleFound(data.videos as string[]);
        } else {
          if (!detectedRef.current) setStatus('not-found');
        }
      })
      .catch(err => {
        if (cancelled) return;
        if (!detectedRef.current) {
          setStatus(err === 429 ? 'error' : 'not-found');
        }
      });

    return () => { cancelled = true; controller.abort(); };
  }, [url, handleFound]);

  const handleRetry = () => {
    detectedRef.current = false;
    setStatus('scanning');
    setFoundUrl(null);
    setAllUrls([]);
    setElapsed(0);
    setSteps(prev => prev.map((s, i) => ({ ...s, done: false, active: i === 0 })));
    // Re-trigger effect by forcing re-mount isn't possible directly,
    // so we use a key change approach — parent should handle this.
    // For now, just re-fetch manually:
    fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.videos?.length > 0) handleFound(data.videos);
        else setStatus('not-found');
      })
      .catch(() => setStatus('not-found'));
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm">

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white"
      >
        <X className="w-5 h-5" />
      </button>

      {/* ── Main card ─────────────────────────────────────────────────────────── */}
      <div className="w-full max-w-sm mx-4 space-y-5">

        {/* Site info */}
        <div className="flex items-center gap-3 justify-center">
          {favicon && (
            <img
              src={favicon}
              alt=""
              className="w-8 h-8 rounded-md"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div>
            <p className="text-white font-semibold text-sm">{hostname}</p>
            <p className="text-white/40 text-xs truncate max-w-[220px]">{url}</p>
          </div>
        </div>

        {/* ── Scanning state ─────────────────────────────────────────────────── */}
        {status === 'scanning' && (
          <div className="space-y-4">
            {/* Animated browser icon */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Globe className="w-7 h-7 text-primary" />
                </div>
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                  <Loader2 className="w-3 h-3 text-white animate-spin" />
                </div>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {steps.map(step => (
                <div key={step.id} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                    step.done
                      ? 'bg-green-500'
                      : step.active
                        ? 'bg-primary animate-pulse'
                        : 'bg-white/10'
                  }`}>
                    {step.done
                      ? <CheckCircle className="w-3 h-3 text-white" />
                      : step.active
                        ? <Loader2 className="w-3 h-3 text-white animate-spin" />
                        : <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                    }
                  </div>
                  <span className={`text-sm transition-colors duration-300 ${
                    step.done ? 'text-green-400' : step.active ? 'text-white' : 'text-white/30'
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Elapsed */}
            <p className="text-center text-white/30 text-xs">
              {elapsed}s — {'قد يستغرق حتى 30 ثانية'}
            </p>
          </div>
        )}

        {/* ── Found state ────────────────────────────────────────────────────── */}
        {status === 'found' && foundUrl && (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <div>
              <p className="text-white font-semibold text-base">تم كشف الفيديو!</p>
              <p className="text-white/40 text-xs mt-1">جارٍ التشغيل في الغرفة...</p>
            </div>
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <Film className="w-4 h-4 text-green-400 shrink-0" />
              <span className="text-green-300 text-xs truncate flex-1">{foundUrl.slice(0, 60)}…</span>
              <span className="text-[10px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded shrink-0">
                {getVideoType(foundUrl)}
              </span>
            </div>
            {allUrls.length > 1 && (
              <p className="text-white/30 text-xs">
                {allUrls.length} روابط وجدت — أفضل واحد يُشغَّل تلقائياً
              </p>
            )}
          </div>
        )}

        {/* ── Not found state ────────────────────────────────────────────────── */}
        {status === 'not-found' && (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <Wifi className="w-7 h-7 text-orange-400" />
              </div>
            </div>
            <div>
              <p className="text-white font-semibold">لم يُكتشف رابط مباشر</p>
              <p className="text-white/40 text-sm mt-1">الموقع محمي أو يحتاج تفاعل يدوي</p>
            </div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                إعادة المحاولة
              </button>
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* ── Error state ─────────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-red-400" />
              </div>
            </div>
            <p className="text-white font-semibold">حدث خطأ</p>
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة المحاولة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
