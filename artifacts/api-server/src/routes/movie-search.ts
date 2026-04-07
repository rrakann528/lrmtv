import { Router } from 'express';

const router = Router();

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  media_type: 'movie' | 'tv';
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
}

// GET /api/movies/search?q=query
router.get('/movies/search', async (req, res) => {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'TMDB API key not configured' });
    return;
  }

  const q = (req.query.q as string)?.trim();
  if (!q) {
    res.status(400).json({ error: 'Missing query parameter: q' });
    return;
  }

  try {
    const params = new URLSearchParams({
      query: q,
      api_key: apiKey,
      include_adult: 'false',
      language: 'ar-SA',
      page: '1',
    });

    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/search/multi?${params}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!tmdbRes.ok) {
      const body = await tmdbRes.text();
      console.error('[Movie Search] TMDB error:', tmdbRes.status, body);
      res.status(tmdbRes.status).json({ error: 'TMDB API error' });
      return;
    }

    const data = (await tmdbRes.json()) as { results: TMDBResult[] };

    const items = (data.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        title: r.title || r.name || '',
        year: (r.release_date || r.first_air_date || '').substring(0, 4),
        poster: r.poster_path
          ? `https://image.tmdb.org/t/p/w200${r.poster_path}`
          : null,
        type: r.media_type,
        rating: r.vote_average ? r.vote_average.toFixed(1) : null,
        overview: r.overview || '',
        embedUrl:
          r.media_type === 'movie'
            ? `https://vidsrc.to/embed/movie/${r.id}`
            : `https://vidsrc.to/embed/tv/${r.id}`,
      }));

    res.json({ items });
  } catch (err) {
    console.error('[Movie Search] Fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
