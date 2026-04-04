import { Router, type IRouter, type Request, type Response } from "express";
import https from "https";
import http from "http";

const router: IRouter = Router();

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function pickUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function setCorsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");
}

function buildHeaders(targetUrl: string, range?: string): Record<string, string> {
  const parsed = new URL(targetUrl);
  const isWorkersDev = parsed.host.includes(".workers.dev");
  const headers: Record<string, string> = {
    "User-Agent": pickUA(),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (!isWorkersDev) {
    headers["Referer"] = `${parsed.protocol}//${parsed.host}/`;
  }
  if (range) {
    headers["Range"] = range;
  }
  return headers;
}

function resolveAbsoluteUrl(relativeUrl: string, manifestUrl: string): string {
  if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
    return relativeUrl;
  }
  try {
    return new URL(relativeUrl, manifestUrl).href;
  } catch {
    const base = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
    return base + relativeUrl;
  }
}

const PROXY_BASE = "/api/proxy/stream";

function rewriteManifest(body: string, manifestUrl: string): string {
  const lines = body.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (trimmed.startsWith("#EXT-X-MAP:")) {
        result.push(trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
          const abs = resolveAbsoluteUrl(uri, manifestUrl);
          return `URI="${PROXY_BASE}?url=${encodeURIComponent(abs)}"`;
        }));
      } else {
        result.push(line);
      }
      continue;
    }

    const abs = resolveAbsoluteUrl(trimmed, manifestUrl);
    result.push(`${PROXY_BASE}?url=${encodeURIComponent(abs)}`);
  }

  return result.join("\n");
}

function isManifest(url: string, contentType?: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes(".m3u") || lower.includes("playlist")) return true;
  if (contentType && (contentType.includes("mpegurl") || contentType.includes("m3u"))) return true;
  return false;
}

function extractUrl(req: Request): string | null {
  const fullQs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
  const urlMatch = fullQs.match(/^url=(.+)$/);
  if (!urlMatch) return null;
  try {
    return decodeURIComponent(urlMatch[1]);
  } catch {
    return urlMatch[1];
  }
}

router.options("/proxy/stream", (_req: Request, res: Response) => {
  setCorsHeaders(res);
  res.status(204).end();
});

router.get("/proxy/stream", async (req: Request, res: Response): Promise<void> => {
  const targetUrl = extractUrl(req);
  if (!targetUrl) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  const range = req.headers.range as string | undefined;
  const headers = buildHeaders(targetUrl, range);
  const parsed = new URL(targetUrl);
  const mod = parsed.protocol === "https:" ? https : http;

  const doFetch = (url: string, redirects = 0): void => {
    if (redirects > 5) {
      setCorsHeaders(res);
      res.status(502).json({ error: "Too many redirects" });
      return;
    }

    const p = new URL(url);
    const m = p.protocol === "https:" ? https : http;

    const upstreamReq = m.get(url, { headers, timeout: 15_000, rejectUnauthorized: false }, (upstream) => {
      if (upstream.statusCode && upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        doFetch(upstream.headers.location, redirects + 1);
        return;
      }

      setCorsHeaders(res);

      const ct = upstream.headers["content-type"] || "application/octet-stream";
      const isM3u8 = isManifest(url, ct);

      if (isM3u8) {
        const chunks: Buffer[] = [];
        upstream.on("data", (c) => chunks.push(c));
        upstream.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const rewritten = rewriteManifest(body, url);
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.setHeader("Cache-Control", "no-cache, no-store");
          res.status(upstream.statusCode || 200).send(rewritten);
        });
        upstream.on("error", () => {
          if (!res.headersSent) res.status(502).json({ error: "Upstream error" });
        });
      } else {
        res.setHeader("Content-Type", ct);
        if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
        if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);
        if (upstream.headers["accept-ranges"]) res.setHeader("Accept-Ranges", upstream.headers["accept-ranges"]);
        res.setHeader("Cache-Control", "public, max-age=300");
        res.status(upstream.statusCode || 200);

        upstream.pipe(res);
        upstream.on("error", () => { if (!res.destroyed) res.end(); });
        res.on("close", () => { upstream.destroy(); });
      }
    });

    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        setCorsHeaders(res);
        res.status(502).json({ error: "Failed to fetch", detail: err?.message });
      }
    });
    upstreamReq.on("timeout", () => { upstreamReq.destroy(); });
  };

  doFetch(targetUrl);
});

router.options("/proxy/manifest", (_req: Request, res: Response) => {
  setCorsHeaders(res);
  res.status(204).end();
});

router.get("/proxy/manifest", async (req: Request, res: Response): Promise<void> => {
  req.url = req.url.replace("/proxy/manifest", "/proxy/stream");
  req.originalUrl = req.originalUrl.replace("/proxy/manifest", "/proxy/stream");
  router.handle(req, res, () => {
    res.status(404).end();
  });
});

export default router;
