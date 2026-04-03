import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 700),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, filter: 'blur(10px)' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Sync visualizer */}
      {phase >= 1 && (
        <motion.div
          className="flex gap-3 items-end justify-center mb-10"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          {[40, 70, 55, 85, 50, 75, 45].map((h, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              style={{ width: 10, backgroundColor: i % 2 === 0 ? '#06B6D4' : 'rgba(6,182,212,0.5)' }}
              animate={{ height: [h * 0.5, h, h * 0.6, h * 0.9, h * 0.5] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
            />
          ))}
        </motion.div>
      )}

      {/* Two "people" synced */}
      {phase >= 1 && (
        <motion.div
          className="flex items-center gap-4 mb-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {['A', 'B'].map((id, i) => (
            <div key={id} className="flex flex-col items-center gap-2">
              <motion.div
                className="rounded-2xl border-2 border-[#06B6D4] flex items-center justify-center"
                style={{ width: 70, height: 70, backgroundColor: 'rgba(6,182,212,0.12)' }}
                animate={{ boxShadow: ['0 0 0px #06B6D4', '0 0 20px #06B6D4', '0 0 0px #06B6D4'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
              >
                <svg viewBox="0 0 24 24" fill="none" width={32} height={32}>
                  <circle cx="12" cy="8" r="4" fill="#06B6D4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </motion.div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {i === 0 ? 'الرياض' : 'جدة'}
              </span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <motion.div
              style={{ width: 36, height: 3, backgroundColor: '#06B6D4', borderRadius: 4 }}
              animate={{ scaleX: [1, 0.6, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span style={{ fontSize: 11, color: '#06B6D4' }}>SYNC</span>
            <motion.div
              style={{ width: 36, height: 3, backgroundColor: '#06B6D4', borderRadius: 4 }}
              animate={{ scaleX: [0.6, 1, 0.6] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      )}

      {phase >= 2 && (
        <motion.h2
          dir="rtl"
          style={{ fontSize: 44, fontWeight: 900, color: '#ffffff', textAlign: 'center', lineHeight: 1.2 }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        >
          في نفس <span style={{ color: '#06B6D4' }}>اللحظة</span>
        </motion.h2>
      )}
    </motion.div>
  );
}
