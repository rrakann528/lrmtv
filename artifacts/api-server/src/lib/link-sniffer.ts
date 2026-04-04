import puppeteer, { type Browser } from "puppeteer-core";

const ALLOWED_DOMAINS = [
  "egybest",
  "shahid4u",
  "faselhd",
  "mycima",
  "cimaclub",
  "cimalek",
  "akwam",
  "arabseed",
  "wecima",
  "movizland",
  "cima4u",
  "egy.best",
  "shahed4u",
  "yallashoot",
  "koora",
  "kooralive",
  "yalla-shoot",
  "yallalive",
  "beinmatch",
  "as-goal",
  "livehd7",
  "kora-online",
  "koooragoal",
  "yalla-shoot",
];

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
];

const VIDEO_CONTENT_TYPES = [
  "video/",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "application/dash+xml",
  "application/octet-stream",
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

export function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
        || hostname === `${d}.com` || hostname.endsWith(`.${d}.com`)
        || hostname === `${d}.net` || hostname.endsWith(`.${d}.net`)
        || hostname === `${d}.org` || hostname.endsWith(`.${d}.org`)
        || hostname === `${d}.tv` || hostname.endsWith(`.${d}.tv`)
        || hostname === `${d}.me` || hostname.endsWith(`.${d}.me`)
    );
  } catch {
    return false;
  }
}

function isPrivateIp(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.")) return true;
  if (hostname.startsWith("169.254.")) return true;
  if (hostname.startsWith("0.") || hostname === "0.0.0.0") return true;
  return false;
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (IGNORE_PATTERNS.some((p) => lower.includes(p))) return false;
  return VIDEO_EXTENSIONS.some((ext) => {
    const idx = lower.indexOf(ext);
    if (idx === -1) return false;
    const afterExt = lower[idx + ext.length];
    return !afterExt || afterExt === "?" || afterExt === "&" || afterExt === "#";
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
  if (lower.includes("ad") && !lower.includes("load")) score -= 5;
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
  if (lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".mkv")) return "mp4";
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

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;
let activeSessions = 0;
const MAX_CONCURRENT = 3;

function findChromiumPath(): string {
  const paths = [
    process.env.CHROMIUM_PATH,
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ];
  for (const p of paths) {
    if (p) return p;
  }
  return "chromium";
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = puppeteer
    .launch({
      executablePath: findChromiumPath(),
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
      ],
    })
    .then((b) => {
      browserInstance = b;
      browserLaunchPromise = null;
      b.on("disconnected", () => {
        browserInstance = null;
      });
      return b;
    })
    .catch((err) => {
      browserLaunchPromise = null;
      throw err;
    });

  return browserLaunchPromise;
}

export async function sniffVideoUrls(targetUrl: string, timeoutMs = 45000): Promise<SniffResult> {
  const startTime = Date.now();

  if (activeSessions >= MAX_CONCURRENT) {
    return {
      success: false,
      urls: [],
      error: "الخادم مشغول — حاول بعد قليل",
      duration: Date.now() - startTime,
    };
  }

  activeSessions++;
  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    await page.setRequestInterception(true);

    const foundUrls = new Map<string, { url: string; contentType?: string }>();

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
      }

      request.continue();
    });

    page.on("response", async (response) => {
      const respUrl = response.url();
      const ct = response.headers()["content-type"] || "";

      if (isVideoContentType(ct) || isVideoUrl(respUrl)) {
        foundUrls.set(respUrl, { url: respUrl, contentType: ct });
      }
    });

    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: timeoutMs - 5000,
    });

    const pageVideoUrls = await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll("video, source, iframe").forEach((el) => {
        const src =
          el.getAttribute("src") ||
          el.getAttribute("data-src") ||
          el.getAttribute("data-lazy-src");
        if (src) urls.push(src);
      });
      document.querySelectorAll("a[href]").forEach((el) => {
        const href = el.getAttribute("href") || "";
        if (
          href.includes(".mp4") ||
          href.includes(".m3u8") ||
          href.includes(".mkv")
        ) {
          urls.push(href);
        }
      });

      const scripts = document.querySelectorAll("script");
      scripts.forEach((script) => {
        const text = script.textContent || "";
        const urlMatches = text.match(
          /https?:\/\/[^\s"'<>]+\.(mp4|m3u8|mpd|mkv|webm)[^\s"'<>]*/gi
        );
        if (urlMatches) urls.push(...urlMatches);
      });
      return urls;
    });

    for (const u of pageVideoUrls) {
      try {
        const abs = new URL(u, targetUrl).href;
        if (isVideoUrl(abs) || abs.includes(".m3u8") || abs.includes(".mp4")) {
          foundUrls.set(abs, { url: abs });
        }
      } catch {}
    }

    const iframes = await page.$$("iframe");
    for (const iframe of iframes.slice(0, 3)) {
      try {
        const src = await iframe.evaluate((el) => el.src);
        if (!src || src === "about:blank") continue;

        const frame = await iframe.contentFrame();
        if (!frame) continue;

        const iframeVideoUrls = await frame
          .evaluate(() => {
            const urls: string[] = [];
            document.querySelectorAll("video, source").forEach((el) => {
              const s = el.getAttribute("src") || el.getAttribute("data-src");
              if (s) urls.push(s);
            });
            const scripts = document.querySelectorAll("script");
            scripts.forEach((script) => {
              const text = script.textContent || "";
              const matches = text.match(
                /https?:\/\/[^\s"'<>]+\.(mp4|m3u8|mpd|mkv|webm)[^\s"'<>]*/gi
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

    if (foundUrls.size === 0) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    const results = Array.from(foundUrls.values())
      .map((entry) => ({
        url: entry.url,
        type: detectType(entry.url),
        quality: detectQuality(entry.url),
        score: scoreUrl(entry.url),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return {
      success: results.length > 0,
      urls: results,
      duration: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      urls: [],
      error: err.message || "فشل استخراج الروابط",
      duration: Date.now() - startTime,
    };
  } finally {
    activeSessions--;
    if (page) {
      try {
        await page.close();
      } catch {}
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}
