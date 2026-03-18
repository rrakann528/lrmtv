import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const ZONE_ID   = '11083266';
const COUNTDOWN = 5;
const RADIUS    = 20;
const CIRCUM    = 2 * Math.PI * RADIUS;

function suppressAclibErrors() {
  const onErr = (e: ErrorEvent) => { e.preventDefault(); };
  const onRej = (e: PromiseRejectionEvent) => { e.preventDefault(); };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);
  setTimeout(() => {
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
  }, 8000);
}

function runInterstitial() {
  suppressAclibErrors();
  const ua = navigator.userAgent;
  (window as any).isIos     ??= /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  (window as any).isSafari  ??= /^((?!chrome|android).)*safari/i.test(ua);
  (window as any).isAndroid ??= /android/i.test(ua);

  const fire = () => {
    try { (window as any).aclib?.runInterstitial({ zoneId: ZONE_ID }); } catch (_) {}
  };

  if ((window as any).aclib) { fire(); return; }
  if (!document.getElementById('aclib-script')) {
    const s = document.createElement('script');
    s.id = 'aclib-script';
    s.src = '//acscdn.com/script/aclib.js';
    s.onload = fire;
    s.onerror = () => {};
    document.head.appendChild(s);
  } else {
    let n = 0;
    const t = setInterval(() => {
      if ((window as any).aclib || ++n > 20) { clearInterval(t); fire(); }
    }, 100);
  }
}

interface Props { onDone: () => void; }

export default function InterstitialAd({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);
  const [done, setDone] = useState(false);

  useEffect(() => { try { runInterstitial(); } catch (_) {} }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  // Mark done when countdown reaches 0, auto-navigate after 3 more seconds
  useEffect(() => {
    if (seconds !== 0) return;
    setDone(true);
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [seconds, onDone]);

  const progress = seconds / COUNTDOWN; // 1 → 0

  return createPortal(
    <>
      {/* Transparent backdrop — allows Adcash overlay to show on top */}
      <div className="fixed inset-0 z-[9990] pointer-events-none" />

      {/* Circular countdown in top-right */}
      <div
        className="fixed z-[10000]"
        style={{ top: 16, right: 16, pointerEvents: done ? 'auto' : 'none' }}
      >
        <AnimatePresence mode="wait">
          {!done ? (
            /* Countdown ring */
            <motion.div
              key="ring"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="relative flex items-center justify-center"
              style={{ width: 52, height: 52 }}
            >
              <svg width={52} height={52} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
                <circle cx={26} cy={26} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
                <motion.circle
                  cx={26} cy={26} r={RADIUS}
                  fill="none"
                  stroke="white"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={CIRCUM}
                  initial={{ strokeDashoffset: 0 }}
                  animate={{ strokeDashoffset: CIRCUM }}
                  transition={{ duration: COUNTDOWN, ease: 'linear' }}
                />
              </svg>
              <span className="text-white text-sm font-bold relative z-10">{seconds}</span>
            </motion.div>
          ) : (
            /* X close button */
            <motion.button
              key="close"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onDone}
              className="w-12 h-12 rounded-full bg-black/70 border border-white/30 backdrop-blur-sm flex items-center justify-center text-white text-xl font-bold active:scale-90 transition-all"
            >
              ✕
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>,
    document.body
  );
}
