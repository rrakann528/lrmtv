export type VideoSourceType = 'youtube' | 'vimeo' | 'twitch' | 'dailymotion' | 'hls' | 'dash' | 'html5';

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('//')) {
    return 'https://' + trimmed;
  }
  return trimmed;
}

export function detectVideoType(url: string): VideoSourceType {
  const lower = normalizeUrl(url).toLowerCase();

  if (/(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/.test(lower)) return 'youtube';
  if (/vimeo\.com/.test(lower)) return 'vimeo';
  if (/twitch\.tv/.test(lower)) return 'twitch';
  if (/dailymotion\.com|dai\.ly/.test(lower)) return 'dailymotion';

  const pathname = lower.split('?')[0];
  if (pathname.endsWith('.m3u8') || lower.includes('/hls/') || lower.includes('m3u8')) return 'hls';
  if (pathname.endsWith('.mpd') || lower.includes('/dash/')) return 'dash';

  return 'html5';
}
