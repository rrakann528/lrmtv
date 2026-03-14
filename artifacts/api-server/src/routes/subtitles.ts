import { Router } from 'express';

const router = Router();

const API_KEY    = process.env.OPENSUBTITLES_API_KEY ?? '';
const API_BASE   = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'LrmTV v1.0';

function apiHeaders() {
  return {
    'Api-Key': API_KEY,
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/subtitles/search?q=...&season=...&episode=...&lang=ar,en
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subtitles/search', async (req, res) => {
  if (!API_KEY) {
    res.status(503).json({ error: 'OPENSUBTITLES_API_KEY not configured' });
    return;
  }

  const q = (req.query.q as string | undefined)?.trim();
  if (!q) { res.status(400).json({ error: 'Missing q param' }); return; }

  const season  = req.query.season  as string | undefined;
  const episode = req.query.episode as string | undefined;
  // Accept both 3-letter (ara) and 2-letter (ar) codes; API v1 uses 2-letter
  const langParam = (req.query.lang as string | undefined) ?? 'ar,en';
  const languages = langParam
    .split(',')
    .map(l => l.trim())
    .map(l => (l.length === 3 ? ISO639_3to2[l] ?? l : l))
    .filter(Boolean)
    .join(',');

  const params = new URLSearchParams({ query: q, languages });
  if (season  && season  !== '0') params.set('season_number', season);
  if (episode && episode !== '0') params.set('episode_number', episode);
  params.set('order_by', 'download_count');
  params.set('order_direction', 'desc');

  try {
    const r = await fetch(`${API_BASE}/subtitles?${params}`, {
      headers: apiHeaders(),
      redirect: 'follow',
    });
    if (!r.ok) {
      const body = await r.text();
      res.status(r.status).json({ error: body || `Upstream ${r.status}` });
      return;
    }
    const json = await r.json() as { data?: unknown[]; total_count?: number };
    const items = (json.data ?? []).map((item: unknown) => {
      const it = item as Record<string, unknown>;
      const attrs = it.attributes as Record<string, unknown>;
      const fd = attrs.feature_details as Record<string, unknown> | undefined;
      const files = attrs.files as Array<Record<string, unknown>> | undefined;
      return {
        subtitle_id: it.id,
        file_id:     files?.[0]?.file_id,
        file_name:   files?.[0]?.file_name ?? '',
        language:    attrs.language,
        download_count: attrs.download_count,
        ratings:        attrs.ratings,
        movie_name:  fd?.movie_name ?? attrs.movie_name ?? '',
        episode_title: fd?.title ?? '',
        season:      fd?.season_number,
        episode:     fd?.episode_number,
        feature_type: fd?.feature_type ?? 'Movie',
      };
    });
    res.json(items);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subtitles/download  { file_id: number }
// Returns a one-time download link from the API
// ─────────────────────────────────────────────────────────────────────────────
router.post('/subtitles/download', async (req, res) => {
  if (!API_KEY) {
    res.status(503).json({ error: 'OPENSUBTITLES_API_KEY not configured' });
    return;
  }

  const { file_id } = req.body as { file_id?: number };
  if (!file_id) { res.status(400).json({ error: 'Missing file_id' }); return; }

  try {
    const r = await fetch(`${API_BASE}/download`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ file_id }),
      redirect: 'follow',
    });
    const json = await r.json() as { link?: string; remaining?: number; error?: string };
    if (!r.ok || !json.link) {
      res.status(r.status).json({ error: json.error ?? 'Download request failed' });
      return;
    }
    res.json({ link: json.link, remaining: json.remaining });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/subtitle?url=...
// Fetches the subtitle file and returns plain UTF-8 text
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/subtitle', async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid url' }); return;
  }

  try {
    const r = await fetch(targetUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!r.ok) { res.status(r.status).json({ error: 'Upstream error' }); return; }

    const text = await r.text();
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    }).send(text);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ISO 639-3 → ISO 639-1 (the ones users typically pick)
const ISO639_3to2: Record<string, string> = {
  ara: 'ar', eng: 'en', fre: 'fr', spa: 'es',
  ger: 'de', tur: 'tr', ita: 'it', por: 'pt',
};

export default router;
