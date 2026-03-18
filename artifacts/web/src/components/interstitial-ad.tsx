import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const ZONE_ID = '11083266';
const COUNTDOWN = 5;

// aclib.js is already loaded in index.html
function fireInterstitial() {
  const run = () => {
    try { (window as any).aclib?.runInterstitial({ zoneId: ZONE_ID }); } catch (_) {}
  };
  if ((window as any).aclib) { run(); return; }
  const t = setInterval(() => {
    if ((window as any).aclib) { clearInterval(t); run(); }
  }, 100);
  setTimeout(() => clearInterval(t), 5000);
}

interface Props {
  onDone: () => void;
}

export default function InterstitialAd({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);

  useEffect(() => { fireInterstitial(); }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  useEffect(() => {
    if (seconds !== 0) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [seconds, onDone]);

  return createPortal(
    <div className="fixed inset-0 z-[9990]" style={{ pointerEvents: 'none' }}>
      {/* Skip button */}
      <div
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10000, pointerEvents: 'auto' }}
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
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10000, pointerEvents: 'none' }}>
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
