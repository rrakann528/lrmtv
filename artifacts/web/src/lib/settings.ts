import { useState, useEffect, useCallback } from 'react';

export interface AppSettings {
  chatSounds: boolean;
  friendRequestNotifs: boolean;
  roomInviteNotifs: boolean;
  mentionNotifs: boolean;
  showTimestamps: boolean;
  chatFontSize: 'small' | 'normal' | 'large';
  enterSends: boolean;
  showJoinLeave: boolean;
  autoPlay: boolean;
  defaultVolume: number;
  sponsorBlock: boolean;
  videoQuality: 'auto' | '1080p' | '720p' | '480p' | '360p';
  theaterMode: boolean;
  subtitleAutoEnable: boolean;
  showOnlineStatus: boolean;
  allowFriendRequests: boolean;
  profileVisibility: 'public' | 'friends';
  allowDMs: boolean;
  reduceMotion: boolean;
  compactMode: boolean;
  messagePreviews: boolean;
  autoJoinLastRoom: boolean;
  confirmBeforeLeave: boolean;
  doubleClickFullscreen: boolean;
}

const DEFAULTS: AppSettings = {
  chatSounds: true,
  friendRequestNotifs: true,
  roomInviteNotifs: true,
  mentionNotifs: true,
  showTimestamps: true,
  chatFontSize: 'normal',
  enterSends: true,
  showJoinLeave: true,
  autoPlay: true,
  defaultVolume: 80,
  sponsorBlock: true,
  videoQuality: 'auto',
  theaterMode: false,
  subtitleAutoEnable: false,
  showOnlineStatus: true,
  allowFriendRequests: true,
  profileVisibility: 'public',
  allowDMs: true,
  reduceMotion: false,
  compactMode: false,
  messagePreviews: true,
  autoJoinLastRoom: false,
  confirmBeforeLeave: true,
  doubleClickFullscreen: true,
};

const STORAGE_KEY = 'lrmtv_settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

let currentSettings = loadSettings();
const listeners = new Set<() => void>();

export function getSettings(): AppSettings {
  return currentSettings;
}

export function updateSettings(partial: Partial<AppSettings>) {
  currentSettings = { ...currentSettings, ...partial };
  saveSettings(currentSettings);
  listeners.forEach(fn => fn());
}

export function resetSettings() {
  currentSettings = { ...DEFAULTS };
  saveSettings(currentSettings);
  listeners.forEach(fn => fn());
}

export function useSettings(): [AppSettings, (p: Partial<AppSettings>) => void, () => void] {
  const [s, setS] = useState(currentSettings);

  useEffect(() => {
    const handler = () => setS({ ...currentSettings });
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const update = useCallback((p: Partial<AppSettings>) => updateSettings(p), []);
  const reset = useCallback(() => resetSettings(), []);

  return [s, update, reset];
}
