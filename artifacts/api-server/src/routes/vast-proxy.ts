import { Router } from 'express';

const router = Router();

router.get('/proxy/vast', async (req, res) => {
  const url = req.query.url as string;
  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const xml = await resp.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(xml);
  } catch {
    res.status(502).json({ error: 'Failed to fetch VAST' });
  }
});

export default router;
