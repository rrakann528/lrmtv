import { useEffect, useRef } from 'react';

const BANNER_ZONE_ID = '11082246';

// aclib.js is loaded once in index.html — we just call runBanner here.
// window.open is overridden in index.html to block pop-under click-hijacking.
function AdDiv() {
  const ref = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const run = () => {
      try { (window as any).aclib?.runBanner({ zoneId: BANNER_ZONE_ID }); } catch (_) {}
    };

    if ((window as any).aclib) {
      run();
    } else {
      // Fallback: poll until aclib is ready (should be fast since it's in <head>)
      const t = setInterval(() => {
        if ((window as any).aclib) { clearInterval(t); run(); }
      }, 100);
      setTimeout(() => clearInterval(t), 5000);
    }
  }, []);

  return (
    <div
      ref={ref}
      style={{ width: 468, height: 60, flexShrink: 0, maxWidth: '100%' }}
    />
  );
}

interface Props {
  bottom?: number;
  inline?: boolean;
}

export default function AdBar({ bottom = 0, inline = false }: Props) {
  if (inline) {
    return (
      <div style={{
        width: '100%',
        height: 60,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,20,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <AdDiv />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom,
      left: 0,
      right: 0,
      zIndex: 25,
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10,10,20,0.95)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      <AdDiv />
    </div>
  );
}
