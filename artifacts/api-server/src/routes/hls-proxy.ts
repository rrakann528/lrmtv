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

export default router;
