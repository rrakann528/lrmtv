import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const ALLOWED_CONTENT_TYPES = [
  "video/",
  "audio/",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
  "application/octet-stream",
  "binary/octet-stream",
  "text/plain",
  "text/html",
];

const HLS_EXTENSIONS = [".m3u8", ".m3u"];
const BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
};

function isHlsUrl(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  return HLS_EXTENSIONS.some((ext) => path.endsWith(ext));
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
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.startsWith("#EXT-X-MAP:")) {
          return trimmed.replace(
            /URI="([^"]+)"/g,
            (_match, uri) => `URI="${proxyBase}?url=${encodeURIComponent(resolveUrl(originalUrl, uri))}"`
          );
        }
        if (trimmed.startsWith("#EXT-X-KEY:")) {
          return trimmed.replace(
            /URI="([^"]+)"/g,
            (_match, uri) => `URI="${proxyBase}?url=${encodeURIComponent(resolveUrl(originalUrl, uri))}"`
          );
        }
        return line;
      }
      const absoluteUrl = resolveUrl(originalUrl, trimmed);
      return `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}`;
    })
    .join("\n");
}

router.get("/proxy/stream", async (req: Request, res: Response): Promise<void> => {
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
    ...BASE_HEADERS,
    Origin: parsed.origin,
    Referer: parsed.origin + "/",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const upstream = await fetch(targetUrl, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Upstream returned ${upstream.status}`,
      });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");

    if (isHlsUrl(targetUrl) || contentType.includes("mpegurl") || contentType.includes("x-mpegurl")) {
      const body = await upstream.text();
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const proxyBase = `${proto}://${host}/api/proxy/stream`;
      const rewritten = rewriteM3u8(body, targetUrl, proxyBase);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.send(rewritten);
      return;
    }

    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (!upstream.body) {
      res.status(204).end();
      return;
    }

    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    };

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    await pump();
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
});

router.options("/proxy/stream", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.status(204).end();
});

export default router;
