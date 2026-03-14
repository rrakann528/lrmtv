import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { User, X, Maximize2, Minimize2, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraggableCamProps {
  stream: MediaStream;
  label: string;
  onClose?: () => void;
  /** Mute audio output — set true for local stream to avoid echo */
  muteAudio?: boolean;
  /** Override initial position (defaults to bottom-right) */
  initialPos?: { x: number; y: number };
}

const MIN_W = 140;
const MIN_H = 90;
const MAX_W = 560;
const MAX_H = 360;
const DEFAULT_W = 220;
const DEFAULT_H = 140;

export function DraggableCam({ stream, label, onClose, muteAudio = false, initialPos }: DraggableCamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasVideo = stream.getVideoTracks().length > 0;

  // Position & size
  const [pos, setPos] = useState(() => initialPos ?? {
    x: window.innerWidth - DEFAULT_W - 16,
    y: window.innerHeight - DEFAULT_H - 80,
  });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [maximized, setMaximized] = useState(false);
  const [prevState, setPrevState] = useState<{ pos: typeof pos; size: typeof size } | null>(null);

  // Drag state
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Resize state
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  useEffect(() => {
    if (!muteAudio && audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {});
    }
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      if (hasVideo) videoRef.current.play().catch(() => {});
    }
  }, [stream, hasVideo, muteAudio]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (maximized) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [maximized, pos]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    const newX = Math.max(0, Math.min(window.innerWidth - size.w, dragStart.current.px + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - size.h, dragStart.current.py + dy));
    setPos({ x: newX, y: newY });
  }, [size]);

  const onDragEnd = useCallback(() => { dragging.current = false; }, []);

  // ── Resize ────────────────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const dx = e.clientX - resizeStart.current.mx;
    const dy = e.clientY - resizeStart.current.my;
    const newW = Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx));
    const newH = Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy));
    setSize({ w: newW, h: newH });
  }, []);

  const onResizeEnd = useCallback(() => { resizing.current = false; }, []);

  // Combined pointer handlers on the container
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    onDragMove(e);
    onResizeMove(e);
  }, [onDragMove, onResizeMove]);

  const onPointerUp = useCallback(() => {
    onDragEnd();
    onResizeEnd();
  }, [onDragEnd, onResizeEnd]);

  // ── Maximize toggle ───────────────────────────────────────────────────────
  const toggleMaximize = () => {
    if (!maximized) {
      setPrevState({ pos, size });
      setPos({ x: 8, y: 8 });
      setSize({ w: Math.min(window.innerWidth - 16, MAX_W), h: Math.min(window.innerHeight - 100, MAX_H) });
      setMaximized(true);
    } else {
      if (prevState) { setPos(prevState.pos); setSize(prevState.size); }
      setMaximized(false);
    }
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    width: size.w,
    height: size.h,
    zIndex: 9999,
    touchAction: 'none',
  };

  return createPortal(
    <div
      ref={containerRef}
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="rounded-xl overflow-hidden shadow-2xl border border-white/20 bg-zinc-900 flex flex-col select-none"
    >
      {/* Drag handle / title bar */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-black/80 cursor-grab active:cursor-grabbing shrink-0"
        onPointerDown={onDragStart}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="w-3 h-3 text-white/40 shrink-0" />
          <span className="text-[11px] text-white/80 font-medium truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={toggleMaximize}
            className="w-5 h-5 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition"
          >
            {maximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          {onClose && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded text-white/50 hover:text-red-400 hover:bg-white/10 transition"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Video */}
      <div className="flex-1 relative overflow-hidden">
        {!muteAudio && <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />}
        {hasVideo
          ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          : <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-zinc-800">
              <User className="w-8 h-8 text-white/20" />
              <span className="text-[11px] text-white/30">{label}</span>
            </div>
        }
      </div>

      {/* Resize handle (bottom-right corner) */}
      {!maximized && (
        <div
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize"
          onPointerDown={onResizeStart}
          style={{ touchAction: 'none' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" className="absolute bottom-1 right-1 text-white/30">
            <path d="M11 1L1 11M11 6L6 11M11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>,
    document.body
  );
}
