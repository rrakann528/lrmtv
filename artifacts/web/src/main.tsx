import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

const GA4_ID = import.meta.env.VITE_GA4_ID as string | undefined;
if (GA4_ID && typeof window !== 'undefined') {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(script);
  (window as any).dataLayer = (window as any).dataLayer || [];
  function gtag(...args: any[]) { (window as any).dataLayer.push(args); }
  gtag('js', new Date());
  gtag('config', GA4_ID);
  (window as any).gtag = gtag;
}

// Register Service Worker after the page is interactive
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    const swUrl = `${base}sw.js`.replace(/\/\//g, "/");

    navigator.serviceWorker
      .register(swUrl, { scope: base })
      .then((reg) => {
        // When a new SW is waiting, reload once it activates so users always get fresh code
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "activated" &&
              navigator.serviceWorker.controller
            ) {
              // New version activated — reload silently to pick up updated assets
              window.location.reload();
            }
          });
        });
      })
      .catch(() => {
        // SW unavailable (e.g. private browsing, HTTP) — app still works normally
      });

    // If the controller changes mid-session (SW update), reload to get fresh assets
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

// Suppress unhandled rejections from third-party ad libraries (Adcash, etc.)
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e?.reason || '');
  if (msg.includes('_0x') || msg.includes('aclib') || msg.includes('acscdn')) {
    e.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
