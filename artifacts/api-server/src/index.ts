import { createServer } from "http";
import * as Sentry from "@sentry/node";
import app from "./app";
import { initSocketServer } from "./lib/socket";
import { runMigrations } from "@workspace/db";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
  });
}

// ── Startup env checks ─────────────────────────────────────────────────────────
const port = Number(process.env["PORT"]) || 8080;
if (Number.isNaN(port) || port <= 0) {
  console.error(`[server] Invalid PORT value, defaulting to 8080`);
}
console.log(`[env] DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
console.log(`[env] JWT_SECRET set: ${!!process.env.JWT_SECRET}`);
console.log(`[env] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
if (!process.env.JWT_SECRET) {
  console.warn('[env] ⚠️  JWT_SECRET not set — using fallback secret. Set JWT_SECRET in Railway Variables for production security.');
}

const httpServer = createServer(app);
initSocketServer(httpServer);

runMigrations().then(() => {
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
