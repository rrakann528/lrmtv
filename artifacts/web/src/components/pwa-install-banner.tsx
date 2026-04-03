/**
 * pwa-install-banner.tsx
 *
 * Smart PWA install banner for all platforms:
 *  • Android / Chrome / Edge: native one-tap install via beforeinstallprompt.
 *  • iOS Safari: step-by-step guide (Share → Add to Home Screen).
 *  • iOS Chrome: step-by-step guide (Share → Add to Home Screen).
 *  • Desktop Chrome / Edge: native install prompt.
 *  • Desktop Safari (17+): guide via File → Add to Dock.
 *  • Already installed or dismissed: hidden permanently (localStorage).
 *
 * Modal contains:
 *  1. App benefits (with icons).
 *  2. Platform-specific install steps.
 *  3. Install / action button.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Smartphone, Bell, Keyboard, Monitor, Zap, Home } from 'lucide-react';

// ── Platform detection ────────────────────────────────────────────────────────
type Platform =
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-other'
  | 'android'
  | 'desktop-chrome'
  | 'desktop-edge'
  | 'desktop-safari'
  | 'other';

function detectPlatform(): Platform {
  try {
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isAndroid = /Android/.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua);
    const isEdge   = /Edg/.test(ua);

    if (isIos) {
      if (/CriOS/.test(ua)) return 'ios-chrome';
      if (isSafari)          return 'ios-safari';
      return 'ios-other';
    }
    if (isAndroid) return 'android';
    if (isChrome)  return 'desktop-chrome';
    if (isEdge)    return 'desktop-edge';
    if (isSafari)  return 'desktop-safari';
    return 'other';
  } catch {
    return 'other';
  }
}

function isInPwa(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    );
  } catch { return false; }
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lbg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0D0D0E" />
          <stop offset="100%" stopColor="#1A1A1E" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="110" fill="url(#lbg2)" />
      <text x="256" y="295" fontFamily="Arial Black, Arial, sans-serif"
        fontSize="210" fontWeight="900" textAnchor="middle" fill="#06B6D4">Lrm</text>
      <text x="256" y="420" fontFamily="Arial Black, Arial, sans-serif"
        fontSize="130" fontWeight="900" textAnchor="middle" fill="#FFFFFF">TV</text>
    </svg>
  );
}

// ── Benefits list ─────────────────────────────────────────────────────────────
const BENEFITS = [
  {
    icon: <Home className="w-5 h-5 text-cyan-400" />,
    title: 'وصول فوري',
    desc: 'أيقونة مباشرة على شاشتك الرئيسية',
  },
  {
    icon: <Bell className="w-5 h-5 text-cyan-400" />,
    title: 'إشعارات فورية',
    desc: 'تنبيهات عند دعوتك لغرفة مشاهدة',
  },
  {
    icon: <Keyboard className="w-5 h-5 text-cyan-400" />,
    title: 'كيبورد بلا مشاكل',
    desc: 'فتح لوحة المفاتيح في وضع ملء الشاشة بسلاسة',
  },
  {
    icon: <Monitor className="w-5 h-5 text-cyan-400" />,
    title: 'شاشة كاملة',
    desc: 'بدون شريط المتصفح — مساحة عرض أكبر',
  },
  {
    icon: <Zap className="w-5 h-5 text-cyan-400" />,
    title: 'أداء أسرع',
    desc: 'تحميل فوري وتجربة أكثر سلاسة',
  },
  {
    icon: <Smartphone className="w-5 h-5 text-cyan-400" />,
    title: 'تجربة تطبيق حقيقية',
    desc: 'شعور بالتطبيق الأصلي على جهازك',
  },
];

// ── Platform-specific install steps ──────────────────────────────────────────
function getSteps(platform: Platform): { icon: React.ReactNode; text: string; sub: string }[] {
  const ShareIcon = (
    <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
      <path d="M12 2v12m0-12L8 6m4-4l4 4" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 17v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
  const AddIcon = (
    <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
      <rect x="13" y="3" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
      <rect x="3" y="13" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
      <path d="M17 13v8m-4-4h8" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
  const CheckIcon = (
    <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
      <path d="M20 6L9 17l-5-5" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const MenuIcon = (
    <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
      <circle cx="12" cy="5"  r="1.5" fill="#06B6D4" />
      <circle cx="12" cy="12" r="1.5" fill="#06B6D4" />
      <circle cx="12" cy="19" r="1.5" fill="#06B6D4" />
    </svg>
  );

  if (platform === 'ios-safari') {
    return [
      { icon: ShareIcon, text: 'اضغط على زر المشاركة', sub: 'أيقونة السهم في شريط أدوات Safari' },
      { icon: AddIcon,   text: 'اختر "إضافة إلى الشاشة الرئيسية"', sub: 'مرّر قائمة المشاركة للأسفل' },
      { icon: CheckIcon, text: 'اضغط "إضافة"', sub: 'سيظهر التطبيق على شاشتك فوراً' },
    ];
  }
  if (platform === 'ios-chrome') {
    return [
      { icon: ShareIcon, text: 'اضغط أيقونة المشاركة', sub: 'السهم في الزاوية السفلية أو العلوية' },
      { icon: AddIcon,   text: 'اختر "إضافة إلى الشاشة الرئيسية"', sub: 'من قائمة الخيارات' },
      { icon: CheckIcon, text: 'اضغط "إضافة"', sub: 'سيظهر التطبيق على شاشتك فوراً' },
    ];
  }
  if (platform === 'desktop-safari') {
    return [
      { icon: MenuIcon,  text: 'افتح قائمة File', sub: 'في شريط القوائم أعلى الشاشة' },
      { icon: AddIcon,   text: 'اختر "Add to Dock"', sub: 'يتطلب Safari 17 أو أحدث' },
      { icon: CheckIcon, text: 'اضغط "Add"', sub: 'سيظهر التطبيق في الـ Dock' },
    ];
  }
  if (platform === 'desktop-edge') {
    return [
      { icon: MenuIcon,  text: 'افتح قائمة "..." (الإعدادات)', sub: 'أعلى يمين شريط Edge' },
      { icon: AddIcon,   text: 'اختر Apps ← Install this site as an app', sub: 'أو اضغط أيقونة التثبيت في شريط العنوان' },
      { icon: CheckIcon, text: 'اضغط "Install"', sub: 'سيظهر التطبيق على سطح المكتب' },
    ];
  }
  // desktop-chrome, android, other
  return [
    { icon: MenuIcon,  text: 'افتح قائمة Chrome', sub: 'النقاط الثلاث أعلى اليمين' },
    { icon: AddIcon,   text: 'اختر "تثبيت التطبيق" أو "Add to Home Screen"', sub: 'أو اضغط أيقونة التثبيت في شريط العنوان' },
    { icon: CheckIcon, text: 'اضغط "تثبيت"', sub: 'سيظهر التطبيق على شاشتك' },
  ];
}

// ── Install modal (bottom sheet) ──────────────────────────────────────────────
function InstallModal({
  platform,
  onClose,
  onInstall,
  hasNativePrompt,
}: {
  platform: Platform;
  onClose: () => void;
  onInstall: () => void;
  hasNativePrompt: boolean;
}) {
  const steps = getSteps(platform);
  const canNativeInstall = hasNativePrompt && (
    platform === 'android' || platform === 'desktop-chrome' || platform === 'desktop-edge'
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="w-full max-w-lg overflow-y-auto"
        style={{
          backgroundColor: '#1C1C1E',
          borderRadius: '24px 24px 0 0',
          maxHeight: '90dvh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-6 pb-10 pt-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <Logo size={40} />
              <div>
                <h2 className="text-white text-base font-bold leading-tight">LrmTV</h2>
                <p className="text-white/40 text-xs">ثبّت التطبيق على جهازك</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white transition p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Benefits ── */}
          <div className="mb-6">
            <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
              مميزات التطبيق
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {BENEFITS.map((b, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1.5 rounded-2xl p-3"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(6,182,212,0.12)' }}>
                    {b.icon}
                  </div>
                  <p className="text-white text-xs font-semibold leading-tight">{b.title}</p>
                  <p className="text-white/40 text-xs leading-tight">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Install steps (only when no native prompt) ── */}
          {!canNativeInstall && (
            <div className="mb-6">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">
                طريقة التثبيت
              </h3>
              <div className="flex flex-col gap-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'rgba(6,182,212,0.12)' }}
                    >
                      {step.icon}
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-white text-sm font-medium">{step.text}</p>
                      <p className="text-white/40 text-xs mt-0.5">{step.sub}</p>
                    </div>
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: 'rgba(6,182,212,0.15)' }}
                    >
                      <span className="text-cyan-400 text-xs font-bold">{i + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Action button ── */}
          {canNativeInstall ? (
            <button
              onClick={onInstall}
              className="w-full py-3.5 rounded-2xl text-white font-semibold text-base transition hover:opacity-90 active:scale-95"
              style={{ backgroundColor: '#06B6D4' }}
            >
              تثبيت الآن
            </button>
          ) : (platform === 'ios-safari' || platform === 'ios-chrome') ? (
            <div
              className="w-full py-3 rounded-2xl text-center text-white/50 text-sm"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
            >
              اتبع الخطوات أعلاه لإتمام التثبيت
            </div>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PwaInstallBanner() {
  const [platform, setPlatform]         = useState<Platform>('other');
  const [deferredPrompt, setDeferred]   = useState<any>(null);
  const [showBanner, setShowBanner]     = useState(false);
  const [showModal, setShowModal]       = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInPwa()) return;
    if (localStorage.getItem('pwa-dismissed')) return;

    const p = detectPlatform();
    setPlatform(p);

    // iOS: no install prompt event, show banner after delay
    if (p === 'ios-safari' || p === 'ios-chrome' || p === 'ios-other') {
      timerRef.current = setTimeout(() => setShowBanner(true), 4000);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }

    // Desktop Safari: show banner after delay
    if (p === 'desktop-safari') {
      timerRef.current = setTimeout(() => setShowBanner(true), 4000);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }

    // Chrome / Edge (Android + Desktop): wait for native prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setShowBanner(false);
    setShowModal(false);
    localStorage.setItem('pwa-dismissed', '1');
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      setShowModal(false);
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
        localStorage.setItem('pwa-dismissed', '1');
      }
      setDeferred(null);
    }
  };

  return (
    <>
      {/* ── Bottom banner ── */}
      <AnimatePresence>
        {showBanner && !showModal && (
          <div className="fixed bottom-4 left-0 right-0 z-[9998] flex justify-center px-3 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl pointer-events-auto w-full"
              style={{
                backgroundColor: '#1C1C1E',
                border: '1px solid rgba(255,255,255,0.10)',
                maxWidth: 480,
              }}
            >
              <div className="shrink-0">
                <Logo size={40} />
              </div>

              <div className="flex-grow min-w-0">
                <p className="text-white text-sm font-bold leading-tight">LrmTV</p>
                <p className="text-white/50 text-xs leading-tight mt-0.5">
                  ثبّت التطبيق واستمتع بتجربة أفضل
                </p>
              </div>

              <button
                onClick={() => setShowModal(true)}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
                style={{ backgroundColor: '#06B6D4' }}
              >
                تثبيت
              </button>

              <button
                onClick={dismiss}
                className="text-white/30 hover:text-white transition shrink-0 -mr-1"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Install modal ── */}
      <AnimatePresence>
        {showModal && (
          <InstallModal
            platform={platform}
            onClose={() => setShowModal(false)}
            onInstall={handleInstallClick}
            hasNativePrompt={!!deferredPrompt}
          />
        )}
      </AnimatePresence>
    </>
  );
}
