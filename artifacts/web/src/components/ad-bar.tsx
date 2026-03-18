import { useEffect, useRef } from 'react';

const BANNER_ZONE_ID = '11082246';

/*
 * We block aclib from registering document-level click handlers (the source of
 * click-hijacking) by temporarily overriding EventTarget.prototype.addEventListener
 * while the script loads. Once the script is loaded we restore the original and
 * call runBanner — the ad renders normally but the hijack handler was never set.
 */
function loadBanner(container: HTMLDivElement) {
  const orig = EventTarget.prototype.addEventListener;

  // Block document/window click handlers that aclib would register
  (EventTarget.prototype as any).addEventListener = function (
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions,
  ) {
    if (
      (this === document || this === window) &&
      ['click', 'mousedown', 'touchstart', 'touchend', 'mousemove'].includes(type)
    ) {
      return; // silently drop
    }
    return orig.call(this, type, fn, opts);
  };

  const run = () => {
    // Restore immediately so rest of the app is unaffected
    EventTarget.prototype.addEventListener = orig;
    try {
      (window as any).aclib.runBanner({ zoneId: BANNER_ZONE_ID });
    } catch (_) {}
  };

  if ((window as any).aclib) {
    run();
    return;
  }

  if (!document.getElementById('aclib-script')) {
    const s = document.createElement('script');
    s.id = 'aclib-script';
    s.src = '//acscdn.com/script/aclib.js';
    s.onload = run;
    document.head.appendChild(s);
  } else {
    const wait = setInterval(() => {
      if ((window as any).aclib) { clearInterval(wait); run(); }
    }, 100);
  }
}

function AdDiv() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) loadBanner(ref.current);
  }, []);
  return <div ref={ref} style={{ width: 468, height: 60, flexShrink: 0 }} />;
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
      flexShrink: 0,
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
