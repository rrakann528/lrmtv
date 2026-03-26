import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Globe, X, Loader2, CheckCircle, AlertTriangle, Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface PageBrowserProps {
  url: string;
  onVideoDetected: (videoUrl: string) => void;
  onClose: () => void;
}

export default function PageBrowser({ url, onVideoDetected, onClose }: PageBrowserProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'extracting' | 'found' | 'failed'>('extracting');
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const detectedRef = useRef(false);

  const handleDetected = useCallback((videoUrl: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    setDetectedUrl(videoUrl);
    setStatus('found');
    setTimeout(() => onVideoDetected(videoUrl), 1500);
  }, [onVideoDetected]);

  useEffect(() => {
    let cancelled = false;

    async function tryExtract() {
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 50000);

        const resp = await fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`, {
          signal: controller.signal,
        });
        clearTimeout(fetchTimeout);

        if (!resp.ok) throw new Error('extract failed');
        const data = await resp.json();

        if (cancelled || detectedRef.current) return;

        if (data.videos && data.videos.length > 0) {
          const best = data.videos.find((v: string) => /\.m3u8/i.test(v)) || data.videos[0];
          handleDetected(best);
          return;
        }
      } catch {}

      if (cancelled || detectedRef.current) return;
      setStatus('failed');
    }

    tryExtract();
    return () => { cancelled = true; };
  }, [url, handleDetected]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs text-white/70 truncate max-w-[200px] md:max-w-[400px]">{url}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {status === 'extracting' && (
              <>
                <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                <span className="text-[11px] text-purple-400">{t('pageBrowserVirtualBrowser') || 'Virtual browser scanning...'}</span>
              </>
            )}
            {status === 'found' && (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[11px] text-green-400">{t('pageBrowserFound')}</span>
              </>
            )}
            {status === 'failed' && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[11px] text-red-400">{t('pageBrowserTimeout')}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
      </div>

      <div className="flex-grow relative flex items-center justify-center">
        {status === 'extracting' && (
          <div className="text-center space-y-4">
            <div className="relative mx-auto w-16 h-16">
              <Search className="w-16 h-16 text-purple-400 animate-pulse" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-white/80 text-sm font-medium">{t('pageBrowserVirtualBrowser') || 'Virtual browser scanning...'}</p>
              <p className="text-white/40 text-xs">{t('pageBrowserVirtualBrowserDesc') || 'Opening page in headless browser...'}</p>
            </div>
          </div>
        )}

        {status === 'found' && detectedUrl && (
          <div className="text-center space-y-3 animate-pulse">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto" />
            <p className="text-white font-semibold text-lg">{t('pageBrowserDetected')}</p>
            <p className="text-white/50 text-sm max-w-xs truncate px-4">{detectedUrl}</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="text-center space-y-3">
            <AlertTriangle className="w-16 h-16 text-red-400/70 mx-auto" />
            <p className="text-white/70 text-sm">{t('pageBrowserTimeout')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
