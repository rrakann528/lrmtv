import { chromium as playwrightChromium, type Browser, type BrowserContext } from 'playwright-core';
import { URL } from 'url';
import * as net from 'net';

const VIDEO_RE = /\.(?:m3u8|mp4|webm|mkv)(?:\?|$)/i;
const VIDEO_URL_IN_TEXT = /(?:https?:)?\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>)\]]*)*/gi;

let browser: Browser | null = null;
let lastUsed = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeExtractions = 0;
const MAX_CONCURRENT = 3;

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
const IDLE_TIMEOUT = 60_000;

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

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    lastUsed = Date.now();
    return browser;
  }

  browser = await playwrightChromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--mute-audio',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,720',
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

function scanTextForVideos(text: string, found: Set<string>) {
  const matches = text.match(VIDEO_URL_IN_TEXT);
  if (matches) {
    for (const m of matches) {
      let u = m;
      if (u.startsWith('//')) u = 'https:' + u;
      try { new URL(u); found.add(u); } catch {}
    }
  }
}

async function scanPageForVideos(page: { evaluate: Function; frames?: Function }, found: Set<string>) {
  const urls = await page.evaluate(() => {
    const results: string[] = [];
    const re = /\.(?:m3u8|mp4|webm|mkv)(?:\?|$)/i;

    document.querySelectorAll('video, audio').forEach((el: any) => {
      if (el.src && re.test(el.src)) results.push(el.src);
      if (el.currentSrc && re.test(el.currentSrc)) results.push(el.currentSrc);
      el.querySelectorAll('source').forEach((s: any) => {
        if (s.src && re.test(s.src)) results.push(s.src);
      });
    });

    document.querySelectorAll('a[href], [data-src], [data-url], [data-video-src]').forEach((el: any) => {
      const href = el.href || el.getAttribute('data-src') || el.getAttribute('data-url') || el.getAttribute('data-video-src');
      if (href && re.test(href)) results.push(href);
    });

    document.querySelectorAll('script').forEach((s) => {
      const text = s.textContent || '';
      const m = text.match(/(?:https?:)?\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>)\]]*)*/gi);
      if (m) results.push(...m);
    });

    const allText = document.body?.innerHTML || '';
    const inlineMatches = allText.match(/(?:file|source|src|url|video|stream|hls|dash)["':\s]*["']?(https?:\/\/[^\s"'<>)\]]+\.(?:m3u8|mp4|webm)[^\s"'<>)\]]*)/gi);
    if (inlineMatches) {
      for (const m of inlineMatches) {
        const urlMatch = m.match(/https?:\/\/[^\s"'<>)\]]+/);
        if (urlMatch) results.push(urlMatch[0]);
      }
    }

    return results;
  }).catch(() => [] as string[]);

  for (const u of urls) {
    let clean = u;
    if (clean.startsWith('//')) clean = 'https:' + clean;
    try { new URL(clean); found.add(clean); } catch {}
  }
}

async function dismissOverlays(page: any) {
  const selectors = [
    '[class*="cookie"] button', '[class*="Cookie"] button',
    '[class*="consent"] button', '[class*="Consent"] button',
    '[class*="accept"]', '[id*="accept"]',
    '.fc-cta-consent', '.cc-btn', '#onetrust-accept-btn-handler',
    '[class*="close-btn"]', '[class*="close-ad"]', '[class*="dismiss"]',
    '.popup-close', '.modal-close', '[class*="overlay"] [class*="close"]',
    'button[class*="agree"]', 'a[class*="agree"]',
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

async function tryClickPlay(page: any) {
  const playSelectors = [
    '.play-btn', '.btn-play', '.vjs-big-play-button', '.plyr__control--overlaid',
    'button[class*="play"]', '[aria-label*="play" i]', '[aria-label*="Play"]',
    '[class*="play-button"]', '[class*="playButton"]', '[class*="play_button"]',
    '.jw-icon-playback', '.mejs__play', '.flowplayer .fp-play',
    '[data-plyr="play"]', '.video-play-button', '#play-button',
    '.player-play', '[class*="PlayButton"]', 'button[title*="Play" i]',
  ];

  for (const sel of playSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click().catch(() => {});
        return true;
      }
    } catch {}
  }

  try {
    const video = await page.$('video');
    if (video && await video.isVisible()) {
      await video.click().catch(() => {});
      return true;
    }
  } catch {}

  return false;
}

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
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      javaScriptEnabled: true,
      bypassCSP: true,
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      (window as any).chrome = { runtime: {} };
      const origQuery = (window as any).navigator.permissions?.query;
      if (origQuery) {
        (window as any).navigator.permissions.query = (params: any) =>
          params.name === 'notifications'
            ? Promise.resolve({ state: 'prompt' as PermissionState, onchange: null } as PermissionStatus)
            : origQuery(params);
      }
    });

    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (isUrlBlocked(url)) {
        route.abort('blockedbyclient');
        return;
      }
      if (VIDEO_RE.test(url)) found.add(url);
      route.continue();
    });

    const page = await context.newPage();

    page.on('response', async (resp) => {
      const url = resp.url();
      if (VIDEO_RE.test(url)) found.add(url);

      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json') || (ct.includes('text') && !ct.includes('html'))) {
          const body = await resp.text().catch(() => '');
          scanTextForVideos(body, found);
        }
        if (ct.includes('html')) {
          const body = await resp.text().catch(() => '');
          scanTextForVideos(body, found);
        }
        if (ct.includes('mpegurl') || ct.includes('application/vnd.apple')) {
          found.add(url);
        }
      } catch {}
    });

    console.log(`[browser-extract] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(async () => {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    });

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos after navigation`);
      return [...found];
    }

    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await scanPageForVideos(page, found);

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos after page scan`);
      return [...found];
    }

    await tryClickPlay(page);
    await page.waitForTimeout(3000);
    await scanPageForVideos(page, found);

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos after click`);
      return [...found];
    }

    const iframes = page.frames();
    for (const frame of iframes) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameUrl = frame.url();
        if (frameUrl && VIDEO_RE.test(frameUrl)) {
          found.add(frameUrl);
        }
        await scanPageForVideos(frame, found);

        await frame.evaluate(() => {
          const btns = document.querySelectorAll('button[class*="play"], .play-btn, [aria-label*="play" i], video');
          btns.forEach((b: any) => { try { b.click(); } catch {} });
        }).catch(() => {});
      } catch {}
    }

    if (found.size > 0) {
      console.log(`[browser-extract] Found ${found.size} videos in iframes`);
      return [...found];
    }

    const deadline = Date.now() + Math.min(timeoutMs - 10000, 20000);
    while (found.size === 0 && Date.now() < deadline) {
      await page.waitForTimeout(2000);
      await scanPageForVideos(page, found);

      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try { await scanPageForVideos(frame, found); } catch {}
      }
    }

    console.log(`[browser-extract] Final result: ${found.size} videos found`);
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
