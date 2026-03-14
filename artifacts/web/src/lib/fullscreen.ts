/**
 * Cross-browser fullscreen helpers.
 *
 * Simulated fullscreen (CSS-only fallback for old iOS):
 * We use position:fixed + inset:0 on the element itself.
 * In the current room layout, no ancestor of the player container uses
 * backdrop-filter, so position:fixed works correctly and — critically —
 * the element stays in React's DOM tree so all React event handlers work.
 *
 * Previous approach (DOM reparenting) was abandoned because moving an element
 * outside the React root breaks React's synthetic event delegation.
 */

const SIM_SET = new WeakSet<HTMLElement>();

export function isFullscreenActive(): boolean {
  return !!(
    document.fullscreenElement ||
    (document as unknown as { webkitFullscreenElement: Element | null }).webkitFullscreenElement
  );
}

export function isSimulatedFullscreen(el: HTMLElement): boolean {
  return SIM_SET.has(el);
}

/**
 * Enter fullscreen on the given container element.
 * Tries native Fullscreen API first, falls back to CSS-only simulated fullscreen.
 */
export async function enterFullscreen(el: HTMLElement): Promise<void> {
  if (el.requestFullscreen) {
    try {
      await el.requestFullscreen();
      return;
    } catch {
      // Some browsers support the API but refuse for non-video elements; fall through
    }
  }
  const webkitEl = el as unknown as { webkitRequestFullscreen?: () => void };
  if (webkitEl.webkitRequestFullscreen) {
    try {
      webkitEl.webkitRequestFullscreen();
      return;
    } catch {
      // fall through
    }
  }

  // ── CSS-only simulated fullscreen ─────────────────────────────────────────
  // Element stays in the React DOM tree → all React event handlers keep working.
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.width = '100vw';
  el.style.height = '100dvh';
  el.style.zIndex = '9999';
  el.style.backgroundColor = '#000';

  SIM_SET.add(el);
  el.dispatchEvent(new Event('simulatedfullscreenenter', { bubbles: true }));
}

export async function exitFullscreen(el?: HTMLElement | null): Promise<void> {
  if (el && SIM_SET.has(el)) {
    SIM_SET.delete(el);

    el.style.position = '';
    el.style.inset = '';
    el.style.width = '';
    el.style.height = '';
    el.style.zIndex = '';
    el.style.backgroundColor = '';

    el.dispatchEvent(new Event('simulatedfullscreenexit', { bubbles: true }));
    return;
  }
  if (document.exitFullscreen && isFullscreenActive()) {
    await document.exitFullscreen();
    return;
  }
  const webkitDoc = document as unknown as { webkitExitFullscreen?: () => void };
  if (webkitDoc.webkitExitFullscreen) {
    webkitDoc.webkitExitFullscreen();
  }
}

/**
 * Listen to both native and simulated fullscreen change events.
 * Returns an unsubscribe function.
 */
export function onFullscreenChange(
  target: EventTarget,
  callback: (isFs: boolean) => void,
): () => void {
  const native = () => callback(isFullscreenActive());
  const simEnter = () => callback(true);
  const simExit = () => callback(false);

  document.addEventListener('fullscreenchange', native);
  document.addEventListener('webkitfullscreenchange', native);
  target.addEventListener('simulatedfullscreenenter', simEnter);
  target.addEventListener('simulatedfullscreenexit', simExit);

  return () => {
    document.removeEventListener('fullscreenchange', native);
    document.removeEventListener('webkitfullscreenchange', native);
    target.removeEventListener('simulatedfullscreenenter', simEnter);
    target.removeEventListener('simulatedfullscreenexit', simExit);
  };
}
