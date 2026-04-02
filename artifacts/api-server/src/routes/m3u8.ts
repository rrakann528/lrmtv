import { Router } from "express";
import { db, storedM3u8Table } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "express-rate-limit";

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads" },
});

const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveUrl(url: string, base: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Convert /domain.tld/path style relative URLs (common in piracy CDNs) to
 * absolute https:// URLs.  All other relative URLs are resolved against baseUrl.
 */
function rewriteM3u8Paths(content: string, baseUrl?: string): string {
  const domainInPathRegex = /^\/([a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)+)(\/.*)?$/;

  return content
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return line;

      const domainMatch = trimmed.match(domainInPathRegex);
      if (domainMatch) {
        const domain = domainMatch[1];
        const rest = domainMatch[2] || "";
        return `https://${domain}${rest}`;
      }

      if (baseUrl) {
        const base = baseUrl.replace(/\/$/, "");
        const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
        return `${base}${path}`;
      }

      return line;
    })
    .join("\n");
}

/**
 * Rewrite every segment/playlist URL in an HLS manifest to go through our
 * server-side proxy (proxyBase + encodeURIComponent(absoluteUrl)).
 * Also rewrites URI="..." attributes in header tags (EXT-X-KEY, EXT-X-MAP, etc).
 */
function proxifyM3u8(content: string, proxyBase: string, manifestUrl: string): string {
  return content
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI="..." inside tag lines
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const abs = resolveUrl(uri, manifestUrl);
          return `URI="${proxyBase}${encodeURIComponent(abs)}"`;
        });
      }

      // Plain URL line (segment or sub-playlist)
      const abs = resolveUrl(trimmed, manifestUrl);
      return `${proxyBase}${encodeURIComponent(abs)}`;
    })
    .join("\n");
}

function getProxyBase(req: import("express").Request): string {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host  = req.get("x-forwarded-host") || req.get("host") || "lrmtv.sbs";
  return `${proto}://${host}/api/hls-proxy?url=`;
}

// ── Upload ─────────────────────────────────────────────────────────────────────

router.post("/m3u8/upload", requireAuth, uploadLimiter,
  async (req, res) => {
    try {
      const { content, baseUrl } = req.body as { content?: string; baseUrl?: string };
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Missing content" });
      }
      if (content.length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 2MB)" });
      }
      if (!content.includes("#EXTM3U")) {
        return res.status(400).json({ error: "Invalid M3U8 file" });
      }

      // Resolve /domain.tld/path style relative URLs to absolute at upload time
      const rewritten = rewriteM3u8Paths(content, baseUrl);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [row] = await db
        .insert(storedM3u8Table)
        .values({ content: rewritten, baseUrl: baseUrl ?? null, expiresAt })
        .returning({ id: storedM3u8Table.id });

      return res.json({ id: row.id });
    } catch (err) {
      console.error("[m3u8/upload]", err);
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// ── Serve stored M3U8 (with proxy URLs injected at serve time) ─────────────────

router.get("/m3u8/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(storedM3u8Table)
      .where(eq(storedM3u8Table.id, id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Not found" });
    if (new Date() > row.expiresAt) {
      await db.delete(storedM3u8Table).where(eq(storedM3u8Table.id, id));
      return res.status(410).json({ error: "Expired" });
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Cache-Control", "no-cache");
    // Serve content directly — browser fetches segments from CDN using
    // the user's own residential IP (cloud IPs are blocked by these CDNs).
    return res.send(row.content);
  } catch (err) {
    console.error("[m3u8/:id]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.options("/m3u8/:id", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.sendStatus(204);
});

// ── Server-side HLS proxy (fetches segments/sub-playlists, adds CORS) ──────────

router.get("/hls-proxy", proxyLimiter, async (req, res) => {
  const rawUrl = req.query.url as string;
  if (!rawUrl) return res.status(400).json({ error: "Missing url" });

  let targetUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Invalid URL protocol" });
    }
    targetUrl = parsed.href;
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":          "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         new URL(targetUrl).origin + "/",
      },
      redirect: "follow",
    });

    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const urlPath = targetUrl.split("?")[0].toLowerCase();
    const isPlaylist = ct.includes("mpegurl") || ct.includes("x-mpegurl") ||
                       urlPath.endsWith(".m3u8") || urlPath.endsWith(".m3u");

    res.setHeader("Access-Control-Allow-Origin",  "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");

    if (isPlaylist) {
      // Rewrite child URLs to also go through our proxy
      const text = await upstream.text();
      const proxyBase = getProxyBase(req);
      const rewritten = proxifyM3u8(text, proxyBase, targetUrl);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    } else {
      // Binary segment — forward as-is
      res.setHeader("Content-Type", ct || "application/octet-stream");
      const cl = upstream.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);
      const cr = upstream.headers.get("content-range");
      if (cr) res.setHeader("Content-Range", cr);
      res.status(upstream.status);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    }
  } catch (err) {
    console.error("[hls-proxy]", err);
    return res.status(502).json({ error: "Proxy error" });
  }
});

router.options("/hls-proxy", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.sendStatus(204);
});

export default router;
