import { useEffect, useState } from 'react';

interface UseVideoPlayerProps {
  durations: Record<string, number>;
}

export function useVideoPlayer({ durations }: UseVideoPlayerProps) {
  const [currentScene, setCurrentScene] = useState(0);
  const scenes = Object.keys(durations);

  // We must ensure the keys and durations are stable, so we don't depend on durations object directly 
  // if it's recreated, but we assume it's passed as a constant from the template.
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).startRecording) {
      (window as any).startRecording();
    }

    let timeoutId: NodeJS.Timeout;
    let isFirstPass = true;

    const advanceScene = (index: number) => {
      setCurrentScene(index);
      
      const currentDuration = durations[scenes[index]];
      timeoutId = setTimeout(() => {
        const nextIndex = index + 1;
        if (nextIndex < scenes.length) {
          advanceScene(nextIndex);
        } else {
          if (isFirstPass && typeof window !== 'undefined' && (window as any).stopRecording) {
            (window as any).stopRecording();
          }
          isFirstPass = false;
          advanceScene(0);
        }
      }, currentDuration);
    };

    advanceScene(0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  return { currentScene };
}