import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, Frame } from "puppeteer-core";
import * as fs from "fs";
import * as net from "net";
import * as dns from "dns/promises";

puppeteerExtra.use(StealthPlugin());

const dnsCache = new Map<string, { isPrivate: boolean; ts: number }>();
const DNS_CACHE_TTL = 30_000;

async function isHostPrivateViadns(hostname: string): Promise<boolean> {
  if (isPrivateIp(hostname)) return true;
  if (net.isIP(hostname)) return isPrivateIp(hostname);

  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL) return cached.isPrivate;

  try {
    const a4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const a6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...a4, ...a6];
    const result = all.length > 0 && all.some(isPrivateIp);
    dnsCache.set(hostname, { isPrivate: result, ts: Date.now() });
    return result;
  } catch {
    return false;
  }
}

const VIDEO_EXTENSIONS = [
  ".mp4", ".m3u8", ".ts", ".mkv", ".avi", ".webm",
  ".flv", ".mov", ".mpd", ".f4v", ".ogv", ".3gp",
];

const VIDEO_CONTENT_TYPES = [
  "video/",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "application/dash+xml",
  "application/octet-stream",
  "binary/octet-stream",
  "application/vnd.ms-sstr+xml",
];

const IGNORE_PATTERNS = [
  "google", "facebook", "doubleclick", "adservice",
  "analytics", "googletagmanager", "googlesyndication",
  "adsrvr", "amazon-adsystem", "adnxs", "criteo",
  "fonts.googleapis", "cdnjs", "jquery",
  ".css", ".js?", ".png", ".jpg", ".jpeg",
  ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf",
];

const PLAY_SELECTORS = [
  'button[class*="play"]', 'button[id*="play"]',
  'div[class*="play"]', 'div[id*="play"]',
  'a[class*="play"]', 'a[id*="play"]',
  '.play-btn', '.play-button', '.btn-play',
  '#play', '#player-play', '.vjs-big-play-button',
  '.plyr__control--overlaid',
  '[data-plyr="play"]',
  '.jw-icon-playback', '.jw-display-icon-container',
  'button[aria-label*="play" i]', 'button[aria-label*="تشغيل"]',
  'button[title*="play" i]', 'button[title*="Play"]',
  '.ytp-large-play-button',
  '[class*="watch"]', '[class*="stream"]',
  '.overlay-play', '.play-overlay', '.video-play',
  'svg[class*="play"]',
  '.btn-watch', '.watch-btn', '[class*="مشاهدة"]',
  '.play', '#play-btn',
];

const IFRAME_NAV_SELECTORS = [
  'iframe[src*="embed"]', 'iframe[src*="player"]',
  'iframe[src*="stream"]', 'iframe[src*="video"]',
  'iframe[src*="watch"]', 'iframe[src*="play"]',
  'iframe[data-src]', 'iframe[data-lazy-src]',
  'iframe[allowfullscreen]',
  'iframe[src*="vidstream"]', 'iframe[src*="mycloud"]',
  'iframe[src*="mixdrop"]', 'iframe[src*="upstream"]',
  'iframe[src*="dood"]', 'iframe[src*="streamtape"]',
  'iframe[src*="filemoon"]', 'iframe[src*="voe"]',
];

function isPrivateIp(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (net.isIPv4(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    if (hostname === "255.255.255.255") return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(hostname)) {
    const lower = hostname.toLowerCase();
    if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd") || lower === "::") return true;
    return false;
  }
  return false;
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.startsWith("blob:")) return false;
  if (IGNORE_PATTERNS.some((p) => lower.includes(p))) return false;
  return VIDEO_EXTENSIONS.some((ext) => {
    const idx = lower.indexOf(ext);
    if (idx === -1) return false;
    const afterExt = lower[idx + ext.length];
    return !afterExt || afterExt === "?" || afterExt === "&" || afterExt === "#" || afterExt === "/";
  });
}

function isVideoContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return VIDEO_CONTENT_TYPES.some((t) => lower.includes(t));
}

function scoreUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (lower.includes(".m3u8")) score += 10;
  if (lower.includes(".mpd")) score += 8;
  if (lower.includes(".mp4")) score += 6;
  if (lower.includes("1080")) score += 5;
  if (lower.includes("720")) score += 4;
  if (lower.includes("480")) score += 2;
  if (lower.includes("360")) score += 1;
  if (lower.includes("master") || lower.includes("index")) score += 3;
  if (lower.includes("playlist")) score += 3;
  if (lower.includes("embed")) score += 2;
  if (lower.includes("stream")) score += 2;
  if (lower.includes("cdn")) score += 1;
  if (lower.includes("ad") && !lower.includes("load") && !lower.includes("download")) score -= 5;
  return score;
}

export interface SniffResult {
  success: boolean;
  urls: Array<{
    url: string;
    type: "m3u8" | "mp4" | "mpd" | "other";
    quality?: string;
    score: number;
  }>;
  error?: string;
  duration?: number;
}

function detectType(url: string): "m3u8" | "mp4" | "mpd" | "other" {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "m3u8";
  if (lower.includes(".mpd")) return "mpd";
  if (lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".mkv") || lower.includes(".f4v")) return "mp4";
  return "other";
}

function detectQuality(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes("1080")) return "1080p";
  if (lower.includes("720")) return "720p";
  if (lower.includes("480")) return "480p";
  if (lower.includes("360")) return "360p";
  if (lower.includes("240")) return "240p";
  return undefined;
}

let activeSessions = 0;
const MAX_CONCURRENT = 3;
const activeRoomSessions = new Set<string>();
const activeBrowsers = new Map<string, { browser: Browser; startedAt: number }>();
const MAX_BROWSER_AGE_MS = 90_000;

setInterval(() => {
  const now = Date.now();
  for (const [roomSlug, entry] of activeBrowsers) {
    if (now - entry.startedAt > MAX_BROWSER_AGE_MS) {
      console.warn(`[link-sniffer] orphan cleanup: killing stale browser room=${roomSlug} age=${now - entry.startedAt}ms`);
      try { entry.browser.close(); } catch {}
      activeBrowsers.delete(roomSlug);
      activeRoomSessions.delete(roomSlug);
    }
  }
}, 30_000);

export function abortRoomSession(roomSlug: string): void {
  const entry = activeBrowsers.get(roomSlug);
  if (entry) {
    console.log(`[link-sniffer] aborting session for room=${roomSlug} on disconnect`);
    try { entry.browser.close(); } catch {}
    activeBrowsers.delete(roomSlug);
    activeRoomSessions.delete(roomSlug);
  }
}

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
];

