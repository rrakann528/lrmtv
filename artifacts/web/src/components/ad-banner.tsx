/*
 * AdBanner — injects an Adcash banner directly on the page.
 *
 * aclib.js is loaded globally in index.html.
 * data-ad-zone lets the smart window.open override allow clicks from within.
 */
import { useEffect, useRef } from 'react';

const BANNER_ZONE = '11082246';

interface Props {
  bottom?: number;
  inline?: boolean;
}

declare global {
  interface Window {
    aclib?: { runBanner: (opts: { zoneId: string }) => void };
  }
}

export default function AdBanner({ bottom = 0, inline = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const injected = useRef(false);

  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const run = () => {
      try {
        if (window.aclib?.runBanner) {
          window.aclib.runBanner({ zoneId: BANNER_ZONE });
        }
      } catch (_) {}
    };
    /* Small delay so the DOM node is fully mounted */
    const t = setTimeout(run, 150);
    return () => clearTimeout(t);
  }, []);

  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(10,10,20,0.95)',
    overflow: 'hidden',
    height: 60,
    flexShrink: 0,
    ...(inline
      ? { width: '100%', borderBottom: '1px solid rgba(255,255,255,0.06)' }
      : {
          position: 'fixed',
          bottom,
          left: 0,
          right: 0,
          zIndex: 25,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }),
  };

  return (
    <div style={wrapStyle} data-ad-zone="true">
      <div ref={ref} style={{ minWidth: 1, minHeight: 1 }} />
    </div>
  );
}
