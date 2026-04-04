import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, CDPSession } from "puppeteer-core";
import type { Server, Socket } from "socket.io";
import * as fs from "fs";
import * as net from "net";
import * as dns from "dns/promises";
import jwt from "jsonwebtoken";
import { isUserDjInRoom } from "./socket";

puppeteerExtra.use(StealthPlugin());

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
];

const IGNORE_PATTERNS = [
  "google", "facebook", "doubleclick", "adservice",
  "analytics", "googletagmanager", "googlesyndication",
  "adsrvr", "amazon-adsystem", "adnxs", "criteo",
  "fonts.googleapis",
  ".css", ".png", ".jpg", ".jpeg",
  ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf",
];

function isIpPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd") || lower === "::";
  }
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  if (net.isIP(hostname)) return isIpPrivate(hostname);
  return false;
}

async function resolvedToPrivate(hostname: string): Promise<boolean> {
  if (isPrivateHostname(hostname)) return true;
  if (net.isIP(hostname)) return isIpPrivate(hostname);
  try {
    const addrs = await dns.resolve4(hostname);
    if (addrs.some(isIpPrivate)) return true;
  } catch {}
  try {
    const addrs6 = await dns.resolve6(hostname);
    if (addrs6.some(isIpPrivate)) return true;
  } catch {}
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
  return VIDEO_CONTENT_TYPES.some((t) => ct.toLowerCase().includes(t));
}

function scoreUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (lower.includes(".m3u8")) score += 10;
  if (lower.includes(".mpd")) score += 8;
  if (lower.includes(".mp4")) score += 6;
  if (lower.includes("1080")) score += 5;
  if (lower.includes("720")) score += 4;
  if (lower.includes("master") || lower.includes("index") || lower.includes("playlist")) score += 3;
  return score;
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
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
];

interface CloudSession {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  roomSlug: string;
  socketId: string;
  userId: number;
  startedAt: number;
  caughtUrls: Map<string, number>;
  timeout: ReturnType<typeof setTimeout>;
}

const activeSessions = new Map<string, CloudSession>();
const MAX_SESSION_MS = 120_000;
const VIEWPORT = { width: 1280, height: 720 };

export function getActiveCloudSession(roomSlug: string): CloudSession | undefined {
  return activeSessions.get(roomSlug);
}

async function destroySession(roomSlug: string, reason: string) {
  const session = activeSessions.get(roomSlug);
  if (!session) return;
  console.log(`[cloud-browser] destroying session room=${roomSlug} reason=${reason}`);
  activeSessions.delete(roomSlug);
  clearTimeout(session.timeout);
  try { await session.cdp.detach(); } catch {}
  try { await session.browser.close(); } catch {}
}

export function abortCloudSession(roomSlug: string): void {
  destroySession(roomSlug, "abort");
}

function getSocketUserId(socket: Socket): number | null {
  try {
    const tok = (socket.handshake.auth as any)?.token || '';
    if (!tok) return null;
    const secret = process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env';
    const decoded = jwt.verify(tok, secret) as any;
    return decoded?.userId ?? null;
  } catch {
    return null;
  }
}

function isAuthorized(socket: Socket, roomSlug: string): boolean {
  const userId = getSocketUserId(socket);
  if (!userId) return false;
  return isUserDjInRoom(roomSlug, userId);
}

