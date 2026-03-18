import { useEffect, useRef } from 'react';

declare global {
  interface Window { aclib?: any; }
}

const BANNER_ZONE_ID = '11082246';

interface Props {
  bottom?: number;
  inline?: boolean;
}

function injectAd(container: HTMLDivElement) {
  const run = () => {
    if (!window.aclib) return false;
    // inject a real <script> node inside the container so aclib renders into it
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.text = `try { aclib.runBanner({ zoneId: '${BANNER_ZONE_ID}' }); } catch(e) {}`;
    container.appendChild(s);
    return true;
  };
  if (!run()) {
    const t = setInterval(() => { if (run()) clearInterval(t); }, 300);
    return () => clearInterval(t);
  }
}

export default function AdBar({ bottom = 0, inline = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cleanup = injectAd(el);
    return cleanup;
  }, []);

  const inner = (
    <div
      ref={ref}
      style={{ width: 468, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    />
  );

  if (inline) {
    return (
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,20,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        height: 60,
      }}>
        {inner}
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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10,10,20,0.95)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      height: 60,
      overflow: 'hidden',
    }}>
      {inner}
    </div>
  );
}
