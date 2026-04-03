import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 2600),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -60, filter: 'blur(12px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Accent line top */}
      {phase >= 1 && (
        <motion.div
          className="absolute top-[18%] left-0 h-[3px] bg-[#06B6D4] rounded-r-full"
          initial={{ width: 0 }}
          animate={{ width: '55%' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      )}

      <div className="relative text-center w-full" dir="rtl">
        {phase >= 1 && (
          <motion.h1
            style={{ fontSize: 64, fontWeight: 900, color: '#ffffff', lineHeight: 1.15, marginBottom: 12, letterSpacing: '-0.02em' }}
            initial={{ y: 60, opacity: 0, rotateX: -30 }}
            animate={{ y: 0, opacity: 1, rotateX: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            شاهد مع
          </motion.h1>
        )}
        {phase >= 2 && (
          <motion.h1
            style={{ fontSize: 64, fontWeight: 900, color: '#06B6D4', lineHeight: 1.15, letterSpacing: '-0.02em' }}
            initial={{ y: 60, opacity: 0, rotateX: -30 }}
            animate={{ y: 0, opacity: 1, rotateX: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            أصحابك
          </motion.h1>
        )}
        {phase >= 2 && (
          <motion.div
            className="mx-auto rounded-full mt-6"
            style={{ height: 4, backgroundColor: '#06B6D4', width: 60 }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
          />
        )}
        {phase >= 3 && (
          <motion.p
            style={{ fontSize: 20, color: 'rgba(255,255,255,0.55)', marginTop: 20 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            بدون ما تكونون في نفس المكان
          </motion.p>
        )}
      </div>

      {/* Floating accent dots */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 12, height: 12, backgroundColor: '#06B6D4', top: '30%', right: '12%', opacity: 0.7 }}
        animate={{ y: [0, -14, 0], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ width: 8, height: 8, backgroundColor: '#06B6D4', bottom: '28%', left: '15%', opacity: 0.5 }}
        animate={{ y: [0, -10, 0], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
    </motion.div>
  );
}
