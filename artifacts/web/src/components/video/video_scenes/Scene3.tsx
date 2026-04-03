import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const MESSAGES = [
  { text: 'هذا المقطع رائع 🔥', side: 'right' },
  { text: 'اتفق معك 100% ✨', side: 'left' },
  { text: 'ههههههههه 😂', side: 'right' },
  { text: 'جاب الضحكة والله 💀', side: 'left' },
];

export function Scene3() {
  const [visibleMsgs, setVisibleMsgs] = useState(0);

  useEffect(() => {
    const timers = MESSAGES.map((_, i) =>
      setTimeout(() => setVisibleMsgs(i + 1), 300 + i * 650)
    );
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div className="absolute inset-0 flex flex-col justify-center z-10 px-6"
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50, filter: 'blur(10px)' }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Title */}
      <motion.h2
        dir="rtl"
        style={{ fontSize: 34, fontWeight: 900, color: '#ffffff', textAlign: 'center', marginBottom: 24, lineHeight: 1.3 }}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        شات حي <span style={{ color: '#06B6D4' }}>أثناء المشاهدة</span>
      </motion.h2>

      {/* Chat messages */}
      <div className="flex flex-col gap-3 w-full max-w-sm mx-auto" dir="rtl">
        {MESSAGES.map((msg, i) => (
          visibleMsgs > i ? (
            <motion.div
              key={i}
              className={`max-w-[78%] px-4 py-2.5 rounded-2xl ${
                msg.side === 'right'
                  ? 'self-end rounded-tr-sm bg-white/10'
                  : 'self-start rounded-tl-sm border border-[#06B6D4]/30'
              }`}
              style={msg.side === 'left' ? { backgroundColor: 'rgba(6,182,212,0.15)' } : {}}
              initial={{ opacity: 0, scale: 0.75, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            >
              <p style={{ fontSize: 17, color: '#ffffff' }}>{msg.text}</p>
            </motion.div>
          ) : null
        ))}
      </div>
    </motion.div>
  );
}
