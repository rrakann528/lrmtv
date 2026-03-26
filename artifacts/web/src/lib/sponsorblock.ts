const SB_API = 'https://sponsor.ajay.app/api';

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be',
]);

export interface SponsorSegment {
  segment: [number, number];
  category: string;
  UUID: string;
}

export const AD_CATEGORIES = ['sponsor', 'selfpromo'] as const;
export const INTRO_CATEGORIES = ['intro', 'outro', 'interaction', 'preview', 'music_offtopic'] as const;

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!YOUTUBE_HOSTS.has(u.hostname)) return null;
    if (u.hostname === 'youtu.be' || u.hostname === 'www.youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const match = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?&]+)/);
    if (match) return match[1];
  } catch {}
  return null;
}

const cache = new Map<string, SponsorSegment[]>();

let currentRequestId = 0;

export async function fetchSponsorSegments(
  videoUrl: string,
  onResult: (segments: SponsorSegment[]) => void,
): Promise<void> {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) {
    onResult([]);
    return;
  }

  if (cache.has(videoId)) {
    onResult(cache.get(videoId)!);
    return;
  }

  const requestId = ++currentRequestId;

  try {
    const categories = [...AD_CATEGORIES, ...INTRO_CATEGORIES];
    const params = categories.map(c => `category=${c}`).join('&');
    const res = await fetch(`${SB_API}/skipSegments?videoID=${videoId}&${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (requestId !== currentRequestId) return;
    if (!res.ok) {
      cache.set(videoId, []);
      onResult([]);
      return;
    }
    const data: SponsorSegment[] = await res.json();
    cache.set(videoId, data);
    if (requestId === currentRequestId) onResult(data);
  } catch {
    if (requestId === currentRequestId) {
      cache.set(videoId, []);
      onResult([]);
    }
  }
}

export function findActiveSegment(
  segments: SponsorSegment[],
  currentTime: number,
  allowedCategories?: readonly string[],
): SponsorSegment | null {
  for (const seg of segments) {
    if (allowedCategories && !allowedCategories.includes(seg.category)) continue;
    const [start, end] = seg.segment;
    if (currentTime >= start && currentTime < end - 0.5) {
      return seg;
    }
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return YOUTUBE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
