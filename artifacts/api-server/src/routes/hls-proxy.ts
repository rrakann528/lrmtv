import { Router } from 'express';
import { getVideoHeaders } from '../lib/browser-session';

const router = Router();


const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Origin, Accept',
};

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
};

function candidateReferers(targetUrl: string): string[] {
  const parsed = new URL(targetUrl);
  const candidates: string[] = [
    '',
    `${parsed.protocol}//${parsed.hostname}/`,
  ];
  const domainRe = /([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/gi;
  const pathStr = parsed.pathname + parsed.search;
  let m: RegExpExecArray | null;
  while ((m = domainRe.exec(pathStr)) !== null) {
    const candidate = `https://${m[1]}/`;
    if (!candidates.includes(candidate) && !m[1].startsWith(parsed.hostname)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

async function fetchWithRefererFallback(
  url: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 10000,
): Promise<{ response: Response; referer: string }> {
  const referers = candidateReferers(url);
  let last!: Response;
  for (const referer of referers) {
    const headers: Record<string, string> = { ...BASE_HEADERS, ...extraHeaders };
    if (referer) headers['Referer'] = referer;
    try {
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { response, referer };
      last = response;
    } catch {}
  }
  return { response: last, referer: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/detect?url=<encoded>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/detect', async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
  catch { res.status(400).json({ error: 'Invalid url' }); return; }

  const lower = targetUrl.toLowerCase();

  if (lower.includes('.mpd') || lower.includes('/manifest.mpd') || lower.includes('dash')) {
    res.json({ type: 'dash' }); return;
  }
  if (lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('hls')) {
    res.json({ type: 'hls' }); return;
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mkv') || lower.endsWith('.avi')) {
    res.json({ type: 'mp4' }); return;
  }

  try {
    const { response } = await fetchWithRefererFallback(targetUrl, {}, 6000);
    const ct = (response.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('m3u8')) { res.json({ type: 'hls'  }); return; }
    if (ct.includes('dash') || ct.includes('mpd'))     { res.json({ type: 'dash' }); return; }
    if (ct.includes('mp4') || ct.includes('mpeg4'))    { res.json({ type: 'mp4'  }); return; }
    if (ct.includes('webm'))                           { res.json({ type: 'webm' }); return; }

    const buf = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (buf.length >= 7 && buf.toString('utf8', 0, 7) === '#EXTM3U') { res.json({ type: 'hls' }); return; }
    if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp')   { res.json({ type: 'mp4' }); return; }
    res.json({ type: 'unknown', contentType: ct });
  } catch (err) {
    res.json({ type: 'unknown', error: String(err) });
  }
});

router.options('/proxy/detect', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/check?url=<encoded>
//
// Tests whether the URL is reachable from the SERVER's own IP (not the client's).
// If the stream is IP-locked (token tied to the client IP), the server will get
// a 403/4xx while the client can access it fine — this lets the DJ know other
// viewers won't be able to watch.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/check', async (req, res) => {
  res.set(CORS_HEADERS);
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
  catch { res.status(400).json({ error: 'Invalid url' }); return; }

  try {
    // Deliberately do NOT forward X-Forwarded-For — we want to check accessibility
    // from the server's real IP, not the client's IP.
    const referers = candidateReferers(targetUrl);
    let reachable = false;
    let httpStatus = 0;

    for (const referer of referers) {
      const headers: Record<string, string> = { ...BASE_HEADERS };
      if (referer) headers['Referer'] = referer;
      try {
        const response = await fetch(targetUrl, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        httpStatus = response.status;
        if (response.ok) {
          // Verify the response is actually an HLS manifest, not an HTML error/challenge page
          const ct = (response.headers.get('content-type') ?? '').toLowerCase();
          const isHtmlBlock = ct.includes('text/html') || ct.includes('text/plain');
          if (isHtmlBlock) {
            // Could be a Cloudflare challenge or bot-protection page — treat as unreachable
            const preview = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)))
              .toString('utf8', 0, 20);
            if (!preview.startsWith('#EXTM3U')) { httpStatus = 403; break; }
          }
          reachable = true; break;
        }
      } catch { httpStatus = 0; }
    }

    res.json({ reachable, httpStatus });
  } catch (err) {
    res.json({ reachable: false, httpStatus: 0, error: String(err) });
  }
});

router.options('/proxy/check', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/stream?url=<encoded>&ref=<encoded_referer>
//
// Tunnels HLS streams through the server so IP-locked CDN tokens work.
// Playwright extracts URLs from the server's IP → we serve them back through
// this proxy → client always gets bytes from the same server IP that got the token.
//
// Handles:
//  • Master playlists  (.m3u8 returning variant streams)
//  • Media playlists   (.m3u8 returning segments)
//  • TS / fMP4 segments (plain byte tunnelling)
// ─────────────────────────────────────────────────────────────────────────────

function resolveAbsolute(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try { return new URL(href, base).href; } catch { return href; }
}

function proxyUrl(segUrl: string, referer: string, selfBase: string): string {
  return `${selfBase}?url=${encodeURIComponent(segUrl)}&ref=${encodeURIComponent(referer)}`;
}

function rewriteM3u8(content: string, manifestUrl: string, referer: string, selfBase: string): string {
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA with URI="..." — rewrite the URI value
    if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        const abs = resolveAbsolute(manifestUrl, uri);
        return `URI="${proxyUrl(abs, referer, selfBase)}"`;
      });
    }

    // Non-comment, non-empty lines are segment or sub-playlist URLs
    if (!trimmed.startsWith('#')) {
      const abs = resolveAbsolute(manifestUrl, trimmed);
      return proxyUrl(abs, referer, selfBase);
    }

    return line;
  }).join('\n');
}

