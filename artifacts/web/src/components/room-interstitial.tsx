/*
 * RoomInterstitial — full-screen ad overlay shown when entering a room.
 *
 * Strategy:
 *  • Custom React overlay — works 100% regardless of aclib state.
 *  • Shows two banner iframes (same null-origin sandbox as AdBanner).
 *  • 5-second countdown → skip button appears → user enters room.
 *  • Auto-navigates 3 s after countdown if user doesn't tap skip.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const ZONE = '11082246';
const COUNTDOWN = 5;

const makeSrcdoc = (key: string) => `<!DOCTYPE html>
<html>
<head>
<style>
  *,html,body{margin:0;padding:0;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;
       width:100%;height:80px;background:transparent}
</style>
</head>
<body>
<script>
  var ua=navigator.userAgent;
  window.isIos=/iPad|iPhone|iPod/.test(ua)&&!window.MSStream;
  window.isSafari=/^((?!chrome|android).)*safari/i.test(ua);
  window.isAndroid=/android/i.test(ua);
  window.onerror=function(){return true;};
  window.addEventListener('unhandledrejection',function(e){e.preventDefault();});
<\/script>
<script src="//acscdn.com/script/aclib.js?r=${key}"><\/script>
<script>
  window.addEventListener('load',function(){
    try{aclib.runBanner({zoneId:'${ZONE}'});}catch(e){}
  });
<\/script>
</body>
</html>`;

interface Props {
  onDone: () => void;
}

export default function RoomInterstitial({ onDone }: Props) {
  const [seconds, setSeconds] = useState(COUNTDOWN);

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95"
    >
      {/* Header row */}
      <div className="w-full max-w-xs flex items-center justify-between px-2 mb-5">
        <span className="text-white/30 text-xs">إعلان</span>
        {seconds > 0 ? (
          <span className="text-white/60 text-sm font-mono bg-white/10 px-3 py-1 rounded-full">
            تخطي خلال {seconds}ث
          </span>
        ) : (
          <AnimatePresence>
            <motion.button
              key="skip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onDone}
              className="text-sm font-bold bg-primary text-primary-foreground px-4 py-1.5 rounded-full shadow-lg active:scale-95 transition-all"
            >
              تخطي ←
            </motion.button>
          </AnimatePresence>
        )}
      </div>

      {/* Two banner iframes stacked */}
      <div className="flex flex-col gap-3 items-center">
        {(['a', 'b'] as const).map(key => (
          <div key={key} className="rounded-xl overflow-hidden shadow-2xl w-[320px]">
            <iframe
              srcDoc={makeSrcdoc(key)}
              sandbox="allow-scripts allow-popups"
              scrolling="no"
              style={{ width: 320, height: 80, border: 0, display: 'block' }}
              title={`ad-${key}`}
            />
          </div>
        ))}
      </div>

      {/* Enter button (after countdown) */}
      {seconds === 0 && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={onDone}
          className="mt-8 px-8 py-3 bg-primary text-primary-foreground rounded-2xl font-bold text-base shadow-xl shadow-primary/30 active:scale-95 transition-all"
        >
          دخول الغرفة
        </motion.button>
      )}

      {/* Progress bar */}
      <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: COUNTDOWN, ease: 'linear' }}
        />
      </div>
    </motion.div>,
    document.body
  );
}
