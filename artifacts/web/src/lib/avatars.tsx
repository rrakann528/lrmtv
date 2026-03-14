export interface AvatarDef {
  id: string;
  label: string;
  url: string;
}

export const AVATAR_CATEGORIES = ['boy', 'girl', 'other'] as const;
export type AvatarCategory = typeof AVATAR_CATEGORIES[number];

export const CATEGORY_LABELS: Record<AvatarCategory, { ar: string; en: string }> = {
  boy:   { ar: 'شباب', en: 'Guys'  },
  girl:  { ar: 'بنات', en: 'Girls' },
  other: { ar: 'أخرى', en: 'Other' },
};

// AI-generated anime/semi-realistic cartoon avatars stored in /public/avatars/
const BASE = import.meta.env.BASE_URL; // e.g. "/web/"

function av(id: string, label: string, file: string): AvatarDef {
  return { id, label, url: `${BASE}avatars/${file}` };
}

export const AVATARS: Record<AvatarCategory, AvatarDef[]> = {
  boy: [
    av('boy-1', 'شاب 1', 'boy-1.png'),
    av('boy-2', 'شاب 2', 'boy-2.png'),
    av('boy-3', 'شاب 3', 'boy-3.png'),
    av('boy-4', 'شاب 4', 'boy-4.png'),
    av('boy-5', 'شاب 5', 'boy-5.png'),
    av('boy-6', 'شاب 6', 'boy-6.png'),
    av('boy-7', 'شاب 7', 'boy-7.png'),
    av('boy-8', 'شاب 8', 'boy-8.png'),
  ],
  girl: [
    av('girl-1', 'بنت 1', 'girl-1.png'),
    av('girl-2', 'بنت 2', 'girl-2.png'),
    av('girl-3', 'بنت 3', 'girl-3.png'),
    av('girl-4', 'بنت 4', 'girl-4.png'),
    av('girl-5', 'بنت 5', 'girl-5.png'),
    av('girl-6', 'بنت 6', 'girl-6.png'),
    av('girl-7', 'بنت 7', 'girl-7.png'),
    av('girl-8', 'بنت 8', 'girl-8.png'),
  ],
  other: [],
};

export const ALL_AVATARS: AvatarDef[] = [
  ...AVATARS.boy,
  ...AVATARS.girl,
  ...AVATARS.other,
];

export function findAvatar(id: string): AvatarDef | undefined {
  return ALL_AVATARS.find(a => a.id === id);
}

export const PRESET_PREFIX = 'preset:';

export function isPresetAvatar(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(PRESET_PREFIX);
}

export function getPresetId(url: string): string {
  return url.replace(PRESET_PREFIX, '');
}

export function toPresetUrl(id: string): string {
  return `${PRESET_PREFIX}${id}`;
}
