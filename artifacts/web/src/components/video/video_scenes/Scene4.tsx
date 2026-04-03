import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1300),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -60, filter: 'blur(10px)' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Icons row */}
      <div className="flex items-center gap-8 mb-10">
        {phase >= 1 && (
          <motion.div
            className="flex flex-col items-center gap-2"
            initial={{ scale: 0, rotate: -20, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 20 }}
          >
            <div className="rounded-2xl flex items-center justify-center"
              style={{ width: 80, height: 80, backgroundColor: '#FF0000', boxShadow: '0 0 32px rgba(255,0,0,0.4)' }}>
              <svg viewBox="0 0 24 24" fill="white" width={40} height={40}>
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </div>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>يوتيوب</span>
          </motion.div>
        )}

        {phase >= 1 && (
          <motion.div
            style={{ fontSize: 32, fontWeight: 900, color: '#06B6D4' }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.15 }}
          >
            +
          </motion.div>
        )}

        {phase >= 2 && (
          <motion.div
            className="flex flex-col items-center gap-2"
            initial={{ scale: 0, rotate: 20, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 20 }}
          >
            <div className="rounded-2xl flex items-center justify-center"
              style={{ width: 80, height: 80, backgroundColor: 'rgba(6,182,212,0.2)', border: '2px solid #06B6D4', boxShadow: '0 0 32px rgba(6,182,212,0.35)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={40} height={40}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>رابط مباشر</span>
          </motion.div>
        )}
      </div>

      {phase >= 3 && (
        <motion.h2
          dir="rtl"
          style={{ fontSize: 38, fontWeight: 900, color: '#ffffff', textAlign: 'center', lineHeight: 1.3 }}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        >
          كل شيء تبيه<br/>
          <span style={{ color: '#06B6D4', fontSize: 32 }}>في مكان واحد</span>
        </motion.h2>
      )}
    </motion.div>
  );
}
