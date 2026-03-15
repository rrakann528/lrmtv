import { Router } from 'express';

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

/**
 * Extract candidate Referer values to try for a given URL.
 * Priority:
 *   1. No referer (many open CDNs need none)
 *   2. Stream host itself  (e.g. https://cdn.example.com/)
 *   3. Any domain embedded in the URL path (e.g. faselhdx.top found in path)
 */
function candidateReferers(targetUrl: string): string[] {
  const parsed = new URL(targetUrl);
  const candidates: string[] = [
    '',                                          // 1. no Referer
    `${parsed.protocol}//${parsed.hostname}/`,   // 2. CDN host
  ];

  // 3. Domains found inside the URL path/query
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

/**
 * Fetch a URL trying multiple Referer values until one succeeds (status 2xx).
 * Returns { response, referer } of the first successful attempt, or the last
 * failed response if nothing worked.
 */
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
    } catch {
      // network error on this attempt — try next referer
    }
  }

  return { response: last, referer: '' };
}

/**
 * Rewrite every non-comment line of an M3U8 manifest so that:
 *  - relative URIs become absolute (resolved against baseDir)
 *  - all URIs are tunnelled through /api/proxy/segment
 *  - the working referer is forwarded so segments use the same auth
 */
function rewriteManifest(text: string, baseDir: string, referer: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const absolute = trimmed.startsWith('http')
      ? trimmed
      : new URL(trimmed, baseDir).href;

    let seg = `/api/proxy/segment?url=${encodeURIComponent(absolute)}`;
    if (referer) seg += `&referer=${encodeURIComponent(referer)}`;
    return seg;
  }).join('\n');
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
// GET /api/proxy/manifest?url=<encoded>
//
// Fetches an HLS manifest server-side (bypasses mixed-content & CORS).
// Automatically tries several Referer headers so Referer-protected CDNs
// are handled without any extra configuration.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/manifest', async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).send('Missing url'); return; }

  let targetUrl: string;
  try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
  catch { res.status(400).send('Invalid url'); return; }

  try {
    const { response, referer } = await fetchWithRefererFallback(targetUrl, {}, 10000);

    if (!response.ok) {
      res.status(response.status).send('Upstream error');
      return;
    }

    const text = await response.text();
    const baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const rewritten = rewriteManifest(text, baseDir, referer);

    res.set({
      ...CORS_HEADERS,
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store',
    }).send(rewritten);
  } catch {
    res.status(502).send('Manifest proxy error');
  }
});

router.options('/proxy/manifest', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/segment?url=<encoded>[&referer=<encoded>]
//
// Streams a single TS segment (or sub-playlist).
// The optional `referer` param is forwarded so the CDN sees the same auth
// header that was used when fetching the manifest.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/segment', async (req, res) => {
  const rawUrl     = req.query.url     as string | undefined;
  const rawReferer = req.query.referer as string | undefined;
  if (!rawUrl) { res.status(400).send('Missing url'); return; }

  let targetUrl: string;
  try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
  catch { res.status(400).send('Invalid url'); return; }

  const knownReferer = rawReferer ? decodeURIComponent(rawReferer) : '';
  const isPlaylist   = targetUrl.toLowerCase().includes('.m3u8');

  try {
    let upstreamRes: Response;
    let usedReferer = knownReferer;

    if (knownReferer) {
      // Use the same referer that worked for the manifest
      const headers: Record<string, string> = { ...BASE_HEADERS };
      if (knownReferer) headers['Referer'] = knownReferer;
      if (req.headers.range) headers['Range'] = req.headers.range as string;
      upstreamRes = await fetch(targetUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    } else {
      // No known referer — try fallback chain
      const extra: Record<string, string> = {};
      if (req.headers.range) extra['Range'] = req.headers.range as string;
      const result = await fetchWithRefererFallback(targetUrl, extra, 20000);
      upstreamRes  = result.response;
      usedReferer  = result.referer;
    }

    if (!upstreamRes.ok) { res.status(upstreamRes.status).send('Upstream error'); return; }

    if (isPlaylist) {
      const text    = await upstreamRes.text();
      const baseDir = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const rewritten = rewriteManifest(text, baseDir, usedReferer);
      res.set({ ...CORS_HEADERS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }).send(rewritten);
      return;
    }

    const contentType = upstreamRes.headers.get('content-type') ?? 'video/mp2t';
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.set({
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'max-age=30',
    }).send(buf);
  } catch {
    res.status(502).send('Segment proxy error');
  }
});

router.options('/proxy/segment', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

export default router;
