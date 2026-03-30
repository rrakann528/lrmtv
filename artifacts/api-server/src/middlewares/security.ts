import { rateLimit } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

// ── Suspicious User-Agent Patterns (bots / scanners) ──────────────────────────
const BOT_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i,
  /python-requests/i, /python-urllib/i,
  /go-http-client/i, /java\//i,
  /libwww-perl/i, /lwp-/i,
  /curl\//i,                    // block all curl versions
  /wget\//i, /wget$/i,
  /scrapy/i, /httpclient/i,
  /dirbuster/i, /gobuster/i, /ffuf/i, /feroxbuster/i,
  /wfuzz/i, /hydra/i, /medusa/i,
  /burpsuite/i, /burp\s/i,
  /acunetix/i, /nessus/i, /openvas/i, /qualys/i,
  /arachni/i, /havij/i, /w3af/i,
  /metasploit/i, /nuclei/i, /zaproxy/i,
  /zgrab/i, /zmap/i,
  /headlesschrome/i, /phantomjs/i,
];

const SUSPICIOUS_HEADERS = [
  "x-scan-memo",
  "x-originating-ip",
  "x-remote-ip",
  "x-remote-addr",
  "x-forwarded-host",  // often injected by SSRF tools
  "x-custom-ip-authorization",
];

// Paths that look like common scan probes
const SCAN_PATH_PATTERNS = [
  /\.php$/i,
  /\.asp(x?)$/i,
  /\.env/i,
  /\.git\//,
  /wp-admin/i,
  /wp-login/i,
  /phpmy(admin)?/i,
  /adminer/i,
  /shell\./i,
  /eval-stdin/i,
  /config\.xml/i,
  /\.well-known\/security\.txt/i,  // allow this one
];

const ALLOWED_SCAN_PATHS = new Set(["/.well-known/security.txt"]);

// ── Bot / Scanner Detection ────────────────────────────────────────────────────
export function botDetection(req: Request, res: Response, next: NextFunction) {
  if (req.path.endsWith("/healthz")) {
    return next();
  }

  const ua = req.get("user-agent") || "";

  if (!ua || ua.length < 5) {
    res.status(400).json({ error: "طلب غير صالح" });
    return;
  }

  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(ua)) {
      res.status(403).json({ error: "ممنوع" });
      return;
    }
  }

  for (const header of SUSPICIOUS_HEADERS) {
    if (req.headers[header]) {
      res.status(403).json({ error: "ممنوع" });
      return;
    }
  }

  // Block common scanner probes (files that don't exist on this server)
  const urlPath = req.path.toLowerCase();
  if (!ALLOWED_SCAN_PATHS.has(urlPath)) {
    for (const pattern of SCAN_PATH_PATTERNS) {
      if (pattern.test(urlPath)) {
        res.status(404).json({ error: "غير موجود" });
        return;
      }
    }
  }

  next();
}

// ── General API Rate Limit (per IP) ───────────────────────────────────────────
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات كثيرة جداً، انتظر قليلاً" },
  skip: (req) =>
    req.path.startsWith("/auth/me") ||
    req.path.startsWith("/proxy/"),
});

export const extractLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات استخراج كثيرة جداً، انتظر دقيقة" },
});

// ── Strict Auth Rate Limit (login / register) ─────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً، انتظر 15 دقيقة" },
  skipSuccessfulRequests: true,
});

// ── OAuth Rate Limit ───────────────────────────────────────────────────────────
export const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات OAuth كثيرة جداً" },
});

// ── Payload Size Guard ─────────────────────────────────────────────────────────
export function payloadGuard(req: Request, res: Response, next: NextFunction) {
  if (req.path.includes("/avatar-upload")) {
    next();
    return;
  }
  const contentLength = parseInt(req.get("content-length") || "0", 10);
  if (contentLength > 1_000_000) {
    res.status(413).json({ error: "حجم الطلب كبير جداً" });
    return;
  }
  next();
}

// ── Path Traversal Guard ───────────────────────────────────────────────────────
export function pathGuard(req: Request, res: Response, next: NextFunction) {
  const url = req.originalUrl;
  if (
    url.includes("../") ||
    url.includes("..\\") ||
    url.includes("%2e%2e") ||
    url.includes("%252e") ||
    url.includes("%00") ||       // null byte injection
    url.includes("0x2e0x2e") ||  // hex encoding
    /[<>'"`;]/.test(url)
  ) {
    res.status(400).json({ error: "طلب غير صالح" });
    return;
  }
  next();
}

// ── Security Response Headers (lightweight Helmet alternative) ─────────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  next();
}

// ── Per-socket sliding-window throttle ────────────────────────────────────────
// Used inside Socket.IO event handlers to prevent flooding.
export function makeSocketThrottle(max: number, windowMs: number) {
  const windows = new Map<string, number[]>();

  function allow(socketId: string): boolean {
    const now = Date.now();
    const hits = (windows.get(socketId) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    windows.set(socketId, hits);
    return true;
  }

  function cleanup(socketId: string): void {
    windows.delete(socketId);
  }

  return { allow, cleanup };
}
