import { Router, type IRouter, type Request, type Response } from "express";
import https from "https";

const router: IRouter = Router();

const HLS_EXTENSIONS = [".m3u8", ".m3u"];
const DASH_EXTENSIONS = [".mpd"];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];

function pickUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const unsafeAgent = new https.Agent({ rejectUnauthorized: false });

function isHlsUrl(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  return HLS_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isDashUrl(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  return DASH_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isHlsContent(ct: string): boolean {
  return ct.includes("mpegurl") || ct.includes("x-mpegurl");
}

function isDashContent(ct: string): boolean {
  return ct.includes("dash+xml") || ct.includes("dash.xml");
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith("http://") || relative.startsWith("https://")) {
    return relative;
  }
  try {
    return new URL(relative, base).href;
  } catch {
    const baseParts = base.split("/");
    baseParts.pop();
    return baseParts.join("/") + "/" + relative;
  }
}

function rewriteM3u8(body: string, originalUrl: string, proxyBase: string): string {
  const lines = body.split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return trimmed.replace(
          /URI="([^"]+)"/g,
          (_match, uri) => {
            const abs = resolveUrl(originalUrl, uri);
            return `URI="${proxyBase}?url=${encodeURIComponent(abs)}"`;
          }
        );
      }

      const absoluteUrl = resolveUrl(originalUrl, trimmed);
      return `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}&seg=1`;
    })
    .join("\n");
}

function rewriteDashMpd(body: string, originalUrl: string, proxyBase: string): string {
  return body.replace(
    /(BaseURL|media|initialization|sourceURL)="([^"]+)"/g,
    (_match, attr, uri) => {
      if (uri.startsWith("data:")) return _match;
      const abs = resolveUrl(originalUrl, uri);
      return `${attr}="${proxyBase}?url=${encodeURIComponent(abs)}"`;
    }
  );
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 2,
  timeoutMs = 30_000
): Promise<globalThis.Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        headers: { ...headers, "User-Agent": pickUA() },
        signal: controller.signal,
        redirect: "follow",
        // @ts-ignore — Node.js fetch supports agent for HTTPS
        ...(url.startsWith("https") ? { dispatcher: undefined } : {}),
      });

      clearTimeout(timer);
      return resp;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError!;
}

function buildProxyBase(_req: Request): string {
  return `/api/proxy/stream`;
}

// ── Segment cache ─────────────────────────────────────────────────────────────
// When two users watch the same proxied stream at similar positions, they request
// the same segment URLs within seconds of each other.  Without a cache, the proxy
// fetches the same bytes from the upstream twice, doubling bandwidth and CPU.
//
// Strategy:
//   1. In-flight deduplication: if a fetch is already running for a URL, the
//      second requester waits for the same Promise and receives the cached result.
//   2. Short-lived result cache (TTL = SEGMENT_CACHE_TTL_MS): completed segment
//      buffers are kept briefly so a third or fourth viewer arriving slightly later
//      can still be served without a new upstream fetch.
//   3. Only small segments (≤ SEGMENT_CACHE_MAX_BYTES) are cached to bound memory.
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENT_CACHE_TTL_MS    = 25_000; // keep 25 s after first fetch completes
const SEGMENT_CACHE_MAX_BYTES = 3 * 1024 * 1024; // skip caching segments > 3 MB
const SEGMENT_CACHE_MAX_ITEMS = 40;     // hard cap on cached entries

interface SegmentCacheEntry {
  buf:         Buffer;
  contentType: string;
  status:      number;
  headers:     Record<string, string>;
  expiresAt:   number;
}

/** Completed segment cache (URL → entry) */
const segmentCache = new Map<string, SegmentCacheEntry>();

/** In-flight fetches (URL → Promise<entry | null>) — null means the fetch failed */
const segmentInflight = new Map<string, Promise<SegmentCacheEntry | null>>();

/** Evict expired / excess entries so memory stays bounded. */
function evictSegmentCache() {
  const now = Date.now();
  for (const [k, v] of segmentCache) {
    if (v.expiresAt < now) segmentCache.delete(k);
  }
  if (segmentCache.size > SEGMENT_CACHE_MAX_ITEMS) {
    const oldest = [...segmentCache.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, segmentCache.size - SEGMENT_CACHE_MAX_ITEMS);
    oldest.forEach(([k]) => segmentCache.delete(k));
  }
}

/**
 * Fetch a segment, deduplicating concurrent requests for the same URL.
 * Returns a cache entry or null on failure.
 */
async function fetchSegmentCached(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<SegmentCacheEntry | null> {
  evictSegmentCache();

  const cached = segmentCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const inflight = segmentInflight.get(url);
  if (inflight) return inflight;

  const promise = (async (): Promise<SegmentCacheEntry | null> => {
    try {
      // 0 retries for segments — fail fast
      const upstream = await fetchWithRetry(url, headers, 0, timeoutMs);
      if (!upstream.ok) return null;

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength > SEGMENT_CACHE_MAX_BYTES) {
        // Too large to cache; return a synthetic entry without storing
        segmentInflight.delete(url);
        return {
          buf,
          contentType: upstream.headers.get("content-type") || "video/mp2t",
          status:      upstream.status,
          headers:     {},
          expiresAt:   0, // not stored in cache
        };
      }

      const fwdHeaders: Record<string, string> = {};
      for (const h of ["content-range", "accept-ranges", "etag", "last-modified"]) {
        const v = upstream.headers.get(h);
        if (v) fwdHeaders[h] = v;
      }

      const entry: SegmentCacheEntry = {
        buf,
        contentType: upstream.headers.get("content-type") || "video/mp2t",
        status:      upstream.status,
        headers:     fwdHeaders,
        expiresAt:   Date.now() + SEGMENT_CACHE_TTL_MS,
      };

      segmentCache.set(url, entry);
      return entry;
    } catch {
      return null;
    } finally {
      segmentInflight.delete(url);
    }
  })();

  segmentInflight.set(url, promise);
  return promise;
}

function setCorsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Accept, Accept-Encoding"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Content-Type, Accept-Ranges"
  );
}

router.get(
  "/proxy/stream",
  async (req: Request, res: Response): Promise<void> => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }
    // Segments should fail fast: short timeout, no retries.
    // Manifests get more time and retries since they're small but critical.
    const isSegment = req.query.seg === "1";
    const proxyTimeout  = isSegment ? 12_000 : 20_000;
    const proxyRetries  = isSegment ? 0 : 2;

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      res.status(400).json({ error: "Only HTTP/HTTPS allowed" });
      return;
    }

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      "Accept-Encoding": "identity",
      Connection: "keep-alive",
      Origin: parsed.origin,
      Referer: parsed.origin + "/",
      "Sec-Fetch-Dest": "video",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
    };

    const clientRange = req.headers.range;
    if (clientRange) {
      headers["Range"] = clientRange;
    }

    // ── Segment path: use shared cache + request deduplication ───────────────
    // When multiple viewers watch the same stream at the same position, their
    // HLS clients request identical segment URLs within seconds of each other.
    // fetchSegmentCached() coalesces concurrent in-flight requests and keeps
    // the result in a short-lived buffer so subsequent viewers are served
    // immediately without a second upstream fetch.
    if (isSegment && !clientRange) {
      setCorsHeaders(res);
      try {
        const entry = await fetchSegmentCached(targetUrl, headers, proxyTimeout);
        if (!entry) {
          // Try once more without Referer/Origin (some CDNs reject them)
          const entryNoRef = await fetchSegmentCached(
            targetUrl,
            { ...headers, Referer: "", Origin: "" },
            proxyTimeout
          );
          if (!entryNoRef) {
            res.status(502).json({ error: "Upstream segment fetch failed" });
            return;
          }
          res.status(entryNoRef.status);
          res.setHeader("Content-Type", entryNoRef.contentType);
          res.setHeader("Content-Length", String(entryNoRef.buf.byteLength));
          Object.entries(entryNoRef.headers).forEach(([k, v]) => res.setHeader(k, v));
          res.end(entryNoRef.buf);
          return;
        }
        res.status(entry.status);
        res.setHeader("Content-Type", entry.contentType);
        res.setHeader("Content-Length", String(entry.buf.byteLength));
        Object.entries(entry.headers).forEach(([k, v]) => res.setHeader(k, v));
        res.end(entry.buf);
      } catch (err: any) {
        if (!res.headersSent) res.status(502).json({ error: "Segment proxy error" });
      }
      return;
    }

    // ── Manifest / subtitle / other non-segment path ──────────────────────────
    try {
      const upstream = await fetchWithRetry(targetUrl, headers, proxyRetries, proxyTimeout);

      setCorsHeaders(res);

      if (upstream.status === 206) {
        res.status(206);
      } else if (!upstream.ok) {
        const tryNoReferer = await fetchWithRetry(targetUrl, {
          ...headers,
          Referer: "",
          Origin: "",
        }, proxyRetries, proxyTimeout);
        if (!tryNoReferer.ok) {
          res
            .status(tryNoReferer.status)
            .json({ error: `Upstream returned ${tryNoReferer.status}` });
          return;
        }
        return handleUpstreamResponse(
          tryNoReferer,
          targetUrl,
          req,
          res
        );
      }

      return handleUpstreamResponse(upstream, targetUrl, req, res);
    } catch (err: any) {
      if (err.name === "AbortError") {
        res.status(504).json({ error: "Upstream timeout" });
        return;
      }
      console.error("[stream-proxy] Error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: "Proxy error: " + err.message });
      }
    }
  }
);

async function handleUpstreamResponse(
  upstream: globalThis.Response,
  targetUrl: string,
  req: Request,
  res: Response
): Promise<void> {
  const contentType = upstream.headers.get("content-type") || "";
  const contentLength = upstream.headers.get("content-length");

  if (
    isHlsUrl(targetUrl) ||
    isHlsContent(contentType)
  ) {
    const body = await upstream.text();
    const proxyBase = buildProxyBase(req);
    const rewritten = rewriteM3u8(body, targetUrl, proxyBase);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(rewritten);
    return;
  }

  if (isDashUrl(targetUrl) || isDashContent(contentType)) {
    const body = await upstream.text();
    const proxyBase = buildProxyBase(req);
    const rewritten = rewriteDashMpd(body, targetUrl, proxyBase);

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(rewritten);
    return;
  }

  const isSegment = req.query.seg === "1";
  const isVideoContent = contentType.startsWith("video/") || contentType.startsWith("audio/");
  if (isSegment && !isVideoContent) {
    res.setHeader("Content-Type", "video/mp2t");
  } else if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
  if (contentLength) res.setHeader("Content-Length", contentLength);

  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) res.setHeader("Content-Range", contentRange);

  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) res.setHeader("Set-Cookie", setCookie);

  res.setHeader("Cache-Control", isSegment ? "public, max-age=3600" : "public, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!upstream.body) {
    res.status(204).end();
    return;
  }

  const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();

  req.on("close", () => {
    reader.cancel().catch(() => {});
  });

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    } catch (err: any) {
      if (!res.destroyed) res.end();
    }
  };

  await pump();
}

router.options("/proxy/stream", (_req: Request, res: Response) => {
  setCorsHeaders(res);
  res.status(204).end();
});

export default router;
