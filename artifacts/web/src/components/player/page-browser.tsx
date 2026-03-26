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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'extracting' | 'loading' | 'scanning' | 'found' | 'timeout'>('extracting');
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const detectedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showIframe, setShowIframe] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);

  const handleDetected = useCallback((videoUrl: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    setDetectedUrl(videoUrl);
    setStatus('found');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setTimeout(() => onVideoDetected(videoUrl), 1500);
  }, [onVideoDetected]);

  useEffect(() => {
    let cancelled = false;

    async function tryExtract() {
      try {
        const resp = await fetch(`/api/proxy/extract?url=${encodeURIComponent(url)}`);
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
      setExtractFailed(true);
      setShowIframe(true);
      setStatus('loading');
    }

    tryExtract();
    return () => { cancelled = true; };
  }, [url, handleDetected]);

  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'lrmtv-video-detected' && e.data.url && !detectedRef.current) {
      const videoUrl = String(e.data.url);
      if (!videoUrl.startsWith('http')) return;
      handleDetected(videoUrl);
    }
  }, [handleDetected]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (!detectedRef.current) setStatus('timeout');
    }, 120000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const handleIframeLoad = useCallback(() => {
    if (status === 'loading') setStatus('scanning');
  }, [status]);

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(url)}`;

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
                <Search className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <span className="text-[11px] text-purple-400">{t('pageBrowserExtracting') || 'Extracting...'}</span>
              </>
            )}
            {status === 'loading' && (
              <>
                <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                <span className="text-[11px] text-blue-400">{t('pageBrowserLoading')}</span>
              </>
            )}
            {status === 'scanning' && (
              <>
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-[11px] text-amber-400">{t('pageBrowserScanning')}</span>
              </>
            )}
            {status === 'found' && (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[11px] text-green-400">{t('pageBrowserFound')}</span>
              </>
            )}
            {status === 'timeout' && (
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

      <div className="flex-grow relative">
        {status === 'extracting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Search className="w-12 h-12 text-purple-400 mx-auto animate-pulse" />
              <p className="text-white/70 text-sm">{t('pageBrowserExtracting') || 'Searching for video...'}</p>
            </div>
          </div>
        )}

        {showIframe && (
          <iframe
            ref={iframeRef}
            src={proxyUrl}
            onLoad={handleIframeLoad}
            referrerPolicy="no-referrer"
            className="w-full h-full border-0"
            style={{ background: '#000' }}
          />
        )}

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
