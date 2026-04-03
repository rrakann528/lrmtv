import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1700),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08, filter: 'blur(14px)' }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Radial glow */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 280, height: 280, background: 'radial-gradient(circle, rgba(6,182,212,0.25), transparent 70%)', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Logo */}
      {phase >= 1 && (
        <motion.div
          style={{ fontSize: 72, fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1 }}
          initial={{ scale: 0.5, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          Lrm<span style={{ color: '#06B6D4' }}>TV</span>
        </motion.div>
      )}

      {/* Tagline */}
      {phase >= 2 && (
        <motion.p
          dir="rtl"
          style={{ fontSize: 22, color: 'rgba(255,255,255,0.7)', marginTop: 12, textAlign: 'center' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          شاهد. شارك. اضحك سوا.
        </motion.p>
      )}

      {/* CTA pill */}
      {phase >= 3 && (
        <motion.div
          style={{
            marginTop: 32,
            backgroundColor: '#06B6D4',
            color: '#0D0D0E',
            fontWeight: 800,
            fontSize: 22,
            paddingTop: 12,
            paddingBottom: 12,
            paddingLeft: 32,
            paddingRight: 32,
            borderRadius: 100,
            letterSpacing: '0.01em',
          }}
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          lrmtv.sbs
        </motion.div>
      )}

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 6 + (i % 3) * 4,
            height: 6 + (i % 3) * 4,
            backgroundColor: '#06B6D4',
            opacity: 0.3 + (i % 3) * 0.15,
            left: `${15 + i * 13}%`,
            top: `${20 + (i % 3) * 20}%`,
          }}
          animate={{ y: [0, -18, 0], opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2.5 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
        />
      ))}
    </motion.div>
  );
}