function findChromiumPath(): string {
  for (const p of CHROMIUM_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return "chromium";
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function launchBrowser(): Promise<Browser> {
  const execPath = findChromiumPath();
  console.log(`[link-sniffer] launching stealth browser: ${execPath}`);

  return puppeteerExtra.launch({
    executablePath: execPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-features=VizDisplayCompositor",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--lang=ar,en-US",
      "--autoplay-policy=no-user-gesture-required",
    ],
  }) as unknown as Browser;
}

function extractVideoUrlsFromText(text: string): string[] {
  const urls: string[] = [];
  const directMatches = text.match(
    /https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd|mkv|webm|f4v|ts|flv|mov)[^\s"'<>\\]*/gi
  );
  if (directMatches) urls.push(...directMatches);

  const propMatches = text.match(
    /(?:src|file|url|source|video_url|stream_url|manifest|playlist|hls_url|dash_url|video_link|mp4_url|stream|playback)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>\\,;]+)/gi
  );
  if (propMatches) {
    propMatches.forEach(m => {
      const u = m.match(/https?:\/\/[^\s"'<>\\,;]+/);
      if (u) urls.push(u[0]);
    });
  }

  const jsonMatches = text.match(
    /"(?:src|file|url|source|video|stream|hls|dash|mp4|playlist|manifest)"\s*:\s*"(https?:\/\/[^"\\]+)"/gi
  );
  if (jsonMatches) {
    jsonMatches.forEach(m => {
      const u = m.match(/https?:\/\/[^"\\]+/);
      if (u) urls.push(u[0]);
    });
  }

  return urls;
}

async function extractFromFrame(frame: Frame, baseUrl: string): Promise<string[]> {
  try {
    return await frame.evaluate((base: string) => {
      const urls: string[] = [];

      document.querySelectorAll("video, source, embed, object, audio").forEach((el) => {
        const attrs = ["src", "data-src", "data-lazy-src", "data-url", "data-video-src", "data-file", "content"];
        attrs.forEach(attr => {
          const val = el.getAttribute(attr);
          if (val && val.startsWith("http")) urls.push(val);
        });
      });

      document.querySelectorAll("a[href]").forEach((el) => {
        const href = el.getAttribute("href") || "";
        if (/\.(mp4|m3u8|mkv|mpd|webm|flv|mov)/i.test(href)) {
          urls.push(href);
        }
      });

      document.querySelectorAll("script").forEach((script) => {
        const text = script.textContent || "";
        const directMatches = text.match(
          /https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd|mkv|webm|f4v|ts|flv|mov)[^\s"'<>\\]*/gi
        );
        if (directMatches) urls.push(...directMatches);

        const propMatches = text.match(
          /(?:src|file|url|source|video_url|stream_url|manifest|playlist|hls_url|dash_url|video_link|mp4_url|stream|playback)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>\\,;]+)/gi
        );
        if (propMatches) {
          propMatches.forEach(m => {
            const u = m.match(/https?:\/\/[^\s"'<>\\,;]+/);
            if (u) urls.push(u[0]);
          });
        }

        const jsonMatches = text.match(
          /"(?:src|file|url|source|video|stream|hls|dash|mp4|playlist|manifest)"\s*:\s*"(https?:\/\/[^"\\]+)"/gi
        );
        if (jsonMatches) {
          jsonMatches.forEach(m => {
            const u = m.match(/https?:\/\/[^"\\]+/);
            if (u) urls.push(u[0]);
          });
        }
      });

      document.querySelectorAll('meta[property], meta[name]').forEach(meta => {
        const content = meta.getAttribute('content') || '';
        if (/\.(mp4|m3u8|mpd)/i.test(content)) {
          urls.push(content);
        }
      });

      const videos = document.querySelectorAll("video");
      videos.forEach(v => {
        if (v.src && !v.src.startsWith("blob:")) urls.push(v.src);
        if (v.currentSrc && !v.currentSrc.startsWith("blob:")) urls.push(v.currentSrc);
      });

      return urls;
    }, baseUrl).catch(() => [] as string[]);
  } catch {
    return [];
  }
}

async function extractBlobSources(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const urls: string[] = [];
      const videos = document.querySelectorAll("video");
      videos.forEach(v => {
        if (v.src && v.src.startsWith("blob:")) {
          const ms = (v as any).ms_ || (v as any).mediaSource_;
          if (ms) {
            const sourceBuffers = ms.sourceBuffers;
            for (let i = 0; i < sourceBuffers.length; i++) {
              const sb = sourceBuffers[i];
              if (sb._url) urls.push(sb._url);
            }
          }

          if (v.currentSrc && !v.currentSrc.startsWith("blob:")) {
            urls.push(v.currentSrc);
          }
        }
      });

      const perfEntries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      perfEntries.forEach(entry => {
        const name = entry.name.toLowerCase();
        if (/\.(m3u8|mpd|mp4|ts|webm)/i.test(name) && !name.startsWith("blob:")) {
          urls.push(entry.name);
        }
        if (entry.initiatorType === "video" || entry.initiatorType === "xmlhttprequest" || entry.initiatorType === "fetch") {
          if (/\.(m3u8|mpd|mp4|ts)/i.test(name)) {
            urls.push(entry.name);
          }
        }
      });

      return urls;
    }).catch(() => [] as string[]);
  } catch {
    return [];
  }
}

async function clickPlayButtons(page: Page): Promise<void> {
  const selectors = PLAY_SELECTORS.join(", ");
  try {
    await page.evaluate((sel: string) => {
      const elements = document.querySelectorAll(sel);
      const clicked = new Set<Element>();
      elements.forEach(el => {
        if (clicked.size >= 5) return;
        if (el instanceof HTMLElement && el.offsetParent !== null) {
          el.click();
          clicked.add(el);
        }
      });

      if (clicked.size === 0) {
        const allButtons = document.querySelectorAll("button, [role='button']");
        allButtons.forEach(btn => {
          if (clicked.size >= 3) return;
          const text = (btn.textContent || "").toLowerCase();
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          if (text.includes("play") || text.includes("تشغيل") || text.includes("مشاهدة") ||
              text.includes("watch") || text.includes("شاهد") ||
              ariaLabel.includes("play") || ariaLabel.includes("تشغيل")) {
            if (btn instanceof HTMLElement && btn.offsetParent !== null) {
              btn.click();
              clicked.add(btn);
            }
          }
        });
      }
    }, selectors);
  } catch {}
}

