import { Router } from 'express';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// OpenSubtitles XML-RPC — open-source, NO API key required
// Docs: https://trac.opensubtitles.org/projects/opensubtitles/wiki/XMLRPC
// ─────────────────────────────────────────────────────────────────────────────
const XMLRPC_URL  = 'https://api.opensubtitles.org/xml-rpc';
const USER_AGENT  = 'LrmTV v1.0';

// Token cache — valid 14 min (OS tokens expire after 15 min)
let _token     = '';
let _tokenExp  = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const body = `<?xml version="1.0"?>
<methodCall><methodName>LogIn</methodName><params>
  <param><value><string></string></value></param>
  <param><value><string></string></value></param>
  <param><value><string>en</string></value></param>
  <param><value><string>${USER_AGENT}</string></value></param>
</params></methodCall>`;

  const r = await fetch(XMLRPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'User-Agent': USER_AGENT },
    body,
  });
  const xml = await r.text();
  const m = xml.match(/<name>token<\/name>\s*<value><string>([^<]+)<\/string>/);
  if (!m) throw new Error('OS login failed');
  _token    = m[1];
  _tokenExp = Date.now() + 14 * 60 * 1000;
  return _token;
}

// Map 2-letter → 3-letter ISO language codes used by OpenSubtitles
const LANG3: Record<string, string> = {
  ar: 'ara', en: 'eng', fr: 'fre', es: 'spa', tr: 'tur',
  de: 'ger', it: 'ita', pt: 'por', zh: 'chi', ru: 'rus',
  ja: 'jpn', ko: 'kor', nl: 'dut', sv: 'swe', pl: 'pol',
};

function toLang3(csv: string): string {
  return csv.split(',').map(l => LANG3[l.trim()] ?? l.trim()).join(',');
}

/**
 * Find the LAST value of a named XML-RPC member in a chunk of XML.
 * Using "last" avoids bleeding values from a previous subtitle entry
 * when we look backwards from the SubDownloadLink anchor.
 */
function memberLast(xml: string, name: string): string {
  const re = new RegExp(
    `<name>${name}<\\/name>\\s*<value>(?:<[a-zA-Z]+>)?([^<]*)(?:<\\/[a-zA-Z]+>)?\\s*<\\/value>`,
    'gi',
  );
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) last = m[1].trim();
  return last;
}

/**
 * Parse XML-RPC SearchSubtitles response.
 * Strategy: split by <name>SubDownloadLink</name> anchors.
 *   - The download URL is right after each anchor.
 *   - All other fields (IDSubtitle, SubFileName, …) appear BEFORE the anchor
 *     in the same subtitle struct, so we look back in the preceding text chunk.
 * This avoids the nested-struct problem entirely.
 */
function parseResults(xml: string): FormattedSubtitle[] {
  // Split on the SubDownloadLink marker — one entry per subtitle
  const parts = xml.split('<name>SubDownloadLink</name>');
  const items: FormattedSubtitle[] = [];

  for (let i = 1; i < parts.length; i++) {
    // Download URL is the first <string> value after the marker
    const urlMatch = parts[i].match(/<value><string>([^<]+)<\/string>/);
    if (!urlMatch) continue;
    const url = urlMatch[1].trim();

    // The preceding chunk contains the current subtitle's fields (at its tail)
    // Take enough characters to cover a full struct but not bleed into the previous one
    const lookback = parts[i - 1].slice(-7000);

    const id        = memberLast(lookback, 'IDSubtitle') || memberLast(lookback, 'IDSubtitleFile');
    const filename  = memberLast(lookback, 'SubFileName');
    const lang      = memberLast(lookback, 'SubLanguageID');
    const dlCount   = parseInt(memberLast(lookback, 'SubDownloadsCnt') || '0', 10);
    const movieName = decodeEntities(memberLast(lookback, 'MovieName'));
    const seasonStr = memberLast(lookback, 'SeriesSeason');
    const epStr     = memberLast(lookback, 'SeriesEpisode');
    const epTitle   = decodeEntities(memberLast(lookback, 'SeriesEpisodeName'));

    items.push({
      subtitle_id:    id || String(i),
      file_name:      filename,
      language:       lang,
      download_count: isNaN(dlCount) ? 0 : dlCount,
      movie_name:     movieName,
      episode_title:  epTitle,
      season:         seasonStr ? parseInt(seasonStr, 10) : undefined,
      episode:        epStr     ? parseInt(epStr,     10) : undefined,
      feature_type:   seasonStr ? 'Episode' : 'Movie',
      url,
    });
  }

  // Will be sorted by caller with relevance weighting
  return items;
}

/**
 * Step 1 — SearchMoviesOnIMDB: find the best IMDB ID for the query.
 * Returns the first result whose title matches closely, or null.
 */
