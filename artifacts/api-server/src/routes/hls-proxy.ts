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
    const response = await fetch(targetUrl, {
      headers: BASE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
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

export default router;