router.options('/proxy/stream', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/stream', async (req, res) => {
  res.set(CORS_HEADERS);

  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).send('Missing url'); return; }

  let targetUrl: string;
  try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
  catch { res.status(400).send('Invalid url'); return; }

  // SSRF protection: block private IPs
  const PRIVATE = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];
  try {
    const host = new URL(targetUrl).hostname;
    if (host === 'localhost' || PRIVATE.some(r => r.test(host))) {
      res.status(403).send('Blocked'); return;
    }
  } catch { res.status(400).send('Invalid url'); return; }

  const referer = req.query.ref ? decodeURIComponent(req.query.ref as string) : '';

  // Self-base so rewritten URLs point back to this endpoint.
  // Use root-relative path so HLS.js resolves segments via the frontend origin
  // (which proxies /api/ → API server) — works in both dev and production.
  const selfBase = '/api/proxy/stream';

  try {
    // Look up headers that Playwright captured when it first fetched this URL.
    // These include Cookie, Referer, Origin — critical for IP/token-bound CDN streams.
    const stored = getVideoHeaders(targetUrl);

    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Referer': stored?.referer || referer || (() => { try { const u = new URL(targetUrl); return `${u.protocol}//${u.hostname}/`; } catch { return ''; } })(),
    };

    if (stored?.cookie) headers['Cookie'] = stored.cookie;
    if (stored?.origin) headers['Origin'] = stored.origin;

    // Forward Range header so byte-range seeking works for MP4 files
    const rangeHeader = req.headers['range'];
    if (rangeHeader) headers['Range'] = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;

    const upstream = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).send(`Upstream: ${upstream.status}`);
      return;
    }

    const ct = (upstream.headers.get('content-type') ?? '').toLowerCase();
    const isManifest =
      ct.includes('mpegurl') || ct.includes('x-mpegurl') ||
      targetUrl.toLowerCase().includes('.m3u8');

    if (isManifest) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, targetUrl, referer || targetUrl, selfBase);
      res
        .status(200)
        .set('Content-Type', 'application/vnd.apple.mpegurl')
        .set('Cache-Control', 'no-cache')
        .send(rewritten);
    } else {
      // Segment / binary — stream directly
      const forwardCt = ct || 'video/mp2t';
      res.status(upstream.status).set('Content-Type', forwardCt);

      const cl = upstream.headers.get('content-length');
      if (cl) res.set('Content-Length', cl);

      const cr = upstream.headers.get('content-range');
      if (cr) res.set('Content-Range', cr);

      // Stream body to client
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const stream = new (await import('stream')).Readable({
          async read() {
            try {
              const { done, value } = await reader.read();
              if (done) { this.push(null); }
              else       { this.push(Buffer.from(value)); }
            } catch { this.push(null); }
          },
        });
        stream.pipe(res);
        res.on('close', () => reader.cancel().catch(() => {}));
      } else {
        const buf = await upstream.arrayBuffer();
        res.send(Buffer.from(buf));
      }
    }
  } catch (err: any) {
    if (!res.headersSent) res.status(502).send(`Proxy error: ${err.message}`);
  }
});

export default router;
