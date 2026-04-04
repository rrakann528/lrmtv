import puppeteer, { type Browser } from "puppeteer-core";
import * as fs from "fs";
import * as net from "net";

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".m3u8",
  ".ts",
  ".mkv",
  ".avi",
  ".webm",
  ".flv",
  ".mov",
  ".mpd",
  ".f4v",
  ".ogv",
  ".3gp",
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
  "google",
  "facebook",
  "doubleclick",
  "adservice",
  "analytics",
  "googletagmanager",
  "googlesyndication",
  "adsrvr",
  "amazon-adsystem",
  "adnxs",
  "criteo",
  "fonts.googleapis",
  "cdnjs",
  "jquery",
  ".css",
  ".js?",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
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
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower === "::") return true;
    return false;
  }
  return false;
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
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
const MAX_BROWSER_AGE_MS = 60_000;

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

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  delete navigator.__proto__.webdriver;

  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const p = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      p.length = 3;
      return p;
    },
  });

  Object.defineProperty(navigator, 'languages', { get: () => ['ar', 'en-US', 'en'] });

  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }, connect: function() {}, sendMessage: function() {} },
  };

  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (params) =>
    params.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : origQuery(params);

  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
  };
`;

async function launchBrowser(): Promise<Browser> {
  const execPath = findChromiumPath();
  console.log(`[link-sniffer] launching browser: ${execPath}`);

  return puppeteer.launch({
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
    ],
  });
}

export async function sniffVideoUrls(
  targetUrl: string,
  roomSlug: string,
  timeoutMs = 45000,
): Promise<SniffResult> {
  const startTime = Date.now();

  if (activeSessions >= MAX_CONCURRENT) {
    return {
      success: false,
      urls: [],
      error: "الخادم مشغول — حاول بعد قليل",
      duration: Date.now() - startTime,
    };
  }

  if (activeRoomSessions.has(roomSlug)) {
    return {
      success: false,
      urls: [],
      error: "يوجد عملية استخراج جارية في هذه الغرفة — انتظر قليلاً",
      duration: Date.now() - startTime,
    };
  }

  activeSessions++;
  activeRoomSessions.add(roomSlug);
  let browser: Browser | null = null;

  console.log(`[link-sniffer] start room=${roomSlug} url=${targetUrl} active=${activeSessions}`);

  try {
    browser = await launchBrowser();
    activeBrowsers.set(roomSlug, { browser, startedAt: Date.now() });
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(randomUA());
    await page.evaluateOnNewDocument(STEALTH_SCRIPT);

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

    const checkEarlyHit = () => {
      if (earlyHit) return;
      const hasHighValue = Array.from(foundUrls.keys()).some(
        u => u.includes(".m3u8") || u.includes(".mpd")
      );
      if (hasHighValue) {
        earlyHit = true;
        console.log(`[link-sniffer] early hit room=${roomSlug} — high-value URL found, will resolve shortly`);
      }
    };

    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["image", "font", "stylesheet"].includes(resourceType)) {
        request.abort();
        return;
      }

      const reqUrl = request.url();

      try {
        const parsed = new URL(reqUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          request.abort();
          return;
        }
        if (isPrivateIp(parsed.hostname)) {
          request.abort();
          return;
        }
      } catch {
        request.abort();
        return;
      }

      if (isVideoUrl(reqUrl)) {
        foundUrls.set(reqUrl, { url: reqUrl });
        checkEarlyHit();
      }

      request.continue();
    });

    page.on("response", async (response) => {
      const respUrl = response.url();
      const ct = response.headers()["content-type"] || "";

      if (isVideoContentType(ct) || isVideoUrl(respUrl)) {
        foundUrls.set(respUrl, { url: respUrl, contentType: ct });
        checkEarlyHit();
      }
    });

    const navigationPromise = page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: timeoutMs - 5000,
    }).catch(() => {});

    const earlyResolvePromise = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (earlyHit) { clearInterval(check); resolve(); }
      }, 500);
      setTimeout(() => { clearInterval(check); resolve(); }, timeoutMs - 5000);
    });

    await Promise.race([navigationPromise, earlyResolvePromise]);

    if (!earlyHit) {
      const pageVideoUrls = await page.evaluate(() => {
        const urls: string[] = [];
        document.querySelectorAll("video, source, iframe, embed, object").forEach((el) => {
          const src =
            el.getAttribute("src") ||
            el.getAttribute("data-src") ||
            el.getAttribute("data-lazy-src") ||
            el.getAttribute("data-url") ||
            el.getAttribute("data-video-src") ||
            el.getAttribute("content");
          if (src) urls.push(src);
        });
        document.querySelectorAll("a[href]").forEach((el) => {
          const href = el.getAttribute("href") || "";
          if (
            href.includes(".mp4") ||
            href.includes(".m3u8") ||
            href.includes(".mkv") ||
            href.includes(".mpd") ||
            href.includes(".webm")
          ) {
            urls.push(href);
          }
        });

        const scripts = document.querySelectorAll("script");
        scripts.forEach((script) => {
          const text = script.textContent || "";
          const urlMatches = text.match(
            /https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd|mkv|webm|f4v|ts|flv)[^\s"'<>\\]*/gi
          );
          if (urlMatches) urls.push(...urlMatches);

          const srcMatches = text.match(
            /(?:src|file|url|source|video_url|stream_url|manifest|playlist)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>\\]+)/gi
          );
          if (srcMatches) {
            srcMatches.forEach(m => {
              const u = m.match(/https?:\/\/[^\s"'<>\\]+/);
              if (u) urls.push(u[0]);
            });
          }
        });

        document.querySelectorAll('meta[property], meta[name]').forEach(meta => {
          const content = meta.getAttribute('content') || '';
          if (content.includes('.mp4') || content.includes('.m3u8') || content.includes('.mpd')) {
            urls.push(content);
          }
        });

        return urls;
      }).catch(() => [] as string[]);

      for (const u of pageVideoUrls) {
        try {
          const abs = new URL(u, targetUrl).href;
          if (isVideoUrl(abs) || abs.includes(".m3u8") || abs.includes(".mp4") || abs.includes(".mpd")) {
            foundUrls.set(abs, { url: abs });
          }
        } catch {}
      }

      if (!earlyHit) {
        const iframes = await page.$$("iframe");
        for (const iframe of iframes.slice(0, 5)) {
          try {
            const src = await iframe.evaluate((el) => el.src);
            if (!src || src === "about:blank") continue;

            const frame = await iframe.contentFrame();
            if (!frame) continue;

            const iframeVideoUrls = await frame
              .evaluate(() => {
                const urls: string[] = [];
                document.querySelectorAll("video, source, embed, object").forEach((el) => {
                  const s = el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-url");
                  if (s) urls.push(s);
                });
                const scripts = document.querySelectorAll("script");
                scripts.forEach((script) => {
                  const text = script.textContent || "";
                  const matches = text.match(
                    /https?:\/\/[^\s"'<>\\]+\.(mp4|m3u8|mpd|mkv|webm|f4v|ts)[^\s"'<>\\]*/gi
                  );
                  if (matches) urls.push(...matches);
                });
                return urls;
              })
              .catch(() => [] as string[]);

            for (const u of iframeVideoUrls) {
              try {
                const abs = new URL(u, src).href;
                foundUrls.set(abs, { url: abs });
              } catch {}
            }
          } catch {}
        }
      }
    }

    if (foundUrls.size === 0 && !earlyHit) {
      try {
        await page.evaluate(() => {
          document.querySelectorAll('button, .play-btn, [class*="play"], [id*="play"]').forEach(el => {
            if (el instanceof HTMLElement) el.click();
          });
        });
        await new Promise((r) => setTimeout(r, 5000));
      } catch {}
    }

    const results = Array.from(foundUrls.values())
      .map((entry) => ({
        url: entry.url,
        type: detectType(entry.url),
        quality: detectQuality(entry.url),
        score: scoreUrl(entry.url),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    console.log(`[link-sniffer] done room=${roomSlug} found=${results.length} earlyHit=${earlyHit} duration=${Date.now() - startTime}ms`);

    return {
      success: results.length > 0,
      urls: results,
      duration: Date.now() - startTime,
    };
  } catch (err: any) {
    console.error(`[link-sniffer] error room=${roomSlug}: ${err.message}`);
    return {
      success: false,
      urls: [],
      error: err.message || "فشل استخراج الروابط",
      duration: Date.now() - startTime,
    };
  } finally {
    activeSessions--;
    activeRoomSessions.delete(roomSlug);
    activeBrowsers.delete(roomSlug);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    console.log(`[link-sniffer] cleanup room=${roomSlug} active=${activeSessions}`);
  }
}
