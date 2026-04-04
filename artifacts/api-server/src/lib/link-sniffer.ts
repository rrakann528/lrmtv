import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, Frame } from "puppeteer-core";
import * as fs from "fs";
import * as net from "net";
import * as dns from "dns/promises";

puppeteerExtra.use(StealthPlugin());

const dnsCache = new Map<string, { isPrivate: boolean; ts: number }>();
const DNS_CACHE_TTL = 30_000;

async function isHostPrivateViaDns(hostname: string): Promise<boolean> {
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
  '.icon-play', '[class*="icon-play"]',
  '.fa-play', '.fas.fa-play', '.bi-play-fill',
  '[class*="player"] button', '[id*="player"] button',
  '.video-js .vjs-play-control',
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
  'iframe[src*="vidoza"]', 'iframe[src*="supervideo"]',
  'iframe[src*="streamsb"]', 'iframe[src*="fembed"]',
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
  debug?: {
    title: string;
    iframesFound: number;
    buttonsFound: number;
    popupsBlocked: number;
    networkRequests: number;
    phases: string[];
  };
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
      console.warn(`[sniffer] orphan cleanup room=${roomSlug} age=${now - entry.startedAt}ms`);
      try { entry.browser.close(); } catch {}
      activeBrowsers.delete(roomSlug);
      activeRoomSessions.delete(roomSlug);
    }
  }
}, 30_000);

export function abortRoomSession(roomSlug: string): void {
  const entry = activeBrowsers.get(roomSlug);
  if (entry) {
    console.log(`[sniffer] aborting session room=${roomSlug}`);
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
  console.log(`[sniffer] launching stealth browser: ${execPath}`);

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

interface DebugInfo {
  title: string;
  iframesFound: number;
  buttonsFound: number;
  popupsBlocked: number;
  networkRequests: number;
  phases: string[];
}

async function diagnosePage(page: Page): Promise<{
  title: string;
  iframeCount: number;
  iframeSrcs: string[];
  buttonCount: number;
  buttonTexts: string[];
  videoElements: number;
  hasPopups: boolean;
  bodyText: string;
}> {
  try {
    return await page.evaluate(() => {
      const iframes = document.querySelectorAll("iframe");
      const iframeSrcs: string[] = [];
      iframes.forEach(f => {
        const s = f.getAttribute("src") || f.getAttribute("data-src") || "(no src)";
        iframeSrcs.push(s.substring(0, 100));
      });

      const buttons = document.querySelectorAll("button, [role='button'], a.btn, .btn, [class*='play'], [class*='watch']");
      const buttonTexts: string[] = [];
      buttons.forEach(b => {
        const txt = (b.textContent || "").trim().substring(0, 50);
        if (txt) buttonTexts.push(txt);
      });

      const videos = document.querySelectorAll("video, source, embed, object");

      const overlays = document.querySelectorAll('[class*="popup"], [class*="overlay"], [class*="modal"], [class*="ad-"], [id*="popup"], [id*="overlay"]');

      const body = document.body?.innerText || "";
      const snippet = body.substring(0, 500).replace(/\s+/g, " ");

      return {
        title: document.title || "(no title)",
        iframeCount: iframes.length,
        iframeSrcs: iframeSrcs.slice(0, 10),
        buttonCount: buttons.length,
        buttonTexts: buttonTexts.slice(0, 15),
        videoElements: videos.length,
        hasPopups: overlays.length > 0,
        bodyText: snippet,
      };
    });
  } catch {
    return {
      title: "(failed to diagnose)",
      iframeCount: 0, iframeSrcs: [],
      buttonCount: 0, buttonTexts: [],
      videoElements: 0, hasPopups: false, bodyText: "",
    };
  }
}

async function clickPlayButtons(page: Page, log: (msg: string) => void): Promise<number> {
  const selectors = PLAY_SELECTORS.join(", ");
  try {
    const clickedCount = await page.evaluate((sel: string) => {
      let clicked = 0;

      const elements = document.querySelectorAll(sel);
      elements.forEach(el => {
        if (clicked >= 5) return;
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            el.click();
            clicked++;
          }
        }
      });

      if (clicked === 0) {
        const allClickable = document.querySelectorAll("button, [role='button'], a, div[onclick], span[onclick]");
        allClickable.forEach(btn => {
          if (clicked >= 5) return;
          const text = (btn.textContent || "").toLowerCase();
          const cls = (btn.getAttribute("class") || "").toLowerCase();
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          const title = (btn.getAttribute("title") || "").toLowerCase();

          const isPlayRelated =
            text.includes("play") || text.includes("تشغيل") || text.includes("مشاهدة") ||
            text.includes("watch") || text.includes("شاهد") || text.includes("start") ||
            text.includes("ابدأ") || text.includes("اضغط") || text.includes("click") ||
            cls.includes("play") || cls.includes("watch") || cls.includes("start") ||
            ariaLabel.includes("play") || ariaLabel.includes("تشغيل") ||
            title.includes("play") || title.includes("تشغيل");

          if (isPlayRelated && btn instanceof HTMLElement) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              clicked++;
            }
          }
        });
      }

      return clicked;
    }, selectors);

    log(`clicked ${clickedCount} play-related elements`);
    return clickedCount;
  } catch {
    return 0;
  }
}

