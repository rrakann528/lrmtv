export type VideoSourceType = 'youtube' | 'vimeo' | 'twitch' | 'dailymotion' | 'rumble' | 'kick' | 'facebook' | 'twitter' | 'odysee' | 'hls' | 'dash' | 'embed' | 'html5';

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('//')) {
    return 'https://' + trimmed;
  }
  return trimmed;
}

export function detectVideoType(url: string): VideoSourceType {
  const normalized = normalizeUrl(url);
  const lower = normalized.toLowerCase();

  // ── Embedded / known platforms ─────────────────────────────────────────────
  if (/(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/.test(lower)) return 'youtube';
  if (/vimeo\.com/.test(lower)) return 'vimeo';
  if (/twitch\.tv/.test(lower)) return 'twitch';
  if (/dailymotion\.com|dai\.ly/.test(lower)) return 'dailymotion';
  if (/rumble\.com/.test(lower)) return 'rumble';
  if (/kick\.com/.test(lower)) return 'kick';
  if (/(?:facebook\.com\/(?:watch|video|share|reel)|fb\.watch)/.test(lower)) return 'facebook';
  if (/(?:twitter\.com|x\.com)\//.test(lower)) return 'twitter';
  if (/odysee\.com/.test(lower)) return 'odysee';

  // ── Iframe embed sources (vidsrc, 2embed, autoembed, etc.) ─────────────────
  if (/(?:vidsrc\.to|vidsrc\.me|vidsrc\.xyz|2embed\.cc|autoembed\.cc|autoembed\.to|embedsu\.com|moviesapi\.club|embed\.su)\/embed\//.test(lower)) return 'embed';

  // ── HLS streams ────────────────────────────────────────────────────────────
  // Match file extensions and common URL patterns that indicate HLS
  const pathname = lower.split('?')[0];
  if (
    pathname.endsWith('.m3u8') ||
    pathname.endsWith('.m3u') ||
    lower.includes('m3u8') ||
    lower.includes('/hls/') ||
    lower.includes('format=hls') ||
    lower.includes('type=m3u8') ||
    lower.includes('playlist.m3u') ||
    lower.includes('chunklist') ||
    lower.includes('index.m3u')
  ) return 'hls';

  // ── DASH streams ───────────────────────────────────────────────────────────
  if (
    pathname.endsWith('.mpd') ||
    lower.includes('/dash/') ||
    lower.includes('format=mpd') ||
    lower.includes('format=dash') ||
    lower.includes('type=mpd')
  ) return 'dash';

  return 'html5';
}

/** Extract the first http/https URL from a block of text (for Web Share Target) */
export function extractUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}
