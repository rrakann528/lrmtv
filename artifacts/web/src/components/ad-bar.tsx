import { useEffect, useRef } from 'react';

declare global {
  interface Window { aclib?: any; }
}

const ZONE_ID = 'tf80ahdgu8';

export default function AdBar({ bottom = 0 }: { bottom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    const load = () => {
      if (!window.aclib) return false;
      try {
        window.aclib.runBanner({ zoneId: ZONE_ID, containerId: 'lrmtv-ad-bar' });
        loaded.current = true;
      } catch {
        window.aclib.runAutoTag({ zoneId: ZONE_ID });
        loaded.current = true;
      }
      return true;
    };
    if (!load()) {
      const t = setInterval(() => { if (load()) clearInterval(t); }, 500);
      return () => clearInterval(t);
    }
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        bottom,
        left: 0,
        right: 0,
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,20,0.95)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        minHeight: 52,
        overflow: 'hidden',
      }}
    >
      <div ref={ref} id="lrmtv-ad-bar" style={{ width: '100%', maxWidth: 480, minHeight: 50 }} />
    </div>
  );
}