async function dismissPopups(page: Page, log: (msg: string) => void): Promise<number> {
  try {
    const dismissed = await page.evaluate(() => {
      let count = 0;
      const closeSelectors = [
        '[class*="close"]', '[id*="close"]',
        '[class*="dismiss"]', '[class*="skip"]',
        '[aria-label*="close" i]', '[aria-label*="إغلاق"]',
        'button.close', '.modal .close', '.popup .close',
        '[class*="overlay"] [class*="close"]',
        '.ad-close', '#ad-close', '[class*="ad-close"]',
      ];

      closeSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          if (count >= 5) return;
          if (el instanceof HTMLElement) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              el.click();
              count++;
            }
          }
        });
      });

      document.querySelectorAll('[class*="overlay"], [class*="popup"], [class*="modal"]').forEach(el => {
        if (el instanceof HTMLElement) {
          const style = window.getComputedStyle(el);
          if (style.position === "fixed" || style.position === "absolute") {
            if (parseFloat(style.zIndex) > 100 || style.zIndex === "auto") {
              el.style.display = "none";
              count++;
            }
          }
        }
      });

      return count;
    });

    if (dismissed > 0) log(`dismissed ${dismissed} popups/overlays`);
    return dismissed;
  } catch {
    return 0;
  }
}

async function activateIframeSources(page: Page, log: (msg: string) => void): Promise<number> {
  try {
    const activated = await page.evaluate(() => {
      let count = 0;
      document.querySelectorAll("iframe[data-src], iframe[data-lazy-src], iframe[data-url]").forEach(iframe => {
        const dataSrc = iframe.getAttribute("data-src") || iframe.getAttribute("data-lazy-src") || iframe.getAttribute("data-url");
        if (dataSrc && (!iframe.getAttribute("src") || iframe.getAttribute("src") === "about:blank")) {
          iframe.setAttribute("src", dataSrc);
          count++;
        }
      });
      return count;
    });
    if (activated > 0) log(`activated ${activated} lazy iframes`);
    return activated;
  } catch {
    return 0;
  }
}

async function clickServerButtons(page: Page, log: (msg: string) => void): Promise<number> {
  try {
    const clicked = await page.evaluate(() => {
      let count = 0;
      const serverSelectors = [
        '[class*="server"]', '[class*="سيرفر"]',
        '[class*="quality"]', '[data-server]',
        '[class*="host"]', '[class*="mirror"]',
        '[class*="tab"]', '[class*="episode"]',
        'li[data-server]', 'li[data-embed]',
        'a[data-embed]', 'a[data-server]',
        '[class*="link-server"]', '[class*="linkserver"]',
      ];
      const sel = serverSelectors.join(", ");
      const elements = document.querySelectorAll(sel);
      elements.forEach(el => {
        if (count >= 3) return;
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            el.click();
            count++;
          }
        }
      });
      return count;
    });
    if (clicked > 0) log(`clicked ${clicked} server/quality buttons`);
    return clicked;
  } catch {
    return 0;
  }
}

