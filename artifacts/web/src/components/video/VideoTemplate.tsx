import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { useState, useRef, useCallback } from 'react';

const SCENE_DURATIONS = { open: 3500, build1: 4000, build2: 4500, build3: 4000, close: 4000 };
const TOTAL_DURATION = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0); // ~20s

function VideoPlayer({ playerKey }: { playerKey: number }) {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  return (
    <AnimatePresence mode="popLayout">
      {currentScene === 0 && <Scene1 key="open" />}
      {currentScene === 1 && <Scene2 key="build1" />}
      {currentScene === 2 && <Scene3 key="build2" />}
      {currentScene === 3 && <Scene4 key="build3" />}
      {currentScene === 4 && <Scene5 key="close" />}
    </AnimatePresence>
  );
}

type RecordState = 'idle' | 'countdown' | 'recording' | 'done';

export default function VideoTemplate() {
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [playerKey, setPlayerKey] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      // Capture the current tab
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { width: 1080, height: 1920, frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
      });

      // Countdown 3 2 1
      setRecordState('countdown');
      setCountdown(3);
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(2);
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(1);
      await new Promise(r => setTimeout(r, 1000));

      // Reset animation & start recording
      setPlayerKey(k => k + 1);
      setRecordState('recording');
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lrmtv-promo.webm';
        a.click();
        URL.revokeObjectURL(url);
        setRecordState('done');
        setTimeout(() => setRecordState('idle'), 3000);
      };

      recorder.start(100);

      // Auto-stop after full video duration + 0.5s buffer
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, TOTAL_DURATION + 500);

    } catch (err) {
      console.error('Recording failed:', err);
      setRecordState('idle');
    }
  }, []);

  return (
    <div style={{ height: '100svh', backgroundColor: '#0D0D0D', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '12px 0' }}>
      {/* Video container */}
      <div style={{
        flex: '1 1 0',
        minHeight: 0,
        width: '100%',
        maxWidth: 430,
        aspectRatio: '9/16',
        maxHeight: 'calc(100svh - 90px)',
        backgroundColor: '#0D0D0E',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Cairo', 'Tajawal', system-ui, sans-serif",
        borderRadius: 16,
        alignSelf: 'center',
      }}>
        {/* Persistent Background */}
        <div className="absolute inset-0 z-0">
          <motion.div className="absolute w-[150%] h-[150%] rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, #06B6D4, transparent)' }}
            animate={{ x: ['-30%', '20%', '-10%'], y: ['-20%', '30%', '10%'], scale: [1, 1.2, 0.9] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div className="absolute w-[100%] h-[100%] rounded-full opacity-10 blur-3xl right-0 bottom-0"
            style={{ background: 'radial-gradient(circle, #fff, transparent)' }}
            animate={{ x: ['10%', '-20%', '0%'], y: ['10%', '-40%', '-10%'] }}
            transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }} />
        </div>

        <VideoPlayer playerKey={playerKey} />

        {/* Countdown overlay */}
        {recordState === 'countdown' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <motion.div
              key={countdown}
              style={{ fontSize: 120, fontWeight: 900, color: '#06B6D4', lineHeight: 1 }}
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {countdown}
            </motion.div>
          </div>
        )}

        {/* Recording indicator */}
        {recordState === 'recording' && (
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <motion.div
              className="rounded-full"
              style={{ width: 10, height: 10, backgroundColor: '#ef4444' }}
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>جاري التسجيل</span>
          </div>
        )}
      </div>

      {/* Button */}
      <div style={{ flexShrink: 0, paddingBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {recordState === 'idle' && (
          <button
            onClick={startRecording}
            style={{
              backgroundColor: '#06B6D4',
              color: '#0D0D0E',
              fontWeight: 800,
              fontSize: 18,
              padding: '14px 36px',
              borderRadius: 100,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: "'Cairo', system-ui, sans-serif",
              boxShadow: '0 0 24px rgba(6,182,212,0.4)',
            }}
          >
            <span style={{ fontSize: 20 }}>⬇️</span>
            حمّل الفيديو
          </button>
        )}
        {recordState === 'countdown' && (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, textAlign: 'center', fontFamily: 'system-ui' }}>
            جهّز الشاشة...
          </p>
        )}
        {recordState === 'recording' && (
          <p style={{ color: '#06B6D4', fontSize: 15, textAlign: 'center', fontFamily: 'system-ui' }}>
            ⏱ يتسجل تلقائياً (~20 ثانية)
          </p>
        )}
        {recordState === 'done' && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ color: '#22c55e', fontSize: 16, fontWeight: 700, textAlign: 'center', fontFamily: "'Cairo', system-ui, sans-serif" }}
          >
            ✓ تم الحفظ!
          </motion.p>
        )}
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 8, fontFamily: 'system-ui' }}>
          عند الضغط اختر "هذه النافذة" أو "هذا التبويب"
        </p>
      </div>
    </div>
  );
}