async function activateIframeSources(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      document.querySelectorAll("iframe[data-src], iframe[data-lazy-src]").forEach(iframe => {
        const dataSrc = iframe.getAttribute("data-src") || iframe.getAttribute("data-lazy-src");
        if (dataSrc && !iframe.getAttribute("src")) {
          iframe.setAttribute("src", dataSrc);
        }
      });
    });
  } catch {}
}

async function deepIframeSearch(
  page: Page,
  foundUrls: Map<string, { url: string; contentType?: string }>,
  checkEarlyHit: () => void,
  targetUrl: string,
  depth: number = 0,
): Promise<void> {
  if (depth > 2) return;

  let frames: Frame[];
  try {
    frames = page.frames();
  } catch { return; }

  for (const frame of frames) {
    if (frame === page.mainFrame() && depth === 0) continue;
    try {
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === "about:blank" || frameUrl === "about:srcdoc") continue;

      const urls = await extractFromFrame(frame, frameUrl);
      for (const u of urls) {
        try {
          const abs = new URL(u, frameUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
          }
        } catch {}
      }

      try {
        await frame.evaluate(() => {
          const btns = document.querySelectorAll('button, [class*="play"], [id*="play"], .vjs-big-play-button, .jw-icon-playback');
          btns.forEach(b => { if (b instanceof HTMLElement && b.offsetParent !== null) b.click(); });
        });
      } catch {}
    } catch {}
  }
}

async function navigateToEmbedIframes(
  page: Page,
  browser: Browser,
  foundUrls: Map<string, { url: string; contentType?: string }>,
  checkEarlyHit: () => void,
  timeoutMs: number,
  deadline: number,
): Promise<void> {
  let iframeSrcs: string[] = [];
  try {
    iframeSrcs = await page.evaluate((selectors: string[]) => {
      const srcs: string[] = [];
      const seen = new Set<string>();
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(iframe => {
          const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
          if (src && src.startsWith("http") && !seen.has(src)) {
            seen.add(src);
            srcs.push(src);
          }
        });
      });
      if (srcs.length === 0) {
        document.querySelectorAll("iframe").forEach(iframe => {
          const src = iframe.getAttribute("src") || "";
          if (src && src.startsWith("http") && !seen.has(src)) {
            seen.add(src);
            srcs.push(src);
          }
        });
      }
      return srcs;
    }, IFRAME_NAV_SELECTORS);
  } catch {}

  for (const src of iframeSrcs.slice(0, 5)) {
    if (Date.now() >= deadline) break;
    if (foundUrls.size > 0 && Array.from(foundUrls.keys()).some(u => /\.(m3u8|mpd)/i.test(u))) break;

    let isPriv = false;
    try { isPriv = await isHostPrivateViadns(new URL(src).hostname); } catch {}
    if (isPriv) continue;

    try {
      const embedPage = await browser.newPage();
      await embedPage.setViewport({ width: 1920, height: 1080 });
      await embedPage.setUserAgent(randomUA());
      await embedPage.setExtraHTTPHeaders({
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        'Referer': page.url(),
      });

      await embedPage.setRequestInterception(true);
      embedPage.on("request", (request) => {
        const resourceType = request.resourceType();
        if (["image", "font", "stylesheet"].includes(resourceType)) { request.abort(); return; }
        const reqUrl = request.url();
        try {
          const parsed = new URL(reqUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) { request.abort(); return; }
          if (isPrivateIp(parsed.hostname)) { request.abort(); return; }
        } catch { request.abort(); return; }
        if (isVideoUrl(reqUrl)) {
          foundUrls.set(reqUrl, { url: reqUrl });
          checkEarlyHit();
        }
        request.continue();
      });
      embedPage.on("response", async (response) => {
        const respUrl = response.url();
        const ct = response.headers()["content-type"] || "";
        if (isVideoContentType(ct) || isVideoUrl(respUrl)) {
          foundUrls.set(respUrl, { url: respUrl, contentType: ct });
          checkEarlyHit();
        }
      });

      const remainingMs = Math.max(deadline - Date.now(), 5000);
      await embedPage.goto(src, { waitUntil: "networkidle2", timeout: Math.min(remainingMs, 15000) }).catch(() => {});

      await clickPlayButtons(embedPage);
      await new Promise(r => setTimeout(r, 3000));

      const embedUrls = await extractFromFrame(embedPage.mainFrame(), src);
      for (const u of embedUrls) {
        try {
          const abs = new URL(u, src).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
          }
        } catch {}
      }

      const blobUrls = await extractBlobSources(embedPage);
      for (const u of blobUrls) {
        if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) {
          foundUrls.set(u, { url: u });
          checkEarlyHit();
        }
      }

      await deepIframeSearch(embedPage, foundUrls, checkEarlyHit, src, 1);

      await embedPage.close().catch(() => {});
    } catch {}
  }
}

