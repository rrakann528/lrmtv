import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/lib/i18n';
import { useLocation } from 'wouter';

const LS_KEY = 'lrmtv_cookie_consent';

export function CookieConsent() {
  const { t, dir } = useI18n();
  const [visible, setVisible] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(LS_KEY, '1');
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          dir={dir}
          className="fixed bottom-4 left-4 right-4 z-[9999] max-w-lg mx-auto"
        >
          <div className="bg-[#111827] border border-white/10 rounded-2xl shadow-2xl px-4 py-3.5 flex items-center gap-3">
            <span className="text-xl flex-shrink-0">🍪</span>
            <p className="text-xs text-white/70 flex-1 leading-relaxed">
              {t('cookieConsent')}{' '}
              <button
                onClick={() => setLocation('/privacy')}
                className="text-primary underline underline-offset-2"
              >
                {t('privacy')}
              </button>
              .
            </p>
            <button
              onClick={accept}
              className="flex-shrink-0 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-xl"
            >
              {t('cookieAccept')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
