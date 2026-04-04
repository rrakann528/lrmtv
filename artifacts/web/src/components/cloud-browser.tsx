import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, X, Loader2, Timer, MousePointer, Globe, Play, Check } from 'lucide-react';
import type { Socket } from 'socket.io-client';

interface CaughtUrl {
  url: string;
  score: number;
  type: string;
}

interface CloudBrowserProps {
  socket: Socket | null;
  roomSlug: string;
  onSelectVideo: (url: string, title: string) => void;
  inputUrl: string;
}

export default function CloudBrowser({ socket, roomSlug, onSelectVideo, inputUrl }: CloudBrowserProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'launching' | 'ready' | 'stopped'>('idle');
  const [error, setError] = useState('');
  const [caughtUrls, setCaughtUrls] = useState<CaughtUrl[]>([]);
  const [timeLeft, setTimeLeft] = useState(120);
  const [browserSize, setBrowserSize] = useState({ width: 1280, height: 720 });
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!socket) return;

    const onStatus = (data: { status: string; width?: number; height?: number }) => {
      setStatus(data.status as any);
      if (data.width && data.height) {
        setBrowserSize({ width: data.width, height: data.height });
      }
      if (data.status === 'ready') {
        setTimeLeft(120);
        timerRef.current = setInterval(() => {
          setTimeLeft(prev => {
            if (prev <= 1) return 0;
            return prev - 1;
          });
        }, 1000);
      }
      if (data.status === 'stopped') {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    const onFrame = (data: { data: string; width: number; height: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = data.width;
        canvas.height = data.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${data.data}`;
    };

    const onCaught = (data: { url: string; score: number; type: string; total: number }) => {
      setCaughtUrls(prev => {
        if (prev.some(u => u.url === data.url)) return prev;
        return [...prev, { url: data.url, score: data.score, type: data.type }].sort((a, b) => b.score - a.score);
      });
    };

    const onError = (data: { error: string }) => {
      setError(data.error);
      setStatus('stopped');
      if (timerRef.current) clearInterval(timerRef.current);
    };

    const onTimeout = () => {
      setStatus('stopped');
      setTimeLeft(0);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    socket.on('cloud-browser:status', onStatus);
    socket.on('cloud-browser:frame', onFrame);
    socket.on('cloud-browser:caught', onCaught);
    socket.on('cloud-browser:error', onError);
    socket.on('cloud-browser:timeout', onTimeout);

    return () => {
      socket.off('cloud-browser:status', onStatus);
      socket.off('cloud-browser:frame', onFrame);
      socket.off('cloud-browser:caught', onCaught);
      socket.off('cloud-browser:error', onError);
      socket.off('cloud-browser:timeout', onTimeout);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [socket]);

  const startSession = useCallback(() => {
    if (!socket || !inputUrl.trim()) return;
    setError('');
    setCaughtUrls([]);
    setStatus('launching');
    socket.emit('cloud-browser:start', { url: inputUrl.trim(), roomSlug });
  }, [socket, inputUrl, roomSlug]);

  const stopSession = useCallback(() => {
    if (!socket) return;
    socket.emit('cloud-browser:stop');
    setStatus('stopped');
    if (timerRef.current) clearInterval(timerRef.current);
  }, [socket]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = browserSize.width / rect.width;
    const scaleY = browserSize.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, [browserSize]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || status !== 'ready') return;
    const coords = getCanvasCoords(e);
    socket.emit('cloud-browser:mouse', { type: 'click', ...coords });
  }, [socket, status, getCanvasCoords]);

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || status !== 'ready') return;
    if (e.buttons === 0) return;
    const coords = getCanvasCoords(e);
    socket.emit('cloud-browser:mouse', { type: 'move', ...coords });
  }, [socket, status, getCanvasCoords]);

  const handleScroll = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!socket || status !== 'ready') return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    socket.emit('cloud-browser:scroll', { ...coords, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [socket, status, getCanvasCoords]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!socket || status !== 'ready') return;
    e.preventDefault();
    socket.emit('cloud-browser:keyboard', { type: 'keydown', key: e.key });
  }, [socket, status]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (!socket || status !== 'ready') return;
    e.preventDefault();
    socket.emit('cloud-browser:keyboard', { type: 'keyup', key: e.key });
  }, [socket, status]);

  const handleSelectUrl = useCallback((url: string) => {
    if (!socket) return;
    const type = url.includes('.m3u8') ? 'M3U8' : url.includes('.mpd') ? 'MPD' : 'MP4';
    socket.emit('cloud-browser:use-url', { url });
    onSelectVideo(url, `${type} (Cloud)`);
    setStatus('stopped');
    if (timerRef.current) clearInterval(timerRef.current);
  }, [socket, onSelectVideo]);

  const typeColor: Record<string, string> = {
    m3u8: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    mp4: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    mpd: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  };

  if (status === 'idle' || status === 'stopped') {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={startSession}
          disabled={!inputUrl.trim()}
          className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all hover:brightness-110"
        >
          <Monitor className="w-4 h-4" />
          <span>تشغيل المتصفح اليدوي</span>
        </button>
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}
        <p className="text-white/40 text-xs text-center">
          تحكم يدوي بالمتصفح — اضغط Play بنفسك والسيرفر يصطاد الرابط تلقائياً
          <br />
          <span className="text-white/30">الجلسة محدودة بدقيقتين</span>
        </p>

        {caughtUrls.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            <p className="text-white/50 text-xs font-medium">روابط تم صيدها:</p>
            {caughtUrls.map((item) => (
              <motion.button
                key={item.url}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => handleSelectUrl(item.url)}
                className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-emerald-500/30 transition-all text-left group"
                dir="ltr"
              >
                <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <Play className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${typeColor[item.type] || typeColor.mp4}`}>
                    {item.type.toUpperCase()}
                  </span>
                  <p className="text-white/60 text-xs truncate font-mono mt-1">{item.url}</p>
                </div>
                <Check className="w-4 h-4 text-white/30 group-hover:text-emerald-400 transition-colors" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (status === 'launching') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
          <Monitor className="w-5 h-5 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <p className="text-white/60 text-sm text-center">
          جاري تشغيل المتصفح السحابي...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 text-xs font-medium">متصفح نشط</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-white/50 text-xs">
            <Timer className="w-3 h-3" />
            <span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
          </div>
          <button
            onClick={stopSession}
            className="px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs flex items-center gap-1 transition-colors"
          >
            <X className="w-3 h-3" />
            إيقاف
          </button>
        </div>
      </div>

      <div
        className="relative rounded-lg overflow-hidden border border-white/10 bg-black focus:outline-none focus:border-emerald-500/50"
        style={{ cursor: 'crosshair' }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          onWheel={handleScroll}
          className="w-full h-auto"
          style={{ aspectRatio: `${browserSize.width}/${browserSize.height}` }}
        />
        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 rounded px-2 py-1 text-white/50 text-[10px]">
          <MousePointer className="w-3 h-3" />
          اضغط على الفيديو لتشغيله
        </div>
      </div>

      <AnimatePresence>
        {caughtUrls.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-1.5 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20"
          >
            <p className="text-emerald-300 text-xs font-medium flex items-center gap-1">
              <Check className="w-3 h-3" />
              تم صيد {caughtUrls.length} رابط — اختر واحداً:
            </p>
            {caughtUrls.map((item) => (
              <button
                key={item.url}
                onClick={() => handleSelectUrl(item.url)}
                className="flex items-center gap-2 p-2 rounded bg-white/5 hover:bg-emerald-500/10 transition-all text-left group"
                dir="ltr"
              >
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${typeColor[item.type] || typeColor.mp4}`}>
                  {item.type.toUpperCase()}
                </span>
                <span className="text-white/60 text-xs truncate font-mono flex-1">{item.url}</span>
                <Play className="w-3 h-3 text-white/30 group-hover:text-emerald-400 transition-colors shrink-0" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
