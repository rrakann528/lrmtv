import { useEffect, useRef, useState } from 'react';

const VAST_TAG = 'https://youradexchange.com/video/select.php?r=11081990';
const SKIP_AFTER = 5;

interface Props { onDone: () => void; }

export default function PreRollAd({ onDone }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [skip, setSkip] = useState(false);
  const [countdown, setCountdown] = useState(SKIP_AFTER);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  const finish = () => { if (!done.current) { done.current = true; onDone(); } };

  useEffect(() => {
    const fallback = setTimeout(finish, 20000);
    fetch(`/api/proxy/vast?url=${encodeURIComponent(VAST_TAG)}`)
      .then(r => r.text())
      .then(xml => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const files = Array.from(doc.querySelectorAll('MediaFile'));
        const mp4 = files.find(f => (f.getAttribute('type') || '').includes('mp4')) || files[0];
        const url = mp4?.textContent?.trim();
        if (url) setSrc(url);
        else { setFailed(true); clearTimeout(fallback); finish(); }
      })
      .catch(() => { setFailed(true); finish(); });

    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (!src) return;
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); setSkip(true); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [src]);

  if (failed) return null;

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 60,
        background: '#000', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {src ? (
        <>
          <video
            ref={videoRef}
            src={src}
            autoPlay
            playsInline
            onEnded={finish}
            onError={finish}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#aaa', fontSize: 11, padding: '3px 8px', borderRadius: 4 }}>
            إعلان
          </div>
          <div style={{ position: 'absolute', bottom: 16, right: 16 }}>
            {skip ? (
              <button
                onClick={finish}
                style={{ background: 'rgba(0,0,0,0.85)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '8px 18px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
              >
                تخطي الإعلان ▶
              </button>
            ) : (
              <div style={{ background: 'rgba(0,0,0,0.7)', color: '#ccc', padding: '6px 14px', borderRadius: 4, fontSize: 12 }}>
                تخطي بعد {countdown}s
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ color: '#555', fontSize: 13 }}>جاري تحميل الإعلان…</div>
      )}
    </div>
  );
}
