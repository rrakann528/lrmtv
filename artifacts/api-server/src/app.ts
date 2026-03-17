import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { db, bannedIpsTable } from "@workspace/db";
import {
  botDetection,
  generalLimiter,
  authLimiter,
  oauthLimiter,
  payloadGuard,
  pathGuard,
  securityHeaders,
} from "./middlewares/security";
import { getCachedSetting, refreshSettingsCache } from "./lib/socket";

// ── Cache banned IPs in memory (refresh every 30s) ───────────────────────────
let _bannedIps = new Set<string>();

async function refreshBannedIps() {
  try {
    const ips = await db.select({ ip: bannedIpsTable.ip }).from(bannedIpsTable);
    _bannedIps = new Set(ips.map(r => r.ip));
  } catch { /* DB not ready yet */ }
}
refreshBannedIps();
setInterval(refreshBannedIps, 30_000);

export function isRegistrationEnabled() { return true; }

// ── IP ban middleware ─────────────────────────────────────────────────────────
function ipBanMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "";
  if (_bannedIps.has(ip)) { res.status(403).json({ error: "محظور" }); return; }
  next();
}

// ── Maintenance mode middleware ────────────────────────────────────────────────
// NOTE: mounted on /api — so req.path is relative, e.g. /auth/google not /api/auth/google
function maintenanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (getCachedSetting("maintenance_mode") !== "true") { next(); return; }
  if (req.path.startsWith("/admin") || req.path.startsWith("/auth")) {
    next(); return;
  }
  res.status(503).json({ error: "الموقع في وضع الصيانة. يرجى المحاولة لاحقاً." });
}

// Expose for admin routes to call after ban-ip changes
export function refreshIpCache() { refreshBannedIps(); }
export function refreshAllCaches() { refreshBannedIps(); refreshSettingsCache(); }

const app: Express = express();

// ── Healthcheck — FIRST, before all middleware ─────────────────────────────────
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ── Trust proxy (Replit / Cloudflare / Railway) ────────────────────────────────
app.set("trust proxy", 1);

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));
app.use(securityHeaders);

// ── CORS ───────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null,
  "http://localhost:22333",
  "http://localhost:5173",
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      cb(null, true);
    } else {
      cb(null, true);
    }
  },
  credentials: true,
}));

// ── Global guards ──────────────────────────────────────────────────────────────
app.use(pathGuard);
app.use(payloadGuard);
app.use(botDetection);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

// ── Security: banned IPs + maintenance mode ────────────────────────────────────
app.use("/api", ipBanMiddleware);
app.use("/api", maintenanceMiddleware);

// ── Rate limiting ──────────────────────────────────────────────────────────────
app.use("/api", generalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/google", oauthLimiter);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Serve frontend static files in production ──────────────────────────────────
const frontendDist = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(process.cwd(), "artifacts/web/dist/public");
if (process.env.NODE_ENV === "production" && existsSync(frontendDist)) {
  // Hashed assets (JS/CSS with content hash in filename) → long-lived cache
  app.use(
    "/assets",
    express.static(path.join(frontendDist, "assets"), {
      maxAge: "7d",
      immutable: true,
      etag: true,
    })
  );
  // Everything else (sw.js, manifest.json, icons…) → no cache
  app.use(
    express.static(frontendDist, {
      maxAge: 0,
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );
  // SPA fallback — always return a fresh index.html
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.use((_req, res) => {
    res.status(404).json({ error: "المسار غير موجود" });
  });
}

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[Error]", err?.message || err);
  res.status(err?.status || 500).json({ error: "خطأ داخلي في الخادم" });
});

export default app;
