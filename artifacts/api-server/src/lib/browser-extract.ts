import { chromium as playwrightChromium, type Browser, type BrowserContext } from 'playwright-core';
import { URL } from 'url';
import * as net from 'net';
import * as fs from 'fs';

// ── URL detection patterns ─────────────────────────────────────────────────────
// Matches direct video file URLs
const VIDEO_EXT_RE = /\.(?:m3u8|mp4|webm|mkv|ts|avi|mov|flv)(?:[?#&]|$)/i;
// Matches video URLs inside text/JSON
const VIDEO_URL_IN_TEXT = /(?:https?:)?\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm|mkv|ts)(?:\?[^\s"'<>)\]]*)*/gi;
// HLS/DASH hints even without extension
const STREAM_HINT_RE = /(?:\/hls\/|\/dash\/|\/master\.m3u8|\/index\.m3u8|\/playlist\.m3u8|\/chunklist|\/manifest\.mpd|\/stream\.mpd|[?&](?:url|stream|src|file|media|path|link|video)=[^&"'\s]*\.m3u8|type=m3u8|format=hls|format=dash)/i;
// Response content-types indicating a stream
const STREAM_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/x-matroska',
  'application/octet-stream',
];

// ── Browser lifecycle ──────────────────────────────────────────────────────────
let browser: Browser | null = null;
let lastUsed = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeExtractions = 0;
const MAX_CONCURRENT = 3;
const IDLE_TIMEOUT = 60_000;

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
].filter(Boolean) as string[];

function findChromium(): string {
  for (const p of CHROMIUM_CANDIDATES) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      console.log(`[browser-extract] Found Chromium at: ${p}`);
      return p;
    } catch {}
  }
  throw new Error(`Chromium not found. Tried: ${CHROMIUM_CANDIDATES.join(', ')}`);
}

// ── SSRF protection ────────────────────────────────────────────────────────────
const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^::1$/, /^fd[0-9a-f]{2}:/i, /^fe80:/i, /^fc[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(clean)) return PRIVATE_RANGES.some(r => r.test(clean));
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  return false;
}

function isUrlBlocked(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return true;
    return isPrivateHost(u.hostname);
  } catch {
    return true;
  }
}

function isVideoUrl(urlStr: string): boolean {
  if (VIDEO_EXT_RE.test(urlStr)) return true;
  if (STREAM_HINT_RE.test(urlStr)) return true;
  return false;
}

// ── Browser management ─────────────────────────────────────────────────────────
async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    lastUsed = Date.now();
    return browser;
  }

  const executablePath = findChromium();
  console.log(`[browser-extract] Launching Chromium: ${executablePath}`);

  browser = await playwrightChromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--no-zygote',
      '--mute-audio',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--user-data-dir=/tmp/chromium-user-data',
      '--disable-crash-reporter',
      '--disable-logging',
      '--log-level=3',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  lastUsed = Date.now();
  scheduleIdle();
  return browser;
}

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browser && Date.now() - lastUsed >= IDLE_TIMEOUT) {
      try { await browser.close(); } catch {}
      browser = null;
    }
  }, IDLE_TIMEOUT + 5000);
}

// ── Text scanning ──────────────────────────────────────────────────────────────
function scanTextForVideos(text: string, found: Set<string>) {
  const matches = text.match(VIDEO_URL_IN_TEXT);
  if (matches) {
    for (const m of matches) {
      let u = m;
      if (u.startsWith('//')) u = 'https:' + u;
      try { new URL(u); if (!isUrlBlocked(u)) found.add(u); } catch {}
    }
  }
}

