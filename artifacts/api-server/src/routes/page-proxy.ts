import { Router } from 'express';
import { URL } from 'url';
import { extractVideoUrls as browserExtract } from '../lib/browser-extract.js';
import { extractLimiter } from '../middlewares/security.js';

const router = Router();

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    if (host.startsWith('fc') || host.startsWith('fd') || host === '::') return true;
    if (!parsed.protocol.startsWith('http')) return true;
    return false;
  } catch { return true; }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Origin, Accept',
};

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept-Encoding': 'identity',
};

const VIDEO_RE = /(?:https?:)?\/\/[^\s"'<>\)]+\.(?:m3u8|mp4|webm|mkv)(?:\?[^\s"'<>\)]*)?/gi;
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  if (isPrivateUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const resp = await fetch(url, {
      headers: { ...BASE_HEADERS, 'Referer': `${parsed.protocol}//${parsed.host}/` },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return { html, finalUrl: resp.url || url };
  } catch { return null; }
}

function extractVideoUrls(text: string): string[] {
  const matches = text.match(VIDEO_RE) || [];
  const urls = new Set<string>();
  for (const m of matches) {
    let u = m;
    if (u.startsWith('//')) u = 'https:' + u;
    try { new URL(u); urls.add(u); } catch {}
  }
  return [...urls];
}

function extractIframeSrcs(html: string, baseUrl: string): string[] {
  const srcs: string[] = [];
  let match;
  const re = new RegExp(IFRAME_SRC_RE.source, 'gi');
  while ((match = re.exec(html)) !== null) {
    let src = match[1];
    if (!src || src.startsWith('about:') || src.startsWith('javascript:')) continue;
    try {
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = new URL(src, baseUrl).href;
      else if (!src.startsWith('http')) src = new URL(src, baseUrl).href;
      srcs.push(src);
    } catch {}
  }
  return srcs;
}

function extractEmbedUrls(html: string, baseUrl: string): string[] {
  const patterns = [
    /(?:src|file|source|url|video_url|stream_url|embed_url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /data-src=["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /source\s*:\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
    /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|webm)[^"']*?)["']/gi,
  ];
  const urls = new Set<string>();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let u = m[1];
      try {
        if (u.startsWith('//')) u = 'https:' + u;
        else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
        new URL(u);
        urls.add(u);
      } catch {}
    }
  }
  return [...urls];
}

router.options('/proxy/extract', (_req, res) => { res.set(CORS_HEADERS).sendStatus(204); });

router.get('/proxy/extract', extractLimiter, async (req, res) => {
  res.set(CORS_HEADERS);
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) { res.status(400).json({ error: 'Missing url param' }); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid url' }); return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(403).json({ error: 'Blocked' }); return;
  }

  try {
    let method = 'none';
    const allVideos: string[] = [];

    try {
      const browserVideos = await browserExtract(targetUrl, 30000);
      if (browserVideos.length > 0) {
        allVideos.push(...browserVideos);
        method = 'browser';
      }
    } catch (browserErr) {
      console.error('[extract] browser extraction failed:', browserErr);
    }

    if (allVideos.length === 0) {
      const visited = new Set<string>();
      const page1 = await fetchPage(targetUrl);
      if (page1) {
        visited.add(targetUrl);
        allVideos.push(...extractVideoUrls(page1.html));
        allVideos.push(...extractEmbedUrls(page1.html, page1.finalUrl));

        const iframeSrcs = extractIframeSrcs(page1.html, page1.finalUrl);
        const fetchPromises = iframeSrcs
          .filter(src => !visited.has(src) && !isPrivateUrl(src))
          .slice(0, 5)
          .map(async (src) => {
            visited.add(src);
            const page2 = await fetchPage(src);
            if (!page2) return;
            allVideos.push(...extractVideoUrls(page2.html));
            allVideos.push(...extractEmbedUrls(page2.html, page2.finalUrl));
          });
        await Promise.allSettled(fetchPromises);
        if (allVideos.length > 0) method = 'static';
      }
    }

    const uniqueVideos = [...new Set(allVideos)];
    res.json({ videos: uniqueVideos, method });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