export async function sniffVideoUrls(
  targetUrl: string,
  roomSlug: string,
  timeoutMs = 60000,
): Promise<SniffResult> {
  const startTime = Date.now();

  if (activeSessions >= MAX_CONCURRENT) {
    return { success: false, urls: [], error: "الخادم مشغول — حاول بعد قليل", duration: 0 };
  }

  if (activeRoomSessions.has(roomSlug)) {
    return { success: false, urls: [], error: "يوجد عملية استخراج جارية في هذه الغرفة — انتظر قليلاً", duration: 0 };
  }

  activeSessions++;
  activeRoomSessions.add(roomSlug);
  let browser: Browser | null = null;

  console.log(`[link-sniffer] HUNT START room=${roomSlug} url=${targetUrl} active=${activeSessions}`);

  const deadline = startTime + timeoutMs;
  const pastDeadline = () => Date.now() >= deadline - 3000;

  try {
    browser = await launchBrowser();
    activeBrowsers.set(roomSlug, { browser, startedAt: Date.now() });
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(randomUA());
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });

    await page.setRequestInterception(true);

    const foundUrls = new Map<string, { url: string; contentType?: string }>();
    let earlyHit = false;
    let networkActivity = Date.now();
    const blockedHosts = new Set<string>();
    const allowedHosts = new Set<string>();

    const checkEarlyHit = () => {
      if (earlyHit) return;
      const hasHighValue = Array.from(foundUrls.keys()).some(
        u => u.includes(".m3u8") || u.includes(".mpd")
      );
      if (hasHighValue) {
        earlyHit = true;
        console.log(`[link-sniffer] EARLY HIT room=${roomSlug} — high-value URL found`);
      }
    };

    page.on("request", (request) => {
      networkActivity = Date.now();
      const resourceType = request.resourceType();
      if (["image", "font", "stylesheet"].includes(resourceType)) { request.abort(); return; }

      const reqUrl = request.url();
      try {
        const parsed = new URL(reqUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) { request.abort(); return; }
        const host = parsed.hostname;
        if (isPrivateIp(host)) { request.abort(); return; }
        if (blockedHosts.has(host)) { request.abort(); return; }

        if (!allowedHosts.has(host) && !net.isIP(host)) {
          isHostPrivateViadns(host).then(isPriv => {
            if (isPriv) blockedHosts.add(host);
            else allowedHosts.add(host);
          }).catch(() => {});
        }
      } catch { request.abort(); return; }

      if (isVideoUrl(reqUrl)) {
        console.log(`[link-sniffer] INTERCEPT [request] ${reqUrl.substring(0, 120)}`);
        foundUrls.set(reqUrl, { url: reqUrl });
        checkEarlyHit();
      }

      request.continue();
    });

    page.on("response", async (response) => {
      networkActivity = Date.now();
      const respUrl = response.url();
      const ct = response.headers()["content-type"] || "";

      if (isVideoContentType(ct) || isVideoUrl(respUrl)) {
        console.log(`[link-sniffer] INTERCEPT [response] ct=${ct} ${respUrl.substring(0, 120)}`);
        foundUrls.set(respUrl, { url: respUrl, contentType: ct });
        checkEarlyHit();
      }
    });

    console.log(`[link-sniffer] navigating to ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }).catch(() => {});

    console.log(`[link-sniffer] waiting for network idle (min 15s)...`);
    const MIN_WAIT_MS = 15000;
    const minWaitEnd = Date.now() + MIN_WAIT_MS;

    await activateIframeSources(page);

    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        const sinceLastNetwork = Date.now() - networkActivity;
        const pastMinWait = Date.now() >= minWaitEnd;

        if (pastDeadline()) { clearInterval(check); resolve(); return; }
        if (earlyHit && pastMinWait) { clearInterval(check); resolve(); return; }
        if (pastMinWait && sinceLastNetwork > 5000 && foundUrls.size > 0) { clearInterval(check); resolve(); return; }
      }, 1000);
      setTimeout(() => { clearInterval(check); resolve(); }, MIN_WAIT_MS);
    });

    if (!pastDeadline()) {
      console.log(`[link-sniffer] PHASE: auto-click play buttons`);
      await clickPlayButtons(page);
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!pastDeadline()) {
      console.log(`[link-sniffer] PHASE: DOM extraction`);
      const pageVideoUrls = await extractFromFrame(page.mainFrame(), targetUrl);
      for (const u of pageVideoUrls) {
        try {
          const abs = new URL(u, targetUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
          }
        } catch {}
      }
    }

    if (!pastDeadline()) {
      console.log(`[link-sniffer] PHASE: blob detection`);
      const blobUrls = await extractBlobSources(page);
      for (const u of blobUrls) {
        if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) {
          foundUrls.set(u, { url: u });
          checkEarlyHit();
        }
      }
    }

    if (!pastDeadline()) {
      console.log(`[link-sniffer] PHASE: deep iframe search (${page.frames().length} frames)`);
      await deepIframeSearch(page, foundUrls, checkEarlyHit, targetUrl, 0);
    }

    if (!pastDeadline() && (!earlyHit || foundUrls.size === 0)) {
      console.log(`[link-sniffer] PHASE: navigate to embed iframes`);
      await navigateToEmbedIframes(page, browser, foundUrls, checkEarlyHit, 20000, deadline);
    }

    if (!pastDeadline() && foundUrls.size === 0) {
      console.log(`[link-sniffer] PHASE: aggressive retry — click + wait`);
      await clickPlayButtons(page);
      await page.evaluate(() => {
        document.querySelectorAll('[class*="server"], [class*="سيرفر"], [class*="quality"], [data-server]').forEach(el => {
          if (el instanceof HTMLElement) el.click();
        });
      }).catch(() => {});

      const waitTime = Math.min(8000, Math.max(deadline - Date.now() - 5000, 2000));
      await new Promise(r => setTimeout(r, waitTime));

      const retryUrls = await extractFromFrame(page.mainFrame(), targetUrl);
      for (const u of retryUrls) {
        try {
          const abs = new URL(u, targetUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
          }
        } catch {}
      }

      if (!pastDeadline()) {
        await deepIframeSearch(page, foundUrls, checkEarlyHit, targetUrl, 0);
        const retryBlob = await extractBlobSources(page);
        for (const u of retryBlob) {
          if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) {
            foundUrls.set(u, { url: u });
          }
        }
      }
    }

    if (!pastDeadline() && foundUrls.size === 0) {
      console.log(`[link-sniffer] PHASE: final network monitor`);
      const finalWait = Math.min(10000, Math.max(deadline - Date.now() - 2000, 2000));
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, finalWait);
        const check = setInterval(() => {
          if (foundUrls.size > 0 || pastDeadline()) { clearInterval(check); clearTimeout(timeout); resolve(); }
        }, 500);
      });
    }

    const results = Array.from(foundUrls.values())
      .map((entry) => ({
        url: entry.url,
        type: detectType(entry.url),
        quality: detectQuality(entry.url),
        score: scoreUrl(entry.url),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const duration = Date.now() - startTime;
    console.log(`[link-sniffer] ${results.length > 0 ? '✅' : '❌'} HUNT DONE room=${roomSlug} found=${results.length} duration=${duration}ms`);

    return { success: results.length > 0, urls: results, duration };
  } catch (err: any) {
    console.error(`[link-sniffer] ❌ error room=${roomSlug}: ${err.message}`);
    return {
      success: false, urls: [],
      error: err.message || "فشل استخراج الروابط",
      duration: Date.now() - startTime,
    };
  } finally {
    activeSessions--;
    activeRoomSessions.delete(roomSlug);
    activeBrowsers.delete(roomSlug);
    if (browser) { try { await browser.close(); } catch {} }
    console.log(`[link-sniffer] 🧹 cleanup room=${roomSlug} active=${activeSessions}`);
  }
}
