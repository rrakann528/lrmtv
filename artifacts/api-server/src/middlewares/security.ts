import { rateLimit } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

// ── Suspicious User-Agent Patterns (bots / scanners) ──────────────────────────
const BOT_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i,
  /python-requests/i, /go-http-client/i, /libwww-perl/i,
  /curl\/[0-6]/i, /wget/i, /scrapy/i, /httpclient/i,
  /dirbuster/i, /gobuster/i, /wfuzz/i, /hydra/i,
  /burpsuite/i, /acunetix/i, /nessus/i,
];

const SUSPICIOUS_HEADERS = [
  "x-scan-memo", "x-forwarded-host", "x-originating-ip",
  "x-remote-ip", "x-remote-addr",
];

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

  next();
}

// ── General API Rate Limit (per IP) ───────────────────────────────────────────
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات كثيرة جداً، انتظر قليلاً" },
  skip: (req) => req.path.startsWith("/auth/me"),
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
  next();
}
