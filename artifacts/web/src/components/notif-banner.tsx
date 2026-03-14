import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, X, Smartphone } from 'lucide-react';
import { usePush } from '@/hooks/use-push';

interface Props {
  userId?: number;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.navigator as any).standalone;
}

export function NotifBanner({ userId }: Props) {
  const { permission, subscribed, loading, subscribe, isSupported } = usePush(userId);
  const [dismissed, setDismissed] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [result, setResult] = useState<'ok' | 'denied' | null>(null);

  // Don't show if: not logged in, already subscribed, dismissed, or not supported and not iOS
  if (!userId) return null;
  if (subscribed) return null;
  if (dismissed) return null;
  if (permission === 'denied') return null;

  const handleEnable = async () => {
    if (!isSupported) {
      if (isIOS()) { setShowIosGuide(true); return; }
      return;
    }
    const ok = await subscribe();
    if (ok) {
      setResult('ok');
      setTimeout(() => setDismissed(true), 2500);
    } else {
      setResult('denied');
    }
  };

  return (
    <>
      <AnimatePresence>
        {!dismissed && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-16 inset-x-3 z-50 bg-card border border-primary/30 rounded-2xl shadow-xl shadow-primary/10 overflow-hidden"
          >
            {result === 'ok' ? (
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-sm text-green-400 font-medium">تم تفعيل الإشعارات ✓</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Bell className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">فعّل الإشعارات</p>
                  <p className="text-xs text-muted-foreground">رسائل خاصة ودعوات الغرف</p>
                </div>
                <button
                  onClick={handleEnable}
                  disabled={loading}
                  className="flex-shrink-0 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold disabled:opacity-50"
                >
                  {loading ? '...' : 'تفعيل'}
                </button>
                <button onClick={() => setDismissed(true)} className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Guide */}
      <AnimatePresence>
        {showIosGuide && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowIosGuide(false)} />
            <motion.div
              className="relative w-full bg-card rounded-t-3xl p-6 pb-10 z-10"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground">تفعيل الإشعارات على iOS</h3>
                  <p className="text-xs text-muted-foreground">يجب إضافة التطبيق للشاشة الرئيسية أولاً</p>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { n: 1, text: 'اضغط على أيقونة المشاركة في Safari', icon: '⬆️' },
                  { n: 2, text: 'اختر "إضافة إلى الشاشة الرئيسية"', icon: '➕' },
                  { n: 3, text: 'افتح التطبيق من الشاشة الرئيسية', icon: '📲' },
                  { n: 4, text: 'ستظهر رسالة طلب الإذن تلقائياً', icon: '🔔' },
                ].map(({ n, text, icon }) => (
                  <div key={n} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                      {n}
                    </div>
                    <span className="text-sm text-foreground">{icon} {text}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setShowIosGuide(false); setDismissed(true); }}
                className="w-full mt-6 py-3 bg-primary text-primary-foreground rounded-2xl font-bold text-sm"
              >
                فهمت
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
