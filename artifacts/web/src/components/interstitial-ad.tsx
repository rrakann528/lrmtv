import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const ZONE_ID = '11083266';
const COUNTDOWN = 5;

function loadAclibAndRunInterstitial() {
  const run = () => {
    try { (window as any).aclib.runInterstitial({ zoneId: ZONE_ID }); } catch (_) {}
  };
  if ((window as any).aclib) { run(); return; }
  if (document.getElementById('aclib-script')) {
    const wait = setInterval(() => {
      if ((window as any).aclib) { clearInterval(wait); run(); }
    }, 100);
    return;
  }
  const s = document.createElement('script');
  s.id = 'aclib-script';
  s.src = '//acscdn.com/script/aclib.js';
  s.onload = run;
  document.head.appendChild(s);
}

interface Props {
  onDone: () => void;
}

export default function InterstitialAd({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);

  useEffect(() => {
    loadAclibAndRunInterstitial();
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  // Auto-navigate when countdown reaches 0 after a short grace period
  useEffect(() => {
    if (seconds === 0) {
      const t = setTimeout(onDone, 3000); // 3 extra seconds grace
      return () => clearTimeout(t);
    }
  }, [seconds, onDone]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9990] bg-black/60"
      style={{ pointerEvents: 'none' }}
    >
      {/* Countdown + skip — always interactive */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10000,
          pointerEvents: 'auto',
        }}
        className="flex justify-end items-center px-4 pt-4"
      >
        {seconds > 0 ? (
          <div className="bg-black/80 text-white text-sm px-4 py-2 rounded-full font-mono backdrop-blur-sm border border-white/20">
            تخطي بعد {seconds}ث
          </div>
        ) : (
          <AnimatePresence>
            <motion.button
              key="skip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onDone}
              style={{ pointerEvents: 'auto' }}
              className="bg-white text-black text-sm font-bold px-5 py-2 rounded-full shadow-xl active:scale-95 transition-all"
            >
              تخطي ← دخول الغرفة
            </motion.button>
          </AnimatePresence>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          zIndex: 10000, pointerEvents: 'none',
        }}
      >
        <div className="h-1 bg-white/20">
          <motion.div
            className="h-full bg-white"
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: COUNTDOWN, ease: 'linear' }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
