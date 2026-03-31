import { Router } from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OS = require('opensubtitles-api');

const router = Router();

const USER_AGENT = 'LrmTV v1.0';

// Single instance — handles anonymous login internally
const OpenSubtitles = new OS({ useragent: USER_AGENT });

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/subtitles/search?q=...&season=...&episode=...&lang=ar,en
// Uses opensubtitles-api (open-source, no API key required)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subtitles/search', async (req, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) { res.status(400).json({ error: 'Missing q param' }); return; }

  const season  = req.query.season  as string | undefined;
  const episode = req.query.episode as string | undefined;
  const langParam = (req.query.lang as string | undefined) ?? 'ar,en';

  // Map 2-letter codes to 3-letter codes used by the XML-RPC API
  const langMap: Record<string, string> = {
    ar: 'ara', en: 'eng', fr: 'fre', es: 'spa',
    tr: 'tur', de: 'ger', it: 'ita', pt: 'por',
    zh: 'chi', ru: 'rus', ja: 'jpn', ko: 'kor',
  };
  const sublanguageid = langParam
    .split(',')
    .map(l => l.trim())
    .map(l => langMap[l] ?? l)
    .join(',');

  const searchParams: Record<string, string | number> = {
    sublanguageid,
    query: q,
    limit: '20',
  };
  if (season  && season  !== '0') searchParams.season  = parseInt(season,  10);
  if (episode && episode !== '0') searchParams.episode = parseInt(episode, 10);

  try {
    // Returns object keyed by language name, each value is array of subtitle objects
    const raw = await OpenSubtitles.search(searchParams) as Record<string, SubtitleEntry[]>;

    const items: FormattedSubtitle[] = [];
    for (const [_lang, entries] of Object.entries(raw)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        items.push({
          subtitle_id:    entry.id ?? '',
          file_id:        entry.id ?? '',
          file_name:      entry.filename ?? '',
          language:       entry.langcode ?? _lang,
          download_count: entry.downloads ?? 0,
          ratings:        entry.score ?? 0,
          movie_name:     entry.title ?? q,
          episode_title:  entry.episodeTitle ?? '',
          season:         entry.season  ? Number(entry.season)  : undefined,
          episode:        entry.episode ? Number(entry.episode) : undefined,
          feature_type:   entry.season ? 'Episode' : 'Movie',
          url:            entry.url ?? '',
        });
      }
    }

    // Sort by downloads desc
    items.sort((a, b) => b.download_count - a.download_count);
    res.json(items);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subtitles/download  { url: string }
// Kept for compatibility — the open-source approach returns a direct URL
// so the frontend can proxy it directly via /api/proxy/subtitle
// ─────────────────────────────────────────────────────────────────────────────
router.post('/subtitles/download', async (req, res): Promise<void> => {
  const { url } = req.body as { url?: string; file_id?: number };
  if (!url) { res.status(400).json({ error: 'Missing url' }); return; }
  res.json({ link: url });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/subtitle?url=...
// Fetches the subtitle file and returns plain UTF-8 text
// ─────────────────────────────────────────────────────────────────────────────
router.get('/proxy/subtitle', async (req, res): Promise<void> => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(400).json({ error: 'Invalid url scheme' }); return;
    }
    const h = parsed.hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(h) ||
        h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('172.')) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
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

interface SubtitleEntry {
  id?: string;
  filename?: string;
  langcode?: string;
  lang?: string;
  downloads?: number;
  score?: number;
  title?: string;
  episodeTitle?: string;
  season?: string | number;
  episode?: string | number;
  url?: string;
}

interface FormattedSubtitle {
  subtitle_id: string;
  file_id: string;
  file_name: string;
  language: string;
  download_count: number;
  ratings: number;
  movie_name: string;
  episode_title: string;
  season?: number;
  episode?: number;
  feature_type: string;
  url: string;
}

export default router;
