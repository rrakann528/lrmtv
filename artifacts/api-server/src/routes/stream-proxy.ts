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

function buildProxyBase(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/proxy/stream`;
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

    try {
      const upstream = await fetchWithRetry(targetUrl, headers);

      setCorsHeaders(res);

      if (upstream.status === 206) {
        res.status(206);
      } else if (!upstream.ok) {
        const tryNoReferer = await fetchWithRetry(targetUrl, {
          ...headers,
          Referer: "",
          Origin: "",
        });
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
