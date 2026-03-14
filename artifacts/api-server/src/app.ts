import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import {
  botDetection,
  generalLimiter,
  authLimiter,
  oauthLimiter,
  payloadGuard,
  pathGuard,
  securityHeaders,
} from "./middlewares/security";

const app: Express = express();

// ── Trust proxy (Replit / Cloudflare) ─────────────────────────────────────────
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
  app.use(express.static(frontendDist, { maxAge: "7d", etag: true }));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  // ── 404 handler (dev) ────────────────────────────────────────────────────────
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
