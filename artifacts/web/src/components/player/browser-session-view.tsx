import React, {
  useEffect, useRef, useState, useCallback,
} from 'react';
import {
  X, ArrowLeft, ArrowRight, RotateCcw, Loader2,
  CheckCircle, Globe,
} from 'lucide-react';

interface BrowserSessionViewProps {
  socket: any;
  roomSlug: string;
  initialUrl: string;
  onVideoFound: (url: string) => void;
  onClose: () => void;
  canControl: boolean;
}

const BROWSER_W = 1280;
const BROWSER_H = 720;

export default function BrowserSessionView({
  socket,
  roomSlug,
  initialUrl,
  onVideoFound,
  onClose,
  canControl,
}: BrowserSessionViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(true);
  const [videoFoundUrl, setVideoFoundUrl] = useState<string | null>(null);
  const scaleRef = useRef({ x: 1, y: 1 });
  const videoFoundRef = useRef(false);

  // Start browser session when component mounts
  useEffect(() => {
    socket.emit('browser:start', { slug: roomSlug, url: initialUrl });

    const onStarted = () => setIsStarting(false);
    const onError = ({ message }: { message: string }) => {
      console.error('[browser-session] error:', message);
      setIsStarting(false);
    };
    const onState = ({ url, loading }: { url: string; loading: boolean }) => {
      setCurrentUrl(url);
      setInputUrl(url);
      setIsLoading(loading);
      setIsStarting(false);
    };
    const handleVideoFound = ({ url }: { url: string }) => {
      if (videoFoundRef.current) return;
      videoFoundRef.current = true;
      setVideoFoundUrl(url);
      setTimeout(() => {
        onVideoFound(url);
      }, 1800);
    };

    socket.on('browser:started', onStarted);
    socket.on('browser:error', onError);
    socket.on('browser:state', onState);
    socket.on('browser:video-found', handleVideoFound);

    return () => {
      if (!videoFoundRef.current) {
        socket.emit('browser:stop', { slug: roomSlug });
      }
      socket.off('browser:started', onStarted);
      socket.off('browser:error', onError);
      socket.off('browser:state', onState);
      socket.off('browser:video-found', handleVideoFound);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render frames onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleFrame = ({ data }: { data: string }) => {
      setIsStarting(false);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Update scale for input coordinate mapping
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          scaleRef.current = {
            x: BROWSER_W / rect.width,
            y: BROWSER_H / rect.height,
          };
        }
      };
      img.src = `data:image/jpeg;base64,${data}`;
    };

    socket.on('browser:frame', handleFrame);
    return () => socket.off('browser:frame', handleFrame);
  }, [socket]);

  // Convert mouse event to browser coordinates
  const getCoords = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * scaleRef.current.x),
      y: Math.round((e.clientY - rect.top) * scaleRef.current.y),
    };
  }, []);

  const getModifiers = (e: React.MouseEvent | React.KeyboardEvent): number => {
    let m = 0;
    if (e.altKey)   m |= 1;
    if (e.ctrlKey)  m |= 2;
    if (e.metaKey)  m |= 4;
    if (e.shiftKey) m |= 8;
    return m;
  };

  const emit = useCallback((type: string, extra = {}) => {
    if (!canControl) return;
    socket.emit('browser:input', { slug: roomSlug, type, ...extra });
  }, [canControl, socket, roomSlug]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = getCoords(e);
    emit('mousedown', { x, y, button: e.button === 2 ? 'right' : 'left', modifiers: getModifiers(e) });
    (e.currentTarget as HTMLElement).focus();
  }, [emit, getCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const { x, y } = getCoords(e);
    emit('mouseup', { x, y, button: e.button === 2 ? 'right' : 'left', modifiers: getModifiers(e) });
  }, [emit, getCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 0 && e.type !== 'mousemove') return;
    const { x, y } = getCoords(e);
    emit('mousemove', { x, y, modifiers: getModifiers(e) });
  }, [emit, getCoords]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    emit('wheel', { x, y, deltaY: e.deltaY });
  }, [emit, getCoords]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    emit('keydown', { key: e.key, code: e.code, modifiers: getModifiers(e) });
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      emit('char', { text: e.key });
    }
  }, [emit]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    emit('keyup', { key: e.key, code: e.code, modifiers: getModifiers(e) });
  }, [emit]);

  const handleNavigate = (url: string) => {
    let nav = url.trim();
    if (!nav.startsWith('http')) nav = 'https://' + nav;
    socket.emit('browser:navigate', { slug: roomSlug, url: nav });
    setIsLoading(true);
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#1c1c1e]">

      {/* ── Browser chrome bar ───────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 bg-[#2c2c2e] border-b border-white/10">
        {/* Nav buttons */}
        <button
          onClick={() => socket.emit('browser:back', { slug: roomSlug })}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          title="رجوع"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => socket.emit('browser:forward', { slug: roomSlug })}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          title="تقدم"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => socket.emit('browser:refresh', { slug: roomSlug })}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          title="تحديث"
        >
          {isLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
            : <RotateCcw className="w-4 h-4" />}
        </button>

        {/* URL bar */}
        <form
          className="flex-1 flex items-center"
          onSubmit={e => { e.preventDefault(); handleNavigate(inputUrl); }}
        >
          <div className="flex-1 flex items-center bg-black/30 border border-white/10 rounded-md px-2.5 gap-1.5">
            <Globe className="w-3.5 h-3.5 text-white/30 shrink-0" />
            <input
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              onFocus={e => e.target.select()}
              className="flex-1 bg-transparent text-white text-xs py-1.5 focus:outline-none min-w-0"
              dir="ltr"
            />
          </div>
        </form>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          title="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Browser canvas ───────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-black"
      >
        <canvas
          ref={canvasRef}
          width={BROWSER_W}
          height={BROWSER_H}
          className="w-full h-full object-contain"
          style={{ cursor: canControl ? 'default' : 'not-allowed', display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          tabIndex={0}
          onContextMenu={e => e.preventDefault()}
        />

        {/* Starting overlay */}
        {isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-white text-sm">جارٍ تشغيل المتصفح...</p>
            <p className="text-white/40 text-xs">{initialUrl.slice(0, 60)}</p>
          </div>
        )}

        {/* Video found banner */}
        {videoFoundUrl && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-none">
            <div className="flex items-center gap-2 bg-green-600/90 backdrop-blur border border-green-400/30 rounded-xl px-4 py-2.5 shadow-lg">
              <CheckCircle className="w-5 h-5 text-white shrink-0" />
              <div>
                <p className="text-white text-sm font-semibold">تم كشف الفيديو!</p>
                <p className="text-green-200 text-xs">جارٍ التشغيل في الغرفة...</p>
              </div>
            </div>
          </div>
        )}

        {/* Non-DJ overlay */}
        {!canControl && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-black/60 backdrop-blur border border-white/10 rounded-lg px-3 py-1.5">
              <p className="text-white/50 text-xs">المتصفح متاح للـ DJ فقط</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
