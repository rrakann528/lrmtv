import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Globe, X, Loader2, CheckCircle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface PageBrowserProps {
  url: string;
  onVideoDetected: (videoUrl: string) => void;
  onClose: () => void;
}

export default function PageBrowser({ url, onVideoDetected, onClose }: PageBrowserProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'searching' | 'found'>('searching');
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const detectedRef = useRef(false);

  const handleDetected = useCallback((videoUrl: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    setDetectedUrl(videoUrl);
    setStatus('found');
    setTimeout(() => onVideoDetected(videoUrl), 1200);
  }, [onVideoDetected]);

  // — Virtual browser extraction (background) —
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 50000);

    fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        clearTimeout(fetchTimeout);
        if (cancelled || detectedRef.current) return;
        if (data?.videos?.length > 0) {
          const best = data.videos.find((v: string) => /\.m3u8/i.test(v)) || data.videos[0];
          handleDetected(best);
        }
      })
      .catch(() => clearTimeout(fetchTimeout));

    return () => { cancelled = true; controller.abort(); };
  }, [url, handleDetected]);

  // — Interactive iframe detection (postMessage from bridge script) —
  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'lrmtv-video-detected' && e.data.url && !detectedRef.current) {
      const videoUrl = String(e.data.url);
      if (videoUrl.startsWith('http')) handleDetected(videoUrl);
    }
  }, [handleDetected]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(url)}`;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs text-white/70 truncate max-w-[200px] md:max-w-[400px]">{url}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {status === 'searching' && (
              <>
                <Search className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                <span className="text-[11px] text-purple-400">
                  {t('pageBrowserVirtualBrowser') || 'Scanning...'}
                </span>
              </>
            )}
            {status === 'found' && (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[11px] text-green-400">{t('pageBrowserFound')}</span>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
      </div>

      {/* Page iframe — always visible so user can interact */}
      <div className="flex-grow relative">
        <iframe
          ref={iframeRef}
          src={proxyUrl}
          referrerPolicy="no-referrer"
          className="w-full h-full border-0"
          style={{ background: '#000' }}
        />

        {/* Found overlay */}
        {status === 'found' && detectedUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
            <div className="text-center space-y-3 animate-pulse">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto" />
              <p className="text-white font-semibold text-lg">{t('pageBrowserDetected')}</p>
              <p className="text-white/50 text-sm max-w-xs truncate px-4">{detectedUrl}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
