/**
 * pwa-install-banner.tsx
 *
 * Smart PWA install banner:
 *  • Android / Chrome: intercepts `beforeinstallprompt` → one-tap native install.
 *  • iOS Safari: shows a step-by-step guide (Share → Add to Home Screen).
 *  • Already installed or dismissed: hidden permanently (localStorage).
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// ── Detect platform ───────────────────────────────────────────────────────────
const ua = navigator.userAgent;
const isIos    = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
const isInPwa  = window.matchMedia('(display-mode: standalone)').matches
              || (window.navigator as any).standalone === true;

// ── LrmTV logo ────────────────────────────────────────────────────────────────
function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lbg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0D0D0E" />
          <stop offset="100%" stopColor="#1A1A1E" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="110" fill="url(#lbg)" />
      <text
        x="256" y="295"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="210" fontWeight="900"
        textAnchor="middle"
        fill="#06B6D4"
      >Lrm</text>
      <text
        x="256" y="420"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="130" fontWeight="900"
        textAnchor="middle"
        fill="#FFFFFF"
      >TV</text>
    </svg>
  );
}

// ── iOS guide modal ───────────────────────────────────────────────────────────
function IosGuide({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="w-full max-w-md rounded-t-3xl p-6 pb-10"
        style={{ backgroundColor: '#1C1C1E' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white text-lg font-bold">تثبيت LrmTV</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white transition p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Logo + name */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <Logo size={80} />
          <span className="text-white font-semibold text-xl">LrmTV</span>
          <span className="text-white/50 text-sm text-center">
            أضف التطبيق إلى شاشتك الرئيسية للوصول السريع
          </span>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-4">
          {[
            {
              num: 1,
              icon: (
                <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
                  <path d="M12 2v12m0-12L8 6m4-4l4 4" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 17v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" />
                </svg>
              ),
              text: 'اضغط على زر المشاركة',
              sub:  'أيقونة السهم في شريط Safari',
            },
            {
              num: 2,
              icon: (
                <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
                  <rect x="3" y="3" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
                  <rect x="13" y="3" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
                  <rect x="3" y="13" width="8" height="8" rx="2" stroke="#06B6D4" strokeWidth={2} />
                  <path d="M17 13v8m-4-4h8" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" />
                </svg>
              ),
              text: 'اختر "إضافة إلى الشاشة الرئيسية"',
              sub:  'من قائمة المشاركة',
            },
            {
              num: 3,
              icon: (
                <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
                  <path d="M20 6L9 17l-5-5" stroke="#06B6D4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
              text: 'اضغط "إضافة"',
              sub:  'سيظهر التطبيق على شاشتك',
            },
          ].map(step => (
            <div key={step.num} className="flex items-start gap-4">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(6,182,212,0.15)' }}
              >
                {step.icon}
              </div>
              <div>
                <p className="text-white text-sm font-medium">{step.text}</p>
                <p className="text-white/40 text-xs mt-0.5">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Arrow pointing to share button */}
        <div className="mt-6 flex justify-center items-center gap-2 text-white/40 text-xs">
          <svg viewBox="0 0 24 24" fill="none" width={16} height={16}>
            <path d="M12 5v14m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          ابحث عن زر المشاركة أسفل الشاشة
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner,     setShowBanner]     = useState(false);
  const [showIosGuide,   setShowIosGuide]   = useState(false);

  useEffect(() => {
    // Don't show if already installed or user dismissed before
    if (isInPwa) return;
    if (localStorage.getItem('pwa-dismissed')) return;

    if (isIos && isSafari) {
      // Show iOS banner after 3 seconds
      const t = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(t);
    }

    // Android / Chrome: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setShowBanner(false);
    setShowIosGuide(false);
    localStorage.setItem('pwa-dismissed', '1');
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Android: trigger native prompt
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
        localStorage.setItem('pwa-dismissed', '1');
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      // iOS: show instructions
      setShowIosGuide(true);
    }
  };

  return (
    <>
      {/* ── Top banner ── */}
      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed top-0 left-0 right-0 z-[9998] flex items-center gap-3 px-4 py-3 shadow-xl"
            style={{ backgroundColor: '#1C1C1E', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Dismiss */}
            <button
              onClick={dismiss}
              className="text-white/40 hover:text-white transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Logo */}
            <div className="shrink-0">
              <Logo size={38} />
            </div>

            {/* Text */}
            <div className="flex-grow min-w-0">
              <p className="text-white text-sm font-semibold leading-tight">LrmTV</p>
              <p className="text-white/50 text-xs leading-tight">ثبّت التطبيق للوصول السريع</p>
            </div>

            {/* Install button */}
            <button
              onClick={handleInstall}
              className="shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
              style={{ backgroundColor: '#06B6D4' }}
            >
              تثبيت
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── iOS step-by-step guide modal ── */}
      <AnimatePresence>
        {showIosGuide && <IosGuide onClose={() => setShowIosGuide(false)} />}
      </AnimatePresence>
    </>
  );
}