async function findImdbId(token: string, query: string): Promise<string | null> {
  const body = `<?xml version="1.0"?>
<methodCall><methodName>SearchMoviesOnIMDB</methodName><params>
  <param><value><string>${token}</string></value></param>
  <param><value><string>${escapeXml(query)}</string></value></param>
</params></methodCall>`;

  const r = await fetch(XMLRPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'User-Agent': USER_AGENT },
    body,
  });
  const xml = await r.text();

  // Extract <id> and <title> pairs from the results array
  const pairs: { id: string; title: string }[] = [];
  const idRe    = /<name>id<\/name>\s*<value><string>([^<]+)<\/string>/gi;
  const titleRe = /<name>title<\/name>\s*<value><string>([^<]+)<\/string>/gi;
  let idM: RegExpExecArray | null;
  let titleM: RegExpExecArray | null;

  // Collect all IDs and titles in document order and pair them
  const allIds: string[] = [];
  const allTitles: string[] = [];
  while ((idM    = idRe.exec(xml))    !== null) allIds.push(idM[1].trim());
  while ((titleM = titleRe.exec(xml)) !== null) allTitles.push(decodeEntities(titleM[1].trim()));
  for (let i = 0; i < Math.min(allIds.length, allTitles.length); i++) {
    pairs.push({ id: allIds[i], title: allTitles[i] });
  }

  if (pairs.length === 0) return null;

  const q = query.toLowerCase().trim();

  // Prefer exact match, then starts-with match, then first result
  const exact = pairs.find(p => p.title.toLowerCase() === q);
  if (exact) return exact.id;

  const starts = pairs.find(p => p.title.toLowerCase().startsWith(q));
  if (starts) return starts.id;

  return pairs[0].id;
}

/**
 * Step 2 — SearchSubtitles: search by IMDB ID (precise) or by query text (fallback).
 */
async function searchXmlRpc(
  token: string,
  sublanguageid: string,
  query: string,
  season?: string,
  episode?: string,
): Promise<FormattedSubtitle[]> {
  // Try IMDB-based search first for precise show/movie matching
  const imdbId = await findImdbId(token, query).catch(() => null);

  let structMembers: string;
  if (imdbId) {
    structMembers = `
    <member><name>sublanguageid</name><value><string>${sublanguageid}</string></value></member>
    <member><name>imdbid</name><value><string>${imdbId}</string></value></member>`;
  } else {
    structMembers = `
    <member><name>sublanguageid</name><value><string>${sublanguageid}</string></value></member>
    <member><name>query</name><value><string>${escapeXml(query)}</string></value></member>`;
  }
  if (season)  structMembers += `\n    <member><name>season</name><value><string>${season}</string></value></member>`;
  if (episode) structMembers += `\n    <member><name>episode</name><value><string>${episode}</string></value></member>`;

  const body = `<?xml version="1.0"?>
<methodCall><methodName>SearchSubtitles</methodName><params>
  <param><value><string>${token}</string></value></param>
  <param><value><array><data><value><struct>${structMembers}
  </struct></value></data></array></value></param>
</params></methodCall>`;

  const r = await fetch(XMLRPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'User-Agent': USER_AGENT },
    body,
  });
  const xml = await r.text();
  return parseResults(xml);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Decode XML/HTML entities returned by OpenSubtitles XML-RPC */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&apos;/gi, "'")
    // Strip wrapping quotes that OS adds: "Show Name" → Show Name
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

/**
 * Relevance score: how closely does the result's movie_name match the query?
 * Higher = better match. Used to push the right show to the top.
 */
function relevanceScore(movieName: string, query: string): number {
  const name = movieName.toLowerCase().trim();
  const q    = query.toLowerCase().trim();
  if (name === q)                          return 1000;
  if (name.startsWith(q + ' ') || name.startsWith(q + ':')) return 100;
  // Split into words and check if any word exactly equals query
  if (name.split(/\W+/).includes(q))       return 10;
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/subtitles/search?q=...&season=...&episode=...&lang=ar,en
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subtitles/search', async (req, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) { res.status(400).json({ error: 'Missing q param' }); return; }

  const season   = (req.query.season  as string | undefined)?.trim();
  const episode  = (req.query.episode as string | undefined)?.trim();
  const langCsv  = (req.query.lang    as string | undefined) ?? 'ar,en';
  const lang3    = toLang3(langCsv);

  try {
    const token = await getToken();
    const wantSeason  = season  && season  !== '0' ? parseInt(season,  10) : undefined;
    const wantEpisode = episode && episode !== '0' ? parseInt(episode, 10) : undefined;

    let results = await searchXmlRpc(
      token, lang3, q,
      wantSeason  != null ? String(wantSeason)  : undefined,
      wantEpisode != null ? String(wantEpisode) : undefined,
    );

    // Filter by season first, then narrow to episode — with fallbacks
    let filtered = results;
    if (wantSeason != null) {
      const bySeason = filtered.filter(r => r.season === wantSeason);
      // Only apply filter if it doesn't wipe out all results
      if (bySeason.length > 0) filtered = bySeason;
    }
    if (wantEpisode != null) {
      const byEpisode = filtered.filter(r => r.episode === wantEpisode);
      // Fall back to season-level results if no exact episode match
      if (byEpisode.length > 0) filtered = byEpisode;
    }

    // Sort: relevance × downloads — push the right show to the top
    filtered.sort((a, b) => {
      const ra = relevanceScore(a.movie_name, q) * (a.download_count + 1);
      const rb = relevanceScore(b.movie_name, q) * (b.download_count + 1);
      return rb - ra;
    });

    res.json(filtered.slice(0, 30));
  } catch (err) {
    // Reset token on failure so next request tries fresh login
    _token = '';
    res.status(502).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subtitles/download  { url: string }
// The XML-RPC API returns direct CDN URLs — just echo them back
// ─────────────────────────────────────────────────────────────────────────────
router.post('/subtitles/download', async (req, res): Promise<void> => {
  const { url } = req.body as { url?: string };
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

interface FormattedSubtitle {
  subtitle_id: string;
  file_name: string;
  language: string;
  download_count: number;
  movie_name: string;
  episode_title: string;
  season?: number;
  episode?: number;
  feature_type: string;
  url: string;
}

export default router;
