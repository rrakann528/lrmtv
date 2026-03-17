import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  email?: string | null;
  emailVerified?: boolean;
  isSiteAdmin?: boolean;
  isBanned?: boolean;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const CACHE_KEY = 'lrmtv_auth_user';
const TOKEN_KEY = 'lrmtv_auth_token';

function readCache(): AuthUser | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeCache(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export async function apiFetch(path: string, opts?: RequestInit) {
  const token = readToken();
  const r = await fetch(`${BASE}/api${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers || {}),
    },
  });
  // If the stored Bearer token was rejected, clear it so next requests use cookies
  if (r.status === 401 && token) {
    writeToken(null);
  }
  return r;
}

export function useAuth() {
  const cached = readCache();
  const [user, setUserState] = useState<AuthUser | null | undefined>(cached ?? undefined);
  const [loading, setLoading] = useState(!cached);

  const setUser = useCallback((u: AuthUser | null | undefined) => {
    setUserState(u);
    if (u === undefined) return;
    writeCache(u ?? null);
  }, []);

  useEffect(() => {
    apiFetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then((data: (AuthUser & { token?: string }) | null) => {
        if (data?.token) writeToken(data.token);
        const { token: _t, ...freshUser } = data ?? {};
        setUser(data ? (freshUser as AuthUser) : null);
      })
      .catch(() => {
        // Network error — keep cached user rather than logging out
      })
      .finally(() => setLoading(false));
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const r = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطأ في التسجيل');
    if (data.token) writeToken(data.token);
    const { token: _t, ...user } = data;
    setUser(user);
    return user as AuthUser;
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطأ في تسجيل الدخول');
    if (data.token) writeToken(data.token);
    const { token: _t, ...user } = data;
    setUser(user);
    return user as AuthUser;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    writeCache(null);
    writeToken(null);
    setUserState(null);
  }, []);

  const updateProfile = useCallback(async (updates: {
    displayName?: string;
    bio?: string;
    avatarColor?: string;
    avatarUrl?: string;
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => {
    const r = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify(updates) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطأ في تحديث الملف');
    setUser(data);
    return data as AuthUser;
  }, []);

  return { user, loading, setUser, register, login, logout, updateProfile };
}