export function initCloudBrowser(io: Server): void {
  io.on("connection", (socket: Socket) => {
    socket.on("cloud-browser:start", async (data: { url: string; roomSlug: string }) => {
      const { url, roomSlug } = data;
      if (!url || !roomSlug) return;

      const userId = getSocketUserId(socket);
      if (!userId || !isAuthorized(socket, roomSlug)) {
        socket.emit("cloud-browser:error", { error: "يجب أن تكون DJ أو مسؤول الغرفة" });
        return;
      }

      if (activeSessions.has(roomSlug)) {
        socket.emit("cloud-browser:error", { error: "يوجد جلسة متصفح نشطة بالفعل في هذه الغرفة" });
        return;
      }

      if (activeSessions.size >= 2) {
        socket.emit("cloud-browser:error", { error: "الخادم مشغول — حاول بعد قليل" });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("bad protocol");
      } catch {
        socket.emit("cloud-browser:error", { error: "رابط غير صالح" });
        return;
      }

      if (await resolvedToPrivate(parsedUrl.hostname)) {
        socket.emit("cloud-browser:error", { error: "رابط غير صالح" });
        return;
      }

      console.log(`[cloud-browser] starting session room=${roomSlug} url=${url} userId=${userId}`);
      socket.emit("cloud-browser:status", { status: "launching" });

      let browser: Browser | null = null;
      try {
        const execPath = findChromiumPath();
        browser = await puppeteerExtra.launch({
          executablePath: execPath,
          headless: true,
          args: [
            "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
            "--disable-gpu", "--disable-software-rasterizer",
            "--disable-extensions", "--disable-sync", "--no-first-run",
            "--no-zygote", "--single-process",
            "--disable-blink-features=AutomationControlled",
            `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        }) as unknown as Browser;

        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        await page.setUserAgent(ua);

        const caughtUrls = new Map<string, number>();

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          const rType = req.resourceType();
          if (rType === "image" || rType === "font") { req.abort(); return; }
          const rUrl = req.url();
          try {
            const p = new URL(rUrl);
            if (!["http:", "https:"].includes(p.protocol) || isPrivateHostname(p.hostname)) { req.abort(); return; }
          } catch { req.abort(); return; }

          if (isVideoUrl(rUrl) && !caughtUrls.has(rUrl)) {
            caughtUrls.set(rUrl, scoreUrl(rUrl));
            console.log(`[cloud-browser] CAUGHT [req]: ${rUrl.substring(0, 100)}`);
            socket.emit("cloud-browser:caught", {
              url: rUrl,
              score: scoreUrl(rUrl),
              type: rUrl.includes(".m3u8") ? "m3u8" : rUrl.includes(".mpd") ? "mpd" : "mp4",
              total: caughtUrls.size,
            });
          }
          req.continue();
        });

        page.on("response", (resp) => {
          const rUrl = resp.url();
          const ct = resp.headers()["content-type"] || "";
          if ((isVideoContentType(ct) || isVideoUrl(rUrl)) && !caughtUrls.has(rUrl)) {
            caughtUrls.set(rUrl, scoreUrl(rUrl));
            console.log(`[cloud-browser] CAUGHT [resp]: ${rUrl.substring(0, 100)}`);
            socket.emit("cloud-browser:caught", {
              url: rUrl,
              score: scoreUrl(rUrl),
              type: rUrl.includes(".m3u8") ? "m3u8" : rUrl.includes(".mpd") ? "mpd" : "mp4",
              total: caughtUrls.size,
            });
          }
        });

        const cdp = await page.createCDPSession();

        const sessionTimeout = setTimeout(() => {
          socket.emit("cloud-browser:timeout", { message: "انتهت مدة الجلسة (دقيقتان)" });
          destroySession(roomSlug, "timeout");
        }, MAX_SESSION_MS);

        const session: CloudSession = {
          browser, page, cdp, roomSlug,
          socketId: socket.id,
          userId,
          startedAt: Date.now(),
          caughtUrls,
          timeout: sessionTimeout,
        };
        activeSessions.set(roomSlug, session);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});

        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: 40,
          maxWidth: VIEWPORT.width,
          maxHeight: VIEWPORT.height,
          everyNthFrame: 2,
        });

        cdp.on("Page.screencastFrame", async (event: any) => {
          if (!activeSessions.has(roomSlug)) return;
          socket.emit("cloud-browser:frame", {
            data: event.data,
            width: event.metadata.deviceWidth,
            height: event.metadata.deviceHeight,
          });
          try {
            await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
          } catch {}
        });

        socket.emit("cloud-browser:status", { status: "ready", width: VIEWPORT.width, height: VIEWPORT.height });
        console.log(`[cloud-browser] session ready room=${roomSlug}`);

      } catch (err: any) {
        console.error(`[cloud-browser] launch error: ${err.message}`);
        activeSessions.delete(roomSlug);
        socket.emit("cloud-browser:error", { error: "فشل تشغيل المتصفح" });
        if (browser) try { await browser.close(); } catch {}
        return;
      }
    });

    socket.on("cloud-browser:mouse", async (data: { type: string; x: number; y: number; button?: string }) => {
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      try {
        const { type, x, y } = data;
        if (type === "click") {
          await session.page.mouse.click(x, y);
        } else if (type === "move") {
          await session.page.mouse.move(x, y);
        } else if (type === "down") {
          await session.page.mouse.down();
        } else if (type === "up") {
          await session.page.mouse.up();
        }
      } catch {}
    });

    socket.on("cloud-browser:scroll", async (data: { x: number; y: number; deltaX: number; deltaY: number }) => {
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      try {
        await session.page.mouse.wheel({ deltaX: data.deltaX, deltaY: data.deltaY });
      } catch {}
    });

    socket.on("cloud-browser:keyboard", async (data: { type: string; key: string; text?: string }) => {
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      try {
        if (data.type === "keydown") {
          await session.page.keyboard.down(data.key);
        } else if (data.type === "keyup") {
          await session.page.keyboard.up(data.key);
        } else if (data.type === "type" && data.text) {
          await session.page.keyboard.type(data.text);
        }
      } catch {}
    });

    socket.on("cloud-browser:navigate", async (data: { url: string }) => {
      const session = findSessionBySocket(socket.id);
      if (!session) return;
      try {
        const parsed = new URL(data.url);
        if (!["http:", "https:"].includes(parsed.protocol)) return;
        if (await resolvedToPrivate(parsed.hostname)) return;
        await session.page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      } catch {}
    });

    socket.on("cloud-browser:stop", () => {
      const session = findSessionBySocket(socket.id);
      if (session) {
        destroySession(session.roomSlug, "user-stopped");
        socket.emit("cloud-browser:status", { status: "stopped" });
      }
    });

    socket.on("cloud-browser:use-url", (data: { url: string }) => {
      const session = findSessionBySocket(socket.id);
      if (session) {
        console.log(`[cloud-browser] user selected URL: ${data.url.substring(0, 100)}`);
        destroySession(session.roomSlug, "url-selected");
        socket.emit("cloud-browser:status", { status: "stopped" });
      }
    });

    socket.on("disconnect", () => {
      const session = findSessionBySocket(socket.id);
      if (session) {
        destroySession(session.roomSlug, "socket-disconnect");
      }
    });
  });
}

function findSessionBySocket(socketId: string): CloudSession | undefined {
  for (const [, session] of activeSessions) {
    if (session.socketId === socketId) return session;
  }
  return undefined;
}
