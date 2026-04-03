import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 3500, build1: 4000, build2: 4500, build3: 4000, close: 4000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div style={{ width: '100vw', height: '100svh', aspectRatio: '9/16', maxWidth: '430px', margin: '0 auto', backgroundColor: '#0D0D0E', position: 'relative', overflow: 'hidden', fontFamily: "'Cairo', 'Tajawal', system-ui, sans-serif" }}>
      
      {/* Persistent Background */}
      <div className="absolute inset-0 z-0">
        <motion.div className="absolute w-[150vw] h-[150vw] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #06B6D4, transparent)' }}
          animate={{ x: ['-30%', '20%', '-10%'], y: ['-20%', '30%', '10%'], scale: [1, 1.2, 0.9] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute w-[100vw] h-[100vw] rounded-full opacity-10 blur-3xl right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #fff, transparent)' }}
          animate={{ x: ['10%', '-20%', '0%'], y: ['10%', '-40%', '-10%'] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="open" />}
        {currentScene === 1 && <Scene2 key="build1" />}
        {currentScene === 2 && <Scene3 key="build2" />}
        {currentScene === 3 && <Scene4 key="build3" />}
        {currentScene === 4 && <Scene5 key="close" />}
      </AnimatePresence>
    </div>
  );
}