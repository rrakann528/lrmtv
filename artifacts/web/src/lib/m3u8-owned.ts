const ownedIds = new Set<string>();

export function markM3u8Owned(id: string): void {
  ownedIds.add(id);
}

export function isM3u8Owned(id: string): boolean {
  return ownedIds.has(id);
}

export function extractM3u8Id(url: string): string | null {
  const m = url.match(/\/api\/m3u8\/([^/?#]+)/);
  return m ? m[1] : null;
}
