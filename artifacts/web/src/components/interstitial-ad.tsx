import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const COUNTDOWN = 5;

interface Props {
  onDone: () => void;
}

export default function InterstitialAd({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  return createPortal(
    <div className="fixed inset-0 z-[9999]">

      {/* Full-screen Adcash interstitial iframe — same-origin so CDN loads correctly */}
      <iframe
        src="/ad-interstitial.html"
        sandbox="allow-scripts allow-popups allow-same-origin"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
        title="interstitial-ad"
      />

      {/* Countdown + skip — sits above iframe in React layer */}
      <div
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}
        className="flex justify-end items-center px-4 pt-4"
      >
        {seconds > 0 ? (
          <div className="bg-black/70 text-white text-sm px-4 py-2 rounded-full font-mono backdrop-blur-sm">
            تخطي بعد {seconds}ث
          </div>
        ) : (
          <AnimatePresence>
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onDone}
              className="bg-white text-black text-sm font-bold px-5 py-2 rounded-full shadow-xl active:scale-95 transition-all"
            >
              تخطي ← دخول الغرفة
            </motion.button>
          </AnimatePresence>
        )}
      </div>

      {/* Progress bar at bottom */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
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