// ── DOM scan inside page/frame ─────────────────────────────────────────────────
async function scanPageForVideos(page: { evaluate: Function }, found: Set<string>) {
  const urls: string[] = await page.evaluate(() => {
    const results: string[] = [];
    const re = /\.(?:m3u8|mp4|webm|mkv|ts)(?:\?|#|$)/i;

    document.querySelectorAll('video, audio').forEach((el: any) => {
      if (el.src && re.test(el.src)) results.push(el.src);
      if (el.currentSrc && re.test(el.currentSrc)) results.push(el.currentSrc);
      el.querySelectorAll('source').forEach((s: any) => {
        if (s.src && re.test(s.src)) results.push(s.src);
        if (s.getAttribute('src') && re.test(s.getAttribute('src'))) results.push(s.getAttribute('src'));
      });
    });

    // data-src, data-url, data-video-src attributes
    document.querySelectorAll('[data-src],[data-url],[data-video-src],[data-file],[data-stream]').forEach((el: any) => {
      ['data-src', 'data-url', 'data-video-src', 'data-file', 'data-stream'].forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && re.test(v)) results.push(v);
      });
    });

    // Script tag scanning
    document.querySelectorAll('script').forEach((s) => {
      const text = s.textContent || '';
      const m = text.match(/(?:https?:)?\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm|ts)(?:\?[^\s"'<>)\]]*)*/gi);
      if (m) results.push(...m);
    });

    // Inline HTML text patterns
    const bodyHtml = document.body?.innerHTML || '';
    const inlineM = bodyHtml.match(/(?:file|source|src|url|video|stream|hls|dash)["':\s]*["']?(https?:\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm|ts)[^\s"'<>)\]]*)/gi);
    if (inlineM) {
      for (const m of inlineM) {
        const urlM = m.match(/https?:\/\/[^\s"'<>)\]]+/);
        if (urlM) results.push(urlM[0]);
      }
    }

    return results;
  }).catch(() => [] as string[]);

  for (const u of urls) {
    let clean = u;
    if (clean.startsWith('//')) clean = 'https:' + clean;
    try { new URL(clean); if (!isUrlBlocked(clean)) found.add(clean); } catch {}
  }
}

// ── Dismiss overlays (cookies, ads, popups) ────────────────────────────────────
async function dismissOverlays(page: any) {
  const selectors = [
    '[class*="cookie"] button', '[class*="Cookie"] button',
    '[class*="consent"] button', '[class*="Consent"] button',
    '[class*="accept"]', '[id*="accept"]',
    '.fc-cta-consent', '.cc-btn', '#onetrust-accept-btn-handler',
    '[class*="close-btn"]', '[class*="close-ad"]', '[class*="dismiss"]',
    '.popup-close', '.modal-close', '[class*="overlay"] [class*="close"]',
    'button[class*="agree"]', 'a[class*="agree"]',
    '.btn-close', '[aria-label="Close"]', '[aria-label="close"]',
    '[class*="gdpr"] button', '#gdpr-cookie-accept',
  ];

  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch {}
  }
}

// ── Click play buttons ─────────────────────────────────────────────────────────
const PLAY_SELECTORS = [
  '.play-btn', '.btn-play', '.vjs-big-play-button', '.plyr__control--overlaid',
  'button[class*="play"]', '[aria-label*="play" i]', '[aria-label*="Play"]',
  '[class*="play-button"]', '[class*="playButton"]', '[class*="play_button"]',
  '.jw-icon-playback', '.mejs__play', '.flowplayer .fp-play',
  '[data-plyr="play"]', '.video-play-button', '#play-button',
  '.player-play', '[class*="PlayButton"]', 'button[title*="Play" i]',
  '[class*="bigplay"]', '[class*="big-play"]', '.play-overlay',
  // Arabic sites
  '[title*="تشغيل"]', '[aria-label*="تشغيل"]',
];

async function tryClickPlay(page: any): Promise<boolean> {
  for (const sel of PLAY_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click().catch(() => {});
        return true;
      }
    } catch {}
  }

  // Force play all video elements via JS
  try {
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach((v: any) => {
        try { v.muted = true; v.play(); } catch {}
      });
    });
  } catch {}

  return false;
}

