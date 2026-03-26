import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Globe, X, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface PageBrowserProps {
  url: string;
  onVideoDetected: (videoUrl: string) => void;
  onClose: () => void;
}

export default function PageBrowser({ url, onVideoDetected, onClose }: PageBrowserProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'scanning' | 'found' | 'timeout'>('loading');
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const detectedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((e: MessageEvent) => {
    if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
    if (e.data?.type === 'lrmtv-video-detected' && e.data.url && !detectedRef.current) {
      const videoUrl = String(e.data.url);
      if (!videoUrl.startsWith('http')) return;
      detectedRef.current = true;
      setDetectedUrl(videoUrl);
      setStatus('found');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTimeout(() => onVideoDetected(videoUrl), 1500);
    }
  }, [onVideoDetected]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (!detectedRef.current) setStatus('timeout');
    }, 60000);
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
        <iframe
          ref={iframeRef}
          src={proxyUrl}
          onLoad={handleIframeLoad}
          referrerPolicy="no-referrer"
          className="w-full h-full border-0"
          style={{ background: '#000' }}
        />

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
