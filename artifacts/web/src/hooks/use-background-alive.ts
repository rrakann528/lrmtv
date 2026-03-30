import { useEffect, useRef } from 'react';

let sharedCtx: AudioContext | null = null;
let refCount = 0;

function getOrCreateSilentAudio(): AudioContext {
  if (sharedCtx && sharedCtx.state !== 'closed') {
    refCount++;
    return sharedCtx;
  }
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  sharedCtx = ctx;
  refCount = 1;
  return ctx;
}

function releaseSilentAudio() {
  refCount--;
  if (refCount <= 0 && sharedCtx) {
    try { sharedCtx.close(); } catch {}
    sharedCtx = null;
    refCount = 0;
  }
}

interface MediaInfo {
  title?: string;
  artist?: string;
  artwork?: string;
}

export function useBackgroundAlive(
  active: boolean,
  mediaInfo?: MediaInfo,
  callbacks?: {
    onPlay?: () => void;
    onPause?: () => void;
    onSeekBackward?: () => void;
    onSeekForward?: () => void;
  }
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;

    ctxRef.current = getOrCreateSilentAudio();

    const resumeAudio = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };

    document.addEventListener('touchstart', resumeAudio, { once: true });
    document.addEventListener('click', resumeAudio, { once: true });
    resumeAudio();

    const onVisChange = () => {
      if (!document.hidden) {
        resumeAudio();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch {}
    };
    requestWakeLock();

    const onVisWake = async () => {
      if (!document.hidden && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisWake);

    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      document.removeEventListener('visibilitychange', onVisWake);
      document.removeEventListener('touchstart', resumeAudio);
      document.removeEventListener('click', resumeAudio);
      releaseSilentAudio();
      ctxRef.current = null;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [active]);

  useEffect(() => {
    if (!active || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    if (mediaInfo?.title) {
      ms.metadata = new MediaMetadata({
        title: mediaInfo.title || 'LrmTV',
        artist: mediaInfo.artist || 'LrmTV',
        artwork: mediaInfo.artwork
          ? [{ src: mediaInfo.artwork, sizes: '512x512', type: 'image/png' }]
          : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    }

    if (callbacks?.onPlay) {
      ms.setActionHandler('play', callbacks.onPlay);
    }
    if (callbacks?.onPause) {
      ms.setActionHandler('pause', callbacks.onPause);
    }
    if (callbacks?.onSeekBackward) {
      ms.setActionHandler('seekbackward', callbacks.onSeekBackward);
    }
    if (callbacks?.onSeekForward) {
      ms.setActionHandler('seekforward', callbacks.onSeekForward);
    }

    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
        ms.metadata = null;
      } catch {}
    };
  }, [active, mediaInfo?.title, mediaInfo?.artist, mediaInfo?.artwork, callbacks?.onPlay, callbacks?.onPause, callbacks?.onSeekBackward, callbacks?.onSeekForward]);
}
