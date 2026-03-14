import { Router } from 'express';

const router = Router();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Origin, Accept',
};

function buildRequestHeaders(req: import('express').Request, _targetUrl: string, _referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
  };
  if (req.headers.range) headers['Range'] = req.headers.range as string;
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/detect?url=<encoded>
//
// Probes a URL to determine the stream/media type:
//   hls | dash | mp4 | webm | unknown
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
    const headers = buildRequestHeaders(req, targetUrl, '');
    const probeRes = await fetch(targetUrl, { method: 'HEAD', headers, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const ct = (probeRes.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('m3u8')) { res.json({ type: 'hls'  }); return; }
    if (ct.includes('dash') || ct.includes('mpd'))     { res.json({ type: 'dash' }); return; }
    if (ct.includes('mp4') || ct.includes('mpeg4'))    { res.json({ type: 'mp4'  }); return; }
    if (ct.includes('webm'))                           { res.json({ type: 'webm' }); return; }

    const getRes = await fetch(targetUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const buf = Buffer.from(await getRes.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (buf.length >= 7 && buf.toString('utf8', 0, 7) === '#EXTM3U') { res.json({ type: 'hls' }); return; }
    if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp')   { res.json({ type: 'mp4' }); return; }
    res.json({ type: 'unknown', contentType: ct });
  } catch (err) {
    res.json({ type: 'unknown', error: String(err) });
  }
});

router.options('/proxy/detect', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

export default router;
