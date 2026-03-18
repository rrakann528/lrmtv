/*
 * RoomInterstitial — triggers a real Adcash interstitial then navigates to the room.
 *
 * aclib.js is already loaded globally (index.html).
 * aclib.runInterstitial() opens its own full-screen overlay managed by Adcash.
 * Our React layer provides the countdown + skip button layered on top so the user
 * can always escape after 5 seconds regardless of whether the ad loaded.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const COUNTDOWN = 5;

interface Props {
  onDone: () => void;
}

declare global {
  interface Window {
    aclib?: {
      runBanner:       (opts: { zoneId: string }) => void;
      runInterstitial: (opts: { zoneId: string }) => void;
    };
  }
}

export default function RoomInterstitial({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);

  /* Fire the real interstitial once */
  useEffect(() => {
    try {
      window.aclib?.runInterstitial({ zoneId: '11083266' });
    } catch (_) {}
  }, []);

  /* Countdown */
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  /* Auto-navigate 3 s after countdown reaches 0 */
  useEffect(() => {
    if (seconds !== 0) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [seconds, onDone]);

  return createPortal(
    /* Transparent overlay — lets the Adcash interstitial (behind) show through.
       We only render the countdown badge + skip button + progress bar on top. */
    <div
      className="fixed inset-0 z-[9998] pointer-events-none"
      data-ad-zone="true"
    >
      {/* Countdown / skip — needs pointer events */}
      <div className="absolute top-0 inset-x-0 flex justify-end p-4 pointer-events-auto">
        {seconds > 0 ? (
          <div className="bg-black/80 backdrop-blur text-white text-sm px-4 py-2 rounded-full font-mono border border-white/20 select-none">
            تخطي بعد {seconds}ث
          </div>
        ) : (
          <AnimatePresence>
            <motion.button
              key="skip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onDone}
              className="bg-white text-black font-bold text-sm px-5 py-2 rounded-full shadow-xl active:scale-95 transition-all"
            >
              تخطي ← دخول الغرفة
            </motion.button>
          </AnimatePresence>
        )}
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20 pointer-events-none">
        <motion.div
          className="h-full bg-white"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: COUNTDOWN, ease: 'linear' }}
        />
      </div>
    </div>,
    document.body
  );
}
