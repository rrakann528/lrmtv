import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Server } from 'socket.io';
import * as fs from 'fs';

const FRAME_W = 1280;
const FRAME_H = 720;
const IDLE_TIMEOUT_MS = 3 * 60_000;
const MAX_SESSIONS = 3;

const VIDEO_EXT_RE = /\.(?:m3u8|mp4|webm|mkv|ts|avi)(?:[?#&]|$)/i;
const STREAM_HINT_RE = /(?:\/hls\/|\/dash\/|master\.m3u8|index\.m3u8|playlist\.m3u8|chunklist|manifest\.mpd|[?&](?:url|src|file|stream|media)=[^&"'\s]*\.m3u8|type=m3u8|format=hls)/i;
const STREAM_CT = ['application/vnd.apple.mpegurl','application/x-mpegurl','application/dash+xml','video/mp4','video/webm','video/ogg'];

function isVideoUrl(u: string): boolean {
  return VIDEO_EXT_RE.test(u) || STREAM_HINT_RE.test(u);
}

interface Session {
  slug: string;
  djSocketId: string;
  context: BrowserContext;
  page: Page;
  cdp: any;
  idleTimer: ReturnType<typeof setTimeout>;
  videoFound: Set<string>;
}

const sessions = new Map<string, Session>();
let sharedBrowser: Browser | null = null;

// ── Server-side header store ────────────────────────────────────────────────
// When Playwright detects a video URL it stores the request headers
// (especially Cookie + Referer) so the HLS proxy can reuse them and avoid
// "IP / token mismatch" 403s from CDNs that validate these headers.
interface StoredHeaders { cookie: string; referer: string; origin: string }
const videoHeaderStore = new Map<string, StoredHeaders>();
const MAX_STORE = 50;

export function getVideoHeaders(url: string): StoredHeaders | undefined {
  // 1. Exact match
  if (videoHeaderStore.has(url)) return videoHeaderStore.get(url);
  // 2. Path-level match (ignore query string)
  const base = url.split('?')[0];
  for (const [k, v] of videoHeaderStore) {
    if (k.split('?')[0] === base) return v;
  }
  // 3. Hostname-level match — segment URLs share the same CDN hostname as the manifest
  try {
    const host = new URL(url).hostname;
    for (const [k, v] of videoHeaderStore) {
      try { if (new URL(k).hostname === host) return v; } catch {}
    }
  } catch {}
  return undefined;
}

function storeVideoHeaders(url: string, headers: Record<string, string>, pageUrl: string) {
  if (videoHeaderStore.size >= MAX_STORE) {
    const firstKey = videoHeaderStore.keys().next().value;
    if (firstKey) videoHeaderStore.delete(firstKey);
  }
  videoHeaderStore.set(url, {
    cookie: headers['cookie'] || headers['Cookie'] || '',
    referer: headers['referer'] || headers['Referer'] || pageUrl,
    origin: headers['origin'] || headers['Origin'] || (() => {
      try { const u = new URL(pageUrl); return `${u.protocol}//${u.host}`; } catch { return ''; }
    })(),
  });
}

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean) as string[];

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  let executablePath = '';
  for (const p of CHROMIUM_CANDIDATES) {
    try { fs.accessSync(p, fs.constants.X_OK); executablePath = p; break; } catch {}
  }
  if (!executablePath) throw new Error('Chromium not found');
  sharedBrowser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-zygote', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process',
      `--window-size=${FRAME_W},${FRAME_H}`,
    ],
  });
  return sharedBrowser;
}

function resetIdle(session: Session) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    stopBrowserSession(session.slug);
  }, IDLE_TIMEOUT_MS);
}