async function extractFromFrame(frame: Frame, baseUrl: string): Promise<string[]> {
  try {
    return await frame.evaluate((base: string) => {
      const urls: string[] = [];

      document.querySelectorAll("video, source, embed, object, audio").forEach((el) => {
        const attrs = ["src", "data-src", "data-lazy-src", "data-url", "data-video-src", "data-file", "content"];
        attrs.forEach(attr => {
          const val = el.getAttribute(attr);
          if (val && (val.startsWith("http") || val.startsWith("//"))) urls.push(val);
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
        if (text.length < 10) return;

        const directMatches = text.match(
          /https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd|mkv|webm|f4v|ts|flv|mov)[^\s"'<>\\]*/gi
        );
        if (directMatches) urls.push(...directMatches);

        const propMatches = text.match(
          /(?:src|file|url|source|video_url|stream_url|manifest|playlist|hls_url|dash_url|video_link|mp4_url|stream|playback|sources)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>\\,;\]]+)/gi
        );
        if (propMatches) {
          propMatches.forEach(m => {
            const u = m.match(/https?:\/\/[^\s"'<>\\,;\]]+/);
            if (u) urls.push(u[0]);
          });
        }

        const jsonMatches = text.match(
          /"(?:src|file|url|source|video|stream|hls|dash|mp4|playlist|manifest|sources)"\s*:\s*"(https?:\/\/[^"\\]+)"/gi
        );
        if (jsonMatches) {
          jsonMatches.forEach(m => {
            const u = m.match(/https?:\/\/[^"\\]+/);
            if (u) urls.push(u[0]);
          });
        }

        const evalMatches = text.match(/atob\s*\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/g);
        if (evalMatches) {
          evalMatches.forEach(m => {
            const b64 = m.match(/["']([A-Za-z0-9+/=]{20,})["']/);
            if (b64) {
              try {
                const decoded = atob(b64[1]);
                const decodedUrls = decoded.match(/https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd)[^\s"'<>\\]*/gi);
                if (decodedUrls) urls.push(...decodedUrls);
              } catch {}
            }
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

      const perfEntries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      perfEntries.forEach(entry => {
        const name = entry.name;
        if (/\.(m3u8|mpd|mp4|ts|webm)/i.test(name) && !name.startsWith("blob:")) {
          urls.push(name);
        }
        if ((entry.initiatorType === "video" || entry.initiatorType === "xmlhttprequest" || entry.initiatorType === "fetch") &&
            /\.(m3u8|mpd|mp4|ts)/i.test(name)) {
          urls.push(name);
        }
      });

      const videos = document.querySelectorAll("video");
      videos.forEach(v => {
        if (v.src && v.src.startsWith("blob:")) {
          if (v.currentSrc && !v.currentSrc.startsWith("blob:")) {
            urls.push(v.currentSrc);
          }
        }
      });

      return urls;
    }).catch(() => [] as string[]);
  } catch {
    return [];
  }
}

async function deepIframeSearch(
  page: Page,
  foundUrls: Map<string, { url: string; contentType?: string }>,
  checkEarlyHit: () => void,
  targetUrl: string,
  depth: number,
  log: (msg: string) => void,
): Promise<void> {
  if (depth > 2) return;

  let frames: Frame[];
  try {
    frames = page.frames();
  } catch { return; }

  log(`scanning ${frames.length} frames at depth=${depth}`);

  for (const frame of frames) {
    if (frame === page.mainFrame() && depth === 0) continue;
    try {
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === "about:blank" || frameUrl === "about:srcdoc") continue;

      log(`  frame[d${depth}]: ${frameUrl.substring(0, 100)}`);

      const urls = await extractFromFrame(frame, frameUrl);
      let added = 0;
      for (const u of urls) {
        try {
          const abs = new URL(u, frameUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
            added++;
          }
        } catch {}
      }
      if (added > 0) log(`  frame[d${depth}] found ${added} video URLs`);

      try {
        await frame.evaluate(() => {
          const btns = document.querySelectorAll('button, [class*="play"], [id*="play"], .vjs-big-play-button, .jw-icon-playback, .plyr__control--overlaid');
          let clicked = 0;
          btns.forEach(b => {
            if (clicked >= 3) return;
            if (b instanceof HTMLElement) {
              const rect = b.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) { b.click(); clicked++; }
            }
          });
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
  deadline: number,
  log: (msg: string) => void,
): Promise<void> {
  let iframeSrcs: string[] = [];
  try {
    iframeSrcs = await page.evaluate((selectors: string[]) => {
      const srcs: string[] = [];
      const seen = new Set<string>();
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(iframe => {
          const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
          if (src && (src.startsWith("http") || src.startsWith("//")) && !seen.has(src)) {
            seen.add(src);
            srcs.push(src.startsWith("//") ? "https:" + src : src);
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

  log(`found ${iframeSrcs.length} embed iframes to navigate: ${iframeSrcs.map(s => s.substring(0, 60)).join(", ")}`);

  for (const src of iframeSrcs.slice(0, 5)) {
    if (Date.now() >= deadline) { log("deadline reached, stopping iframe navigation"); break; }
    if (foundUrls.size > 0 && Array.from(foundUrls.keys()).some(u => /\.(m3u8|mpd)/i.test(u))) {
      log("high-value URL already found, skipping remaining iframes");
      break;
    }

    let isPriv = false;
    try { isPriv = await isHostPrivateViaDns(new URL(src).hostname); } catch {}
    if (isPriv) { log(`skipped private host: ${src.substring(0, 60)}`); continue; }

    log(`navigating to embed: ${src.substring(0, 80)}`);
    let embedPage: Page | null = null;
    try {
      embedPage = await browser.newPage() as unknown as Page;
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
          log(`  embed INTERCEPT: ${reqUrl.substring(0, 100)}`);
          foundUrls.set(reqUrl, { url: reqUrl });
          checkEarlyHit();
        }
        request.continue();
      });
      embedPage.on("response", async (response) => {
        const respUrl = response.url();
        const ct = response.headers()["content-type"] || "";
        if (isVideoContentType(ct) || isVideoUrl(respUrl)) {
          log(`  embed INTERCEPT [resp]: ${respUrl.substring(0, 100)}`);
          foundUrls.set(respUrl, { url: respUrl, contentType: ct });
          checkEarlyHit();
        }
      });

      const remainingMs = Math.max(deadline - Date.now(), 5000);
      await embedPage.goto(src, { waitUntil: "networkidle2", timeout: Math.min(remainingMs, 15000) }).catch(() => {});

      await dismissPopups(embedPage, log);
      await clickPlayButtons(embedPage, log);
      await new Promise(r => setTimeout(r, 3000));

      const embedUrls = await extractFromFrame(embedPage.mainFrame(), src);
      let added = 0;
      for (const u of embedUrls) {
        try {
          const abs = new URL(u, src).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
            added++;
          }
        } catch {}
      }
      if (added > 0) log(`  embed page found ${added} video URLs`);

      const blobUrls = await extractBlobSources(embedPage);
      for (const u of blobUrls) {
        if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) {
          foundUrls.set(u, { url: u });
          checkEarlyHit();
        }
      }

      await deepIframeSearch(embedPage, foundUrls, checkEarlyHit, src, 1, log);
    } catch (e: any) {
      log(`  embed error: ${e.message?.substring(0, 80)}`);
    } finally {
      if (embedPage) await embedPage.close().catch(() => {});
    }
  }
}

function setupRequestInterception(
  page: Page,
  foundUrls: Map<string, { url: string; contentType?: string }>,
  checkEarlyHit: () => void,
  debugInfo: DebugInfo,
  blockedHosts: Set<string>,
  allowedHosts: Set<string>,
  log: (msg: string) => void,
) {
  let networkActivity = Date.now();

  page.on("request", (request) => {
    networkActivity = Date.now();
    debugInfo.networkRequests++;
    const resourceType = request.resourceType();
    if (["image", "font", "stylesheet"].includes(resourceType)) { request.abort(); return; }

    if (resourceType === "other" || resourceType === "document") {
      const reqUrl = request.url();
      const isPopup = reqUrl.includes("popup") || reqUrl.includes("click") || reqUrl.includes("ad.");
      if (isPopup && resourceType === "document" && request.isNavigationRequest()) {
        debugInfo.popupsBlocked++;
        request.abort();
        return;
      }
    }

    const reqUrl = request.url();
    try {
      const parsed = new URL(reqUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) { request.abort(); return; }
      const host = parsed.hostname;
      if (isPrivateIp(host)) { request.abort(); return; }
      if (blockedHosts.has(host)) { request.abort(); return; }

      if (!allowedHosts.has(host) && !net.isIP(host)) {
        isHostPrivateViaDns(host).then(isPriv => {
          if (isPriv) blockedHosts.add(host);
          else allowedHosts.add(host);
        }).catch(() => {});
      }
    } catch { request.abort(); return; }

    if (isVideoUrl(reqUrl)) {
      log(`INTERCEPT [req]: ${reqUrl.substring(0, 120)}`);
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
      log(`INTERCEPT [resp] ct=${ct.substring(0, 30)}: ${respUrl.substring(0, 120)}`);
      foundUrls.set(respUrl, { url: respUrl, contentType: ct });
      checkEarlyHit();
    }
  });

  return () => networkActivity;
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

  const deadline = startTime + timeoutMs;
  const pastDeadline = () => Date.now() >= deadline - 3000;

  const debugInfo: DebugInfo = {
    title: "",
    iframesFound: 0,
    buttonsFound: 0,
    popupsBlocked: 0,
    networkRequests: 0,
    phases: [],
  };

  const log = (msg: string) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[sniffer ${elapsed}s] [${roomSlug}] ${msg}`);
  };

  log(`=== HUNT START === url=${targetUrl}`);

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
    const blockedHosts = new Set<string>();
    const allowedHosts = new Set<string>();

    const checkEarlyHit = () => {
      if (earlyHit) return;
      const hasHighValue = Array.from(foundUrls.keys()).some(
        u => u.includes(".m3u8") || u.includes(".mpd")
      );
      if (hasHighValue) {
        earlyHit = true;
        log("EARLY HIT — high-value URL found!");
      }
    };

    const getNetworkActivity = setupRequestInterception(page, foundUrls, checkEarlyHit, debugInfo, blockedHosts, allowedHosts, log);

    // ===== PHASE 1: Navigate =====
    debugInfo.phases.push("navigate");
    log("PHASE 1: navigating...");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(e => {
      log(`navigation warning: ${e.message?.substring(0, 80)}`);
    });

    // ===== Diagnose page =====
    const diag = await diagnosePage(page);
    debugInfo.title = diag.title;
    debugInfo.iframesFound = diag.iframeCount;
    debugInfo.buttonsFound = diag.buttonCount;
    log(`PAGE: title="${diag.title}" iframes=${diag.iframeCount} buttons=${diag.buttonCount} videos=${diag.videoElements} popups=${diag.hasPopups}`);
    if (diag.iframeSrcs.length > 0) log(`IFRAMES: ${diag.iframeSrcs.join(" | ")}`);
    if (diag.buttonTexts.length > 0) log(`BUTTONS: ${diag.buttonTexts.slice(0, 10).join(" | ")}`);
    if (diag.videoElements === 0 && diag.iframeCount === 0) {
      log(`BODY PREVIEW: ${diag.bodyText.substring(0, 200)}`);
    }

    // ===== PHASE 2: Dismiss popups + activate lazy iframes =====
    debugInfo.phases.push("dismiss-popups");
    const dismissed = await dismissPopups(page, log);
    debugInfo.popupsBlocked += dismissed;
    await activateIframeSources(page, log);

    // ===== PHASE 3: Auto-click play buttons =====
    if (!pastDeadline()) {
      debugInfo.phases.push("auto-click");
      log("PHASE 3: auto-clicking play buttons...");
      await clickPlayButtons(page, log);
    }

    // ===== PHASE 4: Wait for network (min 20s from start) =====
    debugInfo.phases.push("network-wait");
    log("PHASE 4: monitoring network traffic (min 20s)...");
    const MIN_WAIT_MS = 20000;
    const minWaitEnd = startTime + MIN_WAIT_MS;

    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        const sinceLastNetwork = Date.now() - getNetworkActivity();
        const pastMinWait = Date.now() >= minWaitEnd;

        if (pastDeadline()) { clearInterval(check); resolve(); return; }
        if (earlyHit && pastMinWait) { clearInterval(check); resolve(); return; }
        if (pastMinWait && sinceLastNetwork > 5000 && foundUrls.size > 0) { clearInterval(check); resolve(); return; }
      }, 1000);
      const waitRemaining = Math.max(minWaitEnd - Date.now(), 0);
      setTimeout(() => { clearInterval(check); resolve(); }, waitRemaining + 1000);
    });

    log(`after wait: found=${foundUrls.size} earlyHit=${earlyHit}`);

    // ===== PHASE 5: DOM extraction =====
    if (!pastDeadline()) {
      debugInfo.phases.push("dom-extract");
      log("PHASE 5: extracting from DOM...");
      const pageVideoUrls = await extractFromFrame(page.mainFrame(), targetUrl);
      let domAdded = 0;
      for (const u of pageVideoUrls) {
        try {
          const abs = new URL(u, targetUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) {
            foundUrls.set(abs, { url: abs });
            checkEarlyHit();
            domAdded++;
          }
        } catch {}
      }
      log(`DOM extraction: found ${domAdded} new URLs`);
    }

    // ===== PHASE 6: Blob/Performance API =====
    if (!pastDeadline()) {
      debugInfo.phases.push("blob-detect");
      log("PHASE 6: checking Performance API + blob sources...");
      const blobUrls = await extractBlobSources(page);
      let blobAdded = 0;
      for (const u of blobUrls) {
        if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) {
          foundUrls.set(u, { url: u });
          checkEarlyHit();
          blobAdded++;
        }
      }
      if (blobAdded > 0) log(`blob/perf: found ${blobAdded} URLs`);
    }

    // ===== PHASE 7: Deep iframe search =====
    if (!pastDeadline()) {
      debugInfo.phases.push("deep-iframe");
      log(`PHASE 7: deep iframe search (${page.frames().length} frames)...`);
      await deepIframeSearch(page, foundUrls, checkEarlyHit, targetUrl, 0, log);
    }

    // ===== PHASE 8: Navigate to embed iframes =====
    if (!pastDeadline() && (!earlyHit || foundUrls.size === 0)) {
      debugInfo.phases.push("embed-navigate");
      log("PHASE 8: navigating to embed iframes...");
      await navigateToEmbedIframes(page, browser, foundUrls, checkEarlyHit, deadline, log);
    }

    // ===== PHASE 9: Aggressive retry =====
    if (!pastDeadline() && foundUrls.size === 0) {
      debugInfo.phases.push("aggressive-retry");
      log("PHASE 9: aggressive retry — clicking servers + re-scan...");

      await clickServerButtons(page, log);
      await new Promise(r => setTimeout(r, 3000));

      await clickPlayButtons(page, log);
      const waitTime = Math.min(5000, Math.max(deadline - Date.now() - 8000, 2000));
      await new Promise(r => setTimeout(r, waitTime));

      const retryDiag = await diagnosePage(page);
      log(`RETRY page: title="${retryDiag.title}" iframes=${retryDiag.iframeCount} videos=${retryDiag.videoElements}`);
      if (retryDiag.iframeSrcs.length > 0) log(`RETRY IFRAMES: ${retryDiag.iframeSrcs.join(" | ")}`);

      const retryUrls = await extractFromFrame(page.mainFrame(), targetUrl);
      for (const u of retryUrls) {
        try {
          const abs = new URL(u, targetUrl).href;
          if (isVideoUrl(abs) || /\.(m3u8|mpd|mp4)/i.test(abs)) foundUrls.set(abs, { url: abs });
        } catch {}
      }

      await activateIframeSources(page, log);

      if (!pastDeadline()) {
        await deepIframeSearch(page, foundUrls, checkEarlyHit, targetUrl, 0, log);
        const retryBlob = await extractBlobSources(page);
        for (const u of retryBlob) {
          if (isVideoUrl(u) || /\.(m3u8|mpd|mp4|ts)/i.test(u)) foundUrls.set(u, { url: u });
        }
      }

      if (!pastDeadline() && foundUrls.size === 0) {
        await navigateToEmbedIframes(page, browser, foundUrls, checkEarlyHit, deadline, log);
      }
    }

    // ===== PHASE 10: Final monitor =====
    if (!pastDeadline() && foundUrls.size === 0) {
      debugInfo.phases.push("final-monitor");
      log("PHASE 10: final network monitor...");
      const finalWait = Math.min(8000, Math.max(deadline - Date.now() - 2000, 2000));
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
    log(`=== HUNT ${results.length > 0 ? 'SUCCESS' : 'FAILED'} === found=${results.length} duration=${duration}ms phases=${debugInfo.phases.join(",")} requests=${debugInfo.networkRequests} popups=${debugInfo.popupsBlocked}`);

    if (results.length === 0) {
      log(`FAILURE REPORT: title="${debugInfo.title}" iframes=${debugInfo.iframesFound} buttons=${debugInfo.buttonsFound} requests=${debugInfo.networkRequests} popups=${debugInfo.popupsBlocked}`);
    }

    return {
      success: results.length > 0,
      urls: results,
      duration,
      debug: debugInfo,
    };
  } catch (err: any) {
    log(`=== ERROR === ${err.message}`);
    return {
      success: false, urls: [],
      error: err.message || "فشل استخراج الروابط",
      duration: Date.now() - startTime,
      debug: debugInfo,
    };
  } finally {
    activeSessions--;
    activeRoomSessions.delete(roomSlug);
    activeBrowsers.delete(roomSlug);
    if (browser) { try { await browser.close(); } catch {} }
    log(`cleanup done, active=${activeSessions}`);
  }
}
