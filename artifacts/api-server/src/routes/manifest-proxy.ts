import { Router, type IRouter, type Request, type Response } from "express";
import https from "https";
import http from "http";

const router: IRouter = Router();

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
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

function rewriteManifest(body: string, manifestUrl: string, proxyBase: string): string {
  const lines = body.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (trimmed.startsWith("#EXT-X-MAP:")) {
        result.push(trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
          const abs = resolveAbsoluteUrl(uri, manifestUrl);
          return `URI="${abs}"`;
        }));
      } else {
        result.push(line);
      }
      continue;
    }

    if (trimmed.endsWith(".m3u8") || trimmed.includes(".m3u8?") || trimmed.includes(".m3u") || trimmed.includes("/playlist")) {
      const abs = resolveAbsoluteUrl(trimmed, manifestUrl);
      result.push(`${proxyBase}?url=${encodeURIComponent(abs)}`);
    } else {
      result.push(resolveAbsoluteUrl(trimmed, manifestUrl));
    }
  }

  return result.join("\n");
}

async function fetchUrl(targetUrl: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const mod = parsed.protocol === "https:" ? https : http;

    const isWorkersDev = parsed.host.includes('.workers.dev');
    const headers: Record<string, string> = {
      "User-Agent": pickUA(),
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (!isWorkersDev) {
      headers["Referer"] = `${parsed.protocol}//${parsed.host}/`;
    }

    const req = mod.get(
      targetUrl,
      { headers, timeout: 10_000, rejectUnauthorized: false },
      (upstream) => {
        if (upstream.statusCode && upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          fetchUrl(upstream.headers.location).then(resolve).catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        upstream.on("data", (c) => chunks.push(c));
        upstream.on("end", () => {
          const respHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(upstream.headers)) {
            if (v) respHeaders[k] = Array.isArray(v) ? v[0] : v;
          }
          resolve({
            status: upstream.statusCode || 500,
            headers: respHeaders,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        upstream.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

router.options("/proxy/manifest", (_req: Request, res: Response) => {
  setCorsHeaders(res);
  res.status(204).end();
});

router.get("/proxy/manifest", async (req: Request, res: Response): Promise<void> => {
  const fullQs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
  const urlMatch = fullQs.match(/^url=(.+)$/);
  const rawEncoded = urlMatch ? urlMatch[1] : null;
  if (!rawEncoded) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawEncoded);
  } catch {
    targetUrl = rawEncoded;
  }

  try {
    const upstream = await fetchUrl(targetUrl);
    setCorsHeaders(res);

    const ct = upstream.headers["content-type"] || "application/vnd.apple.mpegurl";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-cache, no-store");

    const proxyBase = `/api/proxy/manifest`;
    const rewritten = rewriteManifest(upstream.body, targetUrl, proxyBase);
    res.status(upstream.status).send(rewritten);
  } catch (err: any) {
    setCorsHeaders(res);
    res.status(502).json({ error: "Failed to fetch manifest", detail: err?.message });
  }
});

export default router;