export async function startBrowserSession(
  io: Server,
  slug: string,
  url: string,
  djSocketId: string
): Promise<{ success: boolean; error?: string }> {
  // If session already exists for this room — just navigate
  if (sessions.has(slug)) {
    const s = sessions.get(slug)!;
    s.djSocketId = djSocketId;
    resetIdle(s);
    await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    return { success: true };
  }

  if (sessions.size >= MAX_SESSIONS) {
    return { success: false, error: 'max_sessions' };
  }

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: FRAME_W, height: FRAME_H },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      bypassCSP: true,
      extraHTTPHeaders: { 'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8' },
    });

    await context.addInitScript(() => {
      // Runs inside browser context — window/navigator are browser globals
      const w = globalThis as any;
      Object.defineProperty(w.navigator, 'webdriver', { get: () => undefined });
      w.chrome = { runtime: {}, app: { isInstalled: false } };
      delete w.__playwright;
    });

    const page = await context.newPage();
    const videoFound = new Set<string>();

    // Network interception for video detection
    await context.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (isVideoUrl(reqUrl) && !videoFound.has(reqUrl)) {
        videoFound.add(reqUrl);
        // Store request headers (especially Cookie + Referer) so the proxy
        // can replay them and avoid IP/token-mismatch 403s from the CDN.
        try {
          const reqHeaders = route.request().headers();
          storeVideoHeaders(reqUrl, reqHeaders, page.url());
        } catch {}
        io.to(djSocketId).emit('browser:video-found', { url: reqUrl });
        console.log(`[browser-session:${slug}] ✓ Video detected: ${reqUrl}`);
      }
      const rt = route.request().resourceType();
      if (['font'].includes(rt)) { route.abort(); return; }
      route.continue();
    });

    // Response content-type detection
    page.on('response', async (resp: any) => {
      try {
        const respUrl = resp.url();
        const ct = (resp.headers()['content-type'] || '').toLowerCase();
        if (STREAM_CT.some(t => ct.startsWith(t)) && !videoFound.has(respUrl)) {
          const cl = parseInt(resp.headers()['content-length'] || '0', 10);
          if (cl === 0 || cl > 500) {
            videoFound.add(respUrl);
            // Capture request headers from the response's originating request
            try {
              const reqHeaders = resp.request().headers();
              storeVideoHeaders(respUrl, reqHeaders, page.url());
            } catch {}
            io.to(djSocketId).emit('browser:video-found', { url: respUrl });
          }
        }
      } catch {}
    });

    // CDP session for screencast + input
    const cdp = await context.newCDPSession(page);

    // Start screencast — frames sent only to DJ
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 35,
      maxWidth: FRAME_W,
      maxHeight: FRAME_H,
      everyNthFrame: 3,
    });

    cdp.on('Page.screencastFrame', async ({ data, sessionId }: any) => {
      io.to(sessions.get(slug)?.djSocketId ?? djSocketId).emit('browser:frame', { data });
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });

    // Page navigation state
    page.on('framenavigated', (frame: any) => {
      if (frame === page.mainFrame()) {
        io.to(sessions.get(slug)?.djSocketId ?? djSocketId).emit('browser:state', {
          url: page.url(), title: '', loading: true,
        });
      }
    });
    page.on('load', async () => {
      const title = await page.title().catch(() => '');
      io.to(sessions.get(slug)?.djSocketId ?? djSocketId).emit('browser:state', {
        url: page.url(), title, loading: false,
      });
    });

    const idleTimer = setTimeout(() => stopBrowserSession(slug), IDLE_TIMEOUT_MS);
    const session: Session = { slug, djSocketId, context, page, cdp, idleTimer, videoFound };
    sessions.set(slug, session);

    // Navigate to start URL
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(async () => {
      await page.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
    });

    console.log(`[browser-session:${slug}] Session started`);
    return { success: true };
  } catch (err: any) {
    console.error(`[browser-session:${slug}] Start error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function stopBrowserSession(slug: string): Promise<void> {
  const session = sessions.get(slug);
  if (!session) return;
  sessions.delete(slug);
  clearTimeout(session.idleTimer);
  try {
    await session.cdp.send('Page.stopScreencast').catch(() => {});
    await session.context.close();
  } catch {}
  console.log(`[browser-session:${slug}] Session stopped`);
}

export async function sendBrowserInput(
  slug: string,
  event: {
    type: string;
    x?: number; y?: number;
    button?: string;
    key?: string; code?: string;
    deltaY?: number;
    text?: string;
    modifiers?: number;
  }
): Promise<void> {
  const session = sessions.get(slug);
  if (!session) return;
  resetIdle(session);
  const { cdp } = session;
  try {
    switch (event.type) {
      case 'mousedown':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: event.x ?? 0, y: event.y ?? 0,
          button: event.button === 'right' ? 'right' : 'left',
          clickCount: 1, modifiers: event.modifiers ?? 0,
        });
        break;
      case 'mouseup':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: event.x ?? 0, y: event.y ?? 0,
          button: event.button === 'right' ? 'right' : 'left',
          clickCount: 1, modifiers: event.modifiers ?? 0,
        });
        break;
      case 'mousemove':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: event.x ?? 0, y: event.y ?? 0,
          button: 'none', modifiers: event.modifiers ?? 0,
        });
        break;
      case 'wheel':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: event.x ?? 0, y: event.y ?? 0,
          deltaX: 0, deltaY: event.deltaY ?? 0,
        });
        break;
      case 'keydown':
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: event.key ?? '', code: event.code ?? '',
          modifiers: event.modifiers ?? 0,
        });
        break;
      case 'keyup':
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: event.key ?? '', code: event.code ?? '',
          modifiers: event.modifiers ?? 0,
        });
        break;
      case 'char':
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char', text: event.text ?? '',
        });
        break;
    }
  } catch {}
}

export async function navigateBrowser(slug: string, url: string): Promise<void> {
  const session = sessions.get(slug);
  if (!session) return;
  resetIdle(session);
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
}

export async function browserBack(slug: string): Promise<void> {
  const s = sessions.get(slug);
  if (!s) return;
  await s.page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
}

export async function browserForward(slug: string): Promise<void> {
  const s = sessions.get(slug);
  if (!s) return;
  await s.page.goForward({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
}

export async function browserRefresh(slug: string): Promise<void> {
  const s = sessions.get(slug);
  if (!s) return;
  await s.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
}

export function hasBrowserSession(slug: string): boolean {
  return sessions.has(slug);
}
