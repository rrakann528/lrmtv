import { Router } from 'express';

const router = Router();

interface YTSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    thumbnails: { medium: { url: string }; default: { url: string } };
    channelTitle: string;
    publishedAt: string;
  };
}

// GET /api/youtube/search?q=query&maxResults=10
router.get('/youtube/search', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'YouTube API key not configured' });
    return;
  }

  const q = (req.query.q as string)?.trim();
  if (!q) {
    res.status(400).json({ error: 'Missing query parameter: q' });
    return;
  }

  const maxResults = Math.min(Number(req.query.maxResults) || 8, 25);

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q,
      maxResults: String(maxResults),
      key: apiKey,
      videoEmbeddable: 'true',
      safeSearch: 'none',
    });

    const ytRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!ytRes.ok) {
      const body = await ytRes.text();
      console.error('[YouTube Search] API error:', ytRes.status, body);
      res.status(ytRes.status).json({ error: 'YouTube API error', details: body });
      return;
    }

    const data = (await ytRes.json()) as { items: YTSearchItem[] };

    const items = (data.items || []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));

    res.json({ items });
  } catch (err) {
    console.error('[YouTube Search] Fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