// ── Main extraction function ───────────────────────────────────────────────────
export async function extractVideoUrls(targetUrl: string, timeoutMs = 30000): Promise<string[]> {
  if (activeExtractions >= MAX_CONCURRENT) {
    throw new Error('Too many concurrent extractions');
  }

  if (isUrlBlocked(targetUrl)) {
    throw new Error('URL blocked');
  }

  activeExtractions++;
  const found = new Set<string>();
  let context: BrowserContext | null = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      locale: 'ar-SA',
      timezoneId: 'Asia/Riyadh',
      javaScriptEnabled: true,
      bypassCSP: true,
      extraHTTPHeaders: {
        'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
        'DNT': '1',
      },
    });

    // ── Anti-detection ─────────────────────────────────────────────────────────
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      const fakePlugins = ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client', 'Widevine Content Decryption Module'];
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const arr: any = fakePlugins.map((name, i) => ({ name, filename: `plugin${i}.so`, description: name, length: 1 }));
          arr.length = fakePlugins.length;
          arr.item = (i: number) => arr[i];
          arr.namedItem = (n: string) => arr.find((p: any) => p.name === n) || null;
          arr.refresh = () => {};
          return arr;
        }
      });
      Object.defineProperty(navigator, 'mimeTypes', { get: () => ({ length: 4 }) });
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      (window as any).chrome = {
        app: { isInstalled: false },
        runtime: { onConnect: { addListener: () => {} }, onMessage: { addListener: () => {} } },
        loadTimes: () => ({}),
        csi: () => ({}),
      };
      delete (window as any).__playwright;
      delete (window as any).__pw_manual;
      try { Object.defineProperty(window, 'top', { get: () => window, configurable: true }); } catch {}
      try { Object.defineProperty(window, 'parent', { get: () => window, configurable: true }); } catch {}
      try { Object.defineProperty(window, 'frameElement', { get: () => null, configurable: true }); } catch {}
    });

    // ── NETWORK INTERCEPTION — catches all requests at the lowest level ─────────
    await context.route('**/*', (route) => {
      const reqUrl = route.request().url();
      const resourceType = route.request().resourceType();

      // SSRF protection
      if (isUrlBlocked(reqUrl)) {
        route.abort('blockedbyclient');
        return;
      }

      // Detect video URLs from request URL
      if (isVideoUrl(reqUrl)) {
        found.add(reqUrl);
        console.log(`[browser-extract] ✓ Intercepted: ${reqUrl}`);
      }

      // Block unnecessary resources to speed up extraction
      if (['font', 'stylesheet'].includes(resourceType)) {
        route.abort();
        return;
      }

      route.continue();
    });

    const page = await context.newPage();

    // ── RESPONSE MONITORING — content-type based detection ─────────────────────
    page.on('response', async (resp: any) => {
      try {
        const respUrl = resp.url();
        if (isUrlBlocked(respUrl)) return;

        const contentType = (resp.headers()['content-type'] || '').toLowerCase();

        // Direct stream content-type
        if (STREAM_CONTENT_TYPES.some(ct => contentType.startsWith(ct))) {
          // Only add if it's likely a real stream (not a tiny pixel tracker)
          const cl = parseInt(resp.headers()['content-length'] || '0', 10);
          if (cl === 0 || cl > 1000) {
            found.add(respUrl);
            console.log(`[browser-extract] ✓ Stream content-type: ${respUrl}`);
          }
        }

        // Scan JSON/text responses for embedded video URLs
        if (contentType.includes('json') || (contentType.includes('text') && !contentType.includes('html'))) {
          try {
            const body = await resp.text().catch(() => '');
            if (body) scanTextForVideos(body, found);
          } catch {}
        }
      } catch {}
    });

    console.log(`[browser-extract] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(async () => {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
    });

    // Early exit if interception already found videos
    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos via network interception`);
      return [...found];
    }

    await page.waitForTimeout(2000);

    // Dismiss overlays and scan DOM
    await dismissOverlays(page);
    await scanPageForVideos(page, found);

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos after DOM scan`);
      return [...found];
    }

    // Click play and wait for streams to start
    console.log(`[browser-extract] Clicking play buttons...`);
    await tryClickPlay(page);
    await page.waitForTimeout(4000);
    await scanPageForVideos(page, found);

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos after play click`);
      return [...found];
    }

    // Scan all iframes
    const iframes = page.frames();
    for (const frame of iframes) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameUrl = frame.url();
        if (frameUrl && isVideoUrl(frameUrl) && !isUrlBlocked(frameUrl)) found.add(frameUrl);
        await scanPageForVideos(frame, found);
        await frame.evaluate(() => {
          document.querySelectorAll('video').forEach((v: any) => { try { v.muted = true; v.play(); } catch {} });
        }).catch(() => {});
      } catch {}
    }

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos in iframes`);
      return [...found];
    }

    // Scan page source text
    try {
      const content = await page.content();
      scanTextForVideos(content, found);
    } catch {}

    // Polling loop — keep waiting for streams to appear
    const deadline = Date.now() + Math.min(timeoutMs - 8000, 20000);
    while (found.size === 0 && Date.now() < deadline) {
      await page.waitForTimeout(2500);
      await scanPageForVideos(page, found);
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          await scanPageForVideos(frame, found);
          await frame.evaluate(() => {
            document.querySelectorAll('video').forEach((v: any) => { try { v.muted = true; v.play(); } catch {} });
          }).catch(() => {});
        } catch {}
      }
    }

    console.log(`[browser-extract] Final: ${found.size} videos found`);
    return [...found];

  } catch (err) {
    console.error(`[browser-extract] Error:`, err);
    return [...found];
  } finally {
    activeExtractions--;
    if (context) {
      try { await context.close(); } catch {}
    }
    scheduleIdle();
  }
}

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
}
