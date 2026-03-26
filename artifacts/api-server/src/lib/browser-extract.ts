import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { URL } from 'url';
import * as net from 'net';

const VIDEO_RE = /\.(?:m3u8|mp4|webm|mkv)(?:\?|$)/i;

let browser: Browser | null = null;
let lastUsed = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeExtractions = 0;
const MAX_CONCURRENT = 3;

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
const IDLE_TIMEOUT = 60_000;

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^fc[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(clean)) {
    return PRIVATE_RANGES.some(r => r.test(clean));
  }
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

  browser = await chromium.launch({
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
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
        if ((ct.includes('json') || ct.includes('text')) && !ct.includes('html')) {
          const body = await resp.text().catch(() => '');
          const matches = body.match(/(?:https?:)?\/\/[^\s"'<>)]+\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>)]*)*/gi);
          if (matches) {
            for (const m of matches) {
              let u = m;
              if (u.startsWith('//')) u = 'https:' + u;
              try { new URL(u); found.add(u); } catch {}
            }
          }
        }
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    if (found.size > 0) return [...found];

    await page.waitForTimeout(3000);

    if (found.size === 0) {
      try {
        const playBtn = await page.$('button[class*="play"], .play-btn, .btn-play, [aria-label*="play"], [aria-label*="Play"], .vjs-big-play-button, .plyr__control--overlaid');
        if (playBtn) await playBtn.click().catch(() => {});
      } catch {}

      try {
        const video = await page.$('video');
        if (video) await video.click().catch(() => {});
      } catch {}
    }

    const deadline = Date.now() + Math.min(timeoutMs, 25000);
    while (found.size === 0 && Date.now() < deadline) {
      await page.waitForTimeout(1000);

      const frameUrls = await page.evaluate(() => {
        const urls: string[] = [];
        const re = /\.(?:m3u8|mp4|webm|mkv)(?:\?|$)/i;
        document.querySelectorAll('video').forEach((v) => {
          if (v.src && re.test(v.src)) urls.push(v.src);
          if (v.currentSrc && re.test(v.currentSrc)) urls.push(v.currentSrc);
          v.querySelectorAll('source').forEach((s) => {
            if (s.src && re.test(s.src)) urls.push(s.src);
          });
        });
        return urls;
      }).catch(() => [] as string[]);

      for (const u of frameUrls) found.add(u);

      const frames = page.frames();
      for (const frame of frames) {
        try {
          const innerUrls = await frame.evaluate(() => {
            const urls: string[] = [];
            const re = /\.(?:m3u8|mp4|webm|mkv)(?:\?|$)/i;
            document.querySelectorAll('video').forEach((v) => {
              if (v.src && re.test(v.src)) urls.push(v.src);
              if (v.currentSrc && re.test(v.currentSrc)) urls.push(v.currentSrc);
              v.querySelectorAll('source').forEach((s) => {
                if (s.src && re.test(s.src)) urls.push(s.src);
              });
            });
            return urls;
          }).catch(() => [] as string[]);
          for (const u of innerUrls) found.add(u);
        } catch {}
      }
    }

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
