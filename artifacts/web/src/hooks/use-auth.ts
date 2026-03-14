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
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export async function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}/api${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const r = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطأ في التسجيل');
    setUser(data);
    return data as AuthUser;
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'خطأ في تسجيل الدخول');
    setUser(data);
    return data as AuthUser;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
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
