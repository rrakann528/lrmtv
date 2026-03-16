import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  Users, Home, BarChart3, Trash2, Ban, CheckCircle, Shield,
  RefreshCw, LogOut, ChevronLeft, Bell, Settings, Lock,
  Database, Send, Eye, EyeOff, Snowflake, Globe, Play,
  List, AlertTriangle, Download, Edit3, X, Check, Plus,
} from 'lucide-react';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

type Tab = 'dashboard' | 'users' | 'rooms' | 'notifications' | 'settings' | 'security' | 'backup';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Stats {
  totalUsers: number; totalRooms: number; bannedUsers: number;
  totalBannedIps: number; activeRooms: number; activeUsers: number;
}
interface LiveStats {
  totalActiveUsers: number; totalActiveRooms: number;
  topRooms: { slug: string; userCount: number; isPlaying: boolean }[];
}
interface RegRow { day: string; count: number; }
interface AdminUser {
  id: number; username: string; displayName: string | null;
  email: string | null; provider: string; isSiteAdmin: boolean; isBanned: boolean; createdAt: string;
}
interface AdminRoom {
  id: number; slug: string; name: string; type: string;
  isFrozen: boolean; creatorUserId: number | null; createdAt: string; activeUsers?: number;
}
interface PlaylistItem { id: number; url: string; title: string; sourceType: string; }
interface BannedIp { id: number; ip: string; reason: string; createdAt: string; }
interface LoginAttempt { id: number; identifier: string; ip: string; createdAt: string; }
interface SiteSettings {
  maintenance_mode: string; registration_enabled: string; announcement: string;
  welcome_message: string; max_rooms_per_user: string; max_room_members: string;
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function RegChart({ data }: { data: RegRow[] }) {
  if (!data.length) return <div className="text-white/30 text-center py-8 text-sm">لا توجد بيانات</div>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-24 w-full">
      {data.map(d => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5 group relative" title={`${d.day}: ${d.count}`}>
          <div className="bg-cyan-500/70 rounded-sm w-full transition-all" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}

// ── Inline edit cell ──────────────────────────────────────────────────────────
function EditableField({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  return editing ? (
    <span className="flex items-center gap-1">
      <input autoFocus value={val} onChange={e => setVal(e.target.value)}
        className="bg-white/10 border border-cyan-500/40 rounded px-1.5 py-0.5 text-xs w-28 outline-none" />
      <button onClick={async () => { setSaving(true); await onSave(val); setSaving(false); setEditing(false); }}
        className="text-green-400 hover:text-green-300"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={() => { setVal(value); setEditing(false); }} className="text-white/40 hover:text-white/70"><X className="w-3.5 h-3.5" /></button>
    </span>
  ) : (
    <span className="cursor-pointer hover:text-cyan-300 flex items-center gap-1 group" onClick={() => setEditing(true)}>
      {value || <span className="text-white/30 italic text-xs">—</span>}
      <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);

  // Data states
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [regData, setRegData] = useState<RegRow[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [playlist, setPlaylist] = useState<{ slug: string; items: PlaylistItem[] } | null>(null);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  // Form states
  const [search, setSearch] = useState('');
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUserId, setPushUserId] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [newIp, setNewIp] = useState('');
  const [newIpReason, setNewIpReason] = useState('');
  const [editSettings, setEditSettings] = useState<Partial<SiteSettings>>({});
  const [resetPwUser, setResetPwUser] = useState<number | null>(null);
  const [resetPwVal, setResetPwVal] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guard
  useEffect(() => {
    if (user === null) { navigate('/auth'); return; }
    if (user && !user.isSiteAdmin) { navigate('/home'); return; }
  }, [user, navigate]);

  const showFeedback = (msg: string, ok = true) => {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 3000);
  };

  const load = useCallback(async (what: Tab) => {
    setLoading(true);
    try {
      if (what === 'dashboard') {
        const [s, l, r] = await Promise.all([
          apiFetch('/admin/stats').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/stats/live').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/stats/registrations').then(r => r.ok ? r.json() : []),
        ]);
        setStats(s); setLiveStats(l); setRegData(r);
      } else if (what === 'users') {
        const r = await apiFetch('/admin/users');
        if (r.ok) setUsers(await r.json());
      } else if (what === 'rooms') {
        const r = await apiFetch('/admin/rooms');
        if (r.ok) setRooms(await r.json());
      } else if (what === 'security') {
        const [b, l] = await Promise.all([
          apiFetch('/admin/banned-ips').then(r => r.ok ? r.json() : []),
          apiFetch('/admin/login-attempts').then(r => r.ok ? r.json() : []),
        ]);
        setBannedIps(b); setLoginAttempts(l);
      } else if (what === 'settings') {
        const r = await apiFetch('/admin/settings');
        if (r.ok) { const s = await r.json(); setSettings(s); setEditSettings(s); }
      }
    } catch (e) {
      console.error('[Admin] load error:', e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!user?.isSiteAdmin) return;
    load(tab);
    setSearch('');
    setPlaylist(null);
  }, [tab, user?.isSiteAdmin, load]);

  // Live stats refresh
  useEffect(() => {
    if (tab !== 'dashboard') { if (liveTimerRef.current) clearInterval(liveTimerRef.current); return; }
    liveTimerRef.current = setInterval(async () => {
      try {
        const r = await apiFetch('/admin/stats/live');
        if (r.ok) setLiveStats(await r.json());
      } catch {}
    }, 15_000);
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, [tab]);

  if (!user?.isSiteAdmin) return null;

  // ── Filters ────────────────────────────────────────────────────────────────
  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (u.displayName ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const filteredRooms = rooms.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.slug.toLowerCase().includes(search.toLowerCase())
  );
  const filteredIps = bannedIps.filter(b => b.ip.includes(search) || (b.reason ?? '').includes(search));
  const filteredAttempts = loginAttempts.filter(a => a.identifier.includes(search) || a.ip.includes(search));

  // ── Actions ────────────────────────────────────────────────────────────────
  const banToggle = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/ban`, { method: 'PATCH' });
    if (r.ok) { const d = await r.json(); setUsers(p => p.map(x => x.id === u.id ? { ...x, isBanned: d.isBanned } : x)); }
  };
  const adminToggle = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/admin`, { method: 'PATCH' });
    if (r.ok) { const d = await r.json(); setUsers(p => p.map(x => x.id === u.id ? { ...x, isSiteAdmin: d.isSiteAdmin } : x)); }
  };
  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`حذف "${u.username}" نهائياً؟`)) return;
    const r = await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
    if (r.ok) setUsers(p => p.filter(x => x.id !== u.id));
  };
  const resetPw = async () => {
    if (!resetPwUser || resetPwVal.length < 6) return;
    const r = await apiFetch(`/admin/users/${resetPwUser}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: resetPwVal }) });
    if (r.ok) { showFeedback('تم إعادة تعيين كلمة المرور'); setResetPwUser(null); setResetPwVal(''); }
    else showFeedback('فشل', false);
  };
  const editUserField = async (id: number, field: string, value: string) => {
    await apiFetch(`/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
    setUsers(p => p.map(x => x.id === id ? { ...x, [field]: value } : x));
  };
  const freezeToggle = async (r: AdminRoom) => {
    const res = await apiFetch(`/admin/rooms/${r.slug}/freeze`, { method: 'PATCH' });
    if (res.ok) { const d = await res.json(); setRooms(p => p.map(x => x.slug === r.slug ? { ...x, isFrozen: d.isFrozen } : x)); }
  };
  const typeToggle = async (r: AdminRoom) => {
    const res = await apiFetch(`/admin/rooms/${r.slug}/type`, { method: 'PATCH' });
    if (res.ok) { const d = await res.json(); setRooms(p => p.map(x => x.slug === r.slug ? { ...x, type: d.type } : x)); }
  };
  const viewPlaylist = async (r: AdminRoom) => {
    const res = await apiFetch(`/admin/rooms/${r.slug}/playlist`);
    if (res.ok) setPlaylist({ slug: r.slug, items: await res.json() });
  };
  const deleteRoom = async (r: AdminRoom) => {
    if (!confirm(`حذف "${r.name}" نهائياً؟`)) return;
    const res = await apiFetch(`/admin/rooms/${r.slug}`, { method: 'DELETE' });
    if (res.ok) setRooms(p => p.filter(x => x.slug !== r.slug));
  };
  const sendPushAll = async () => {
    if (!pushTitle || !pushBody) return;
    const r = await apiFetch('/admin/push/all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: pushTitle, body: pushBody }) });
    const d = await r.json();
    if (r.ok) { showFeedback(`تم الإرسال لـ ${d.sent} مشترك`); setPushTitle(''); setPushBody(''); }
    else showFeedback(d.error || 'فشل', false);
  };
  const sendPushUser = async () => {
    const uid = parseInt(pushUserId);
    if (!uid || !pushTitle || !pushBody) return;
    const r = await apiFetch(`/admin/push/user/${uid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: pushTitle, body: pushBody }) });
    const d = await r.json();
    if (r.ok) showFeedback(`تم الإرسال: ${d.sent} جهاز`);
    else showFeedback(d.error || 'فشل', false);
  };
  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    const r = await apiFetch('/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: broadcastMsg }) });
    if (r.ok) { showFeedback('تم الإرسال لجميع الغرف النشطة'); setBroadcastMsg(''); }
    else showFeedback('فشل', false);
  };
  const saveSettings = async () => {
    const r = await apiFetch('/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editSettings) });
    if (r.ok) { showFeedback('تم حفظ الإعدادات'); setSettings(editSettings as SiteSettings); }
    else showFeedback('فشل الحفظ', false);
  };
  const addBannedIp = async () => {
    if (!newIp.trim()) return;
    const r = await apiFetch('/admin/banned-ips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: newIp.trim(), reason: newIpReason }) });
    if (r.ok) { const d = await r.json(); setBannedIps(p => [d, ...p]); setNewIp(''); setNewIpReason(''); }
    else { const d = await r.json(); showFeedback(d.error || 'فشل', false); }
  };
  const removeBannedIp = async (id: number) => {
    const r = await apiFetch(`/admin/banned-ips/${id}`, { method: 'DELETE' });
    if (r.ok) setBannedIps(p => p.filter(x => x.id !== id));
  };
  const clearLoginAttempts = async () => {
    if (!confirm('مسح سجل المحاولات القديمة (أكثر من 7 أيام)؟')) return;
    const r = await apiFetch('/admin/login-attempts', { method: 'DELETE' });
    if (r.ok) { showFeedback('تم المسح'); load('security'); }
  };
  const downloadBackup = () => {
    const a = document.createElement('a');
    a.href = '/api/admin/backup';
    a.click();
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard',     label: 'الرئيسية',      icon: BarChart3 },
    { id: 'users',         label: 'المستخدمون',    icon: Users },
    { id: 'rooms',         label: 'الغرف',          icon: Home },
    { id: 'notifications', label: 'الإشعارات',     icon: Bell },
    { id: 'settings',      label: 'الإعدادات',     icon: Settings },
    { id: 'security',      label: 'الأمان',         icon: Lock },
    { id: 'backup',        label: 'النسخ الاحتياطي', icon: Database },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0E] text-white flex flex-col" dir="rtl">

      {/* Feedback toast */}
      {feedback && (
        <div className={cn(
          "fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xl transition-all",
          feedback.ok ? "bg-green-500/90 text-white" : "bg-red-500/90 text-white"
        )}>
          {feedback.msg}
        </div>
      )}

      {/* Reset password modal */}
      {resetPwUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setResetPwUser(null)}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">إعادة تعيين كلمة المرور</h3>
            <input type="password" placeholder="كلمة المرور الجديدة (6+ أحرف)"
              value={resetPwVal} onChange={e => setResetPwVal(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-3" />
            <div className="flex gap-2">
              <button onClick={resetPw} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold py-2 rounded-xl text-sm">حفظ</button>
              <button onClick={() => setResetPwUser(null)} className="flex-1 bg-white/10 hover:bg-white/15 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="font-bold text-cyan-400 text-lg">لوحة الأدمن</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(tab)}
            className="p-1.5 text-white/40 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={() => navigate('/home')}
            className="flex items-center gap-1 px-3 py-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/5 text-sm transition-colors">
            <ChevronLeft className="w-4 h-4" />الرئيسية
          </button>
          <button onClick={() => { logout(); navigate('/auth'); }}
            className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 text-sm transition-colors">
            <LogOut className="w-4 h-4" />خروج
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-white/10 bg-black/20 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0",
              tab === id ? "border-b-2 border-cyan-400 text-cyan-400" : "text-white/50 hover:text-white/80"
            )}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-5xl mx-auto w-full space-y-4">

        {/* ══════════════════════════════════ DASHBOARD ══════════════════════════ */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'المستخدمون', value: stats?.totalUsers, color: 'text-cyan-400', icon: Users },
                { label: 'الغرف', value: stats?.totalRooms, color: 'text-violet-400', icon: Home },
                { label: 'محظورون', value: stats?.bannedUsers, color: 'text-red-400', icon: Ban },
                { label: 'نشطون الآن', value: liveStats?.totalActiveUsers, color: 'text-green-400', icon: Users },
                { label: 'غرف نشطة', value: liveStats?.totalActiveRooms, color: 'text-orange-400', icon: Home },
                { label: 'IPs محظورة', value: stats?.totalBannedIps, color: 'text-yellow-400', icon: Lock },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="bg-white/5 rounded-xl p-3 flex flex-col items-center gap-1 border border-white/8">
                  <Icon className={cn("w-5 h-5", color)} />
                  <span className={cn("text-2xl font-bold", color)}>{value ?? '—'}</span>
                  <span className="text-white/40 text-[10px] text-center">{label}</span>
                </div>
              ))}
            </div>

            {/* Registrations chart */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-xs text-white/50 mb-3 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />تسجيلات آخر 30 يوم
              </div>
              <RegChart data={regData} />
            </div>

            {/* Top active rooms */}
            {liveStats?.topRooms && liveStats.topRooms.length > 0 && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-xs text-white/50 mb-3">أكثر الغرف نشاطاً الآن</div>
                <div className="space-y-2">
                  {liveStats.topRooms.map(r => (
                    <div key={r.slug} className="flex items-center justify-between text-sm">
                      <span className="text-white/80">/{r.slug}</span>
                      <div className="flex items-center gap-2">
                        {r.isPlaying && <Play className="w-3 h-3 text-green-400" />}
                        <span className="text-cyan-400 font-semibold">{r.userCount} مستخدم</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════ USERS ══════════════════════════════ */}
        {tab === 'users' && (
          <div className="space-y-3">
            <input type="text" placeholder="بحث باسم المستخدم أو البريد..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50" />
            <div className="text-xs text-white/40">{filteredUsers.length} مستخدم</div>
            <div className="space-y-2">
              {filteredUsers.map(u => (
                <div key={u.id} className={cn(
                  "bg-white/5 rounded-xl px-4 py-3 border",
                  u.isBanned ? "border-red-500/30" : "border-white/8"
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EditableField value={u.displayName || u.username}
                          onSave={v => editUserField(u.id, 'displayName', v)} />
                        <span className="text-white/40 text-xs">@
                          <EditableField value={u.username} onSave={v => editUserField(u.id, 'username', v)} />
                        </span>
                        {u.isSiteAdmin && <Shield className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
                        {u.isBanned && <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5">محظور</span>}
                        {u.id === user!.id && <span className="text-[10px] text-cyan-400/60">أنت</span>}
                      </div>
                      <div className="text-xs text-white/30 mt-0.5 truncate">
                        <EditableField value={u.email || ''} onSave={v => editUserField(u.id, 'email', v)} />
                        {' · '}{u.provider} · {new Date(u.createdAt).toLocaleDateString('ar')}
                      </div>
                    </div>
                    {u.id !== user!.id && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => adminToggle(u)} title={u.isSiteAdmin ? 'سحب الأدمن' : 'منح أدمن'}
                          className={cn("p-1.5 rounded-lg transition-colors text-[10px]",
                            u.isSiteAdmin ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                          <Shield className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setResetPwUser(u.id)} title="إعادة تعيين كلمة المرور"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                          <Lock className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => banToggle(u)} title={u.isBanned ? 'رفع الحظر' : 'حظر'}
                          className={cn("p-1.5 rounded-lg transition-colors",
                            u.isBanned ? "bg-green-500/10 text-green-400" : "bg-orange-500/10 text-orange-400")}>
                          {u.isBanned ? <CheckCircle className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => deleteUser(u)} title="حذف"
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 && !loading && <div className="text-center text-white/30 py-10">لا توجد نتائج</div>}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ ROOMS ══════════════════════════════ */}
        {tab === 'rooms' && (
          <div className="space-y-3">
            {playlist && (
              <div className="bg-white/5 rounded-xl p-4 border border-cyan-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">قائمة تشغيل /{playlist.slug}</span>
                  <button onClick={() => setPlaylist(null)} className="text-white/40 hover:text-white/70"><X className="w-4 h-4" /></button>
                </div>
                {playlist.items.length === 0 ? <div className="text-white/30 text-sm">القائمة فارغة</div> : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {playlist.items.map(item => (
                      <div key={item.id} className="text-xs flex items-center gap-2 text-white/60">
                        <Play className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                        <span className="truncate">{item.title}</span>
                        <span className="text-white/30 flex-shrink-0">{item.sourceType}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input type="text" placeholder="بحث..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50" />
            <div className="text-xs text-white/40">{filteredRooms.length} غرفة</div>
            <div className="space-y-2">
              {filteredRooms.map(r => (
                <div key={r.slug} className={cn(
                  "flex items-center justify-between gap-3 bg-white/5 rounded-xl px-4 py-3 border",
                  r.isFrozen ? "border-blue-500/30" : "border-white/8"
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{r.name}</span>
                      <button onClick={() => typeToggle(r)}
                        className={cn("text-[10px] rounded px-1.5 py-0.5 transition-colors",
                          r.type === 'public' ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30")}>
                        {r.type === 'public' ? 'عامة' : 'خاصة'}
                      </button>
                      {r.isFrozen && <span className="text-[10px] bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5">مجمّدة</span>}
                      {(r.activeUsers ?? 0) > 0 && <span className="text-[10px] text-green-400">{r.activeUsers} نشط</span>}
                    </div>
                    <div className="text-xs text-white/30 mt-0.5">/{r.slug}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => viewPlaylist(r)} title="عرض قائمة التشغيل"
                      className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                      <List className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => window.open(`/room/${r.slug}`, '_blank')} title="دخول الغرفة"
                      className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => freezeToggle(r)} title={r.isFrozen ? 'إلغاء التجميد' : 'تجميد'}
                      className={cn("p-1.5 rounded-lg transition-colors",
                        r.isFrozen ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                      <Snowflake className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteRoom(r)} title="حذف"
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {filteredRooms.length === 0 && !loading && <div className="text-center text-white/30 py-10">لا توجد نتائج</div>}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ NOTIFICATIONS ══════════════════════ */}
        {tab === 'notifications' && (
          <div className="space-y-4">
            {/* Broadcast to all rooms */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-cyan-400" />رسالة نظام لجميع الغرف النشطة</div>
              <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)}
                placeholder="اكتب رسالة النظام..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500/50 resize-none h-20 mb-3" />
              <button onClick={sendBroadcast}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-xl text-sm transition-colors">
                <Send className="w-4 h-4" />إرسال للكل
              </button>
            </div>

            {/* Push to all */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-violet-400" />إشعار Push لجميع المشتركين</div>
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)} placeholder="العنوان"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-2" />
              <input value={pushBody} onChange={e => setPushBody(e.target.value)} placeholder="النص"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-3" />
              <button onClick={sendPushAll}
                className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 text-white font-semibold rounded-xl text-sm transition-colors">
                <Bell className="w-4 h-4" />إرسال للكل
              </button>
            </div>

            {/* Push to specific user */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-orange-400" />إشعار Push لمستخدم محدد</div>
              <input value={pushUserId} onChange={e => setPushUserId(e.target.value)} placeholder="ID المستخدم"
                type="number"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-2" />
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)} placeholder="العنوان"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-2" />
              <input value={pushBody} onChange={e => setPushBody(e.target.value)} placeholder="النص"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50 mb-3" />
              <button onClick={sendPushUser}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white font-semibold rounded-xl text-sm transition-colors">
                <Send className="w-4 h-4" />إرسال
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ SETTINGS ═══════════════════════════ */}
        {tab === 'settings' && (
          <div className="space-y-4">
            {settings ? (
              <>
                {[
                  { key: 'maintenance_mode', label: 'وضع الصيانة', type: 'toggle', desc: 'يمنع الوصول لغير الأدمن' },
                  { key: 'registration_enabled', label: 'السماح بالتسجيل', type: 'toggle', desc: 'السماح لمستخدمين جدد بالتسجيل' },
                  { key: 'announcement', label: 'إعلان الموقع', type: 'text', desc: 'يظهر في الصفحة الرئيسية (اتركه فارغاً لإخفائه)' },
                  { key: 'welcome_message', label: 'رسالة الترحيب', type: 'text', desc: 'تظهر في صفحة الهبوط' },
                  { key: 'max_rooms_per_user', label: 'الحد الأقصى للغرف لكل مستخدم', type: 'number', desc: '' },
                  { key: 'max_room_members', label: 'الحد الأقصى لأعضاء الغرفة', type: 'number', desc: '' },
                ].map(({ key, label, type, desc }) => (
                  <div key={key} className="bg-white/5 rounded-xl p-4 border border-white/8">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        {desc && <div className="text-xs text-white/40 mt-0.5">{desc}</div>}
                      </div>
                      {type === 'toggle' ? (
                        <button
                          onClick={() => setEditSettings(p => ({ ...p, [key]: p[key as keyof SiteSettings] === 'true' ? 'false' : 'true' }))}
                          className={cn("w-12 h-6 rounded-full transition-colors relative",
                            editSettings[key as keyof SiteSettings] === 'true' ? "bg-cyan-500" : "bg-white/20"
                          )}>
                          <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                            editSettings[key as keyof SiteSettings] === 'true' ? "right-1" : "left-1")} />
                        </button>
                      ) : (
                        <input
                          type={type}
                          value={editSettings[key as keyof SiteSettings] ?? ''}
                          onChange={e => setEditSettings(p => ({ ...p, [key]: e.target.value }))}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-cyan-500/50 w-40 text-right"
                        />
                      )}
                    </div>
                  </div>
                ))}
                <button onClick={saveSettings}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-colors">
                  <Check className="w-4 h-4" />حفظ الإعدادات
                </button>
              </>
            ) : (
              <div className="text-center text-white/30 py-10">جاري التحميل...</div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════ SECURITY ═══════════════════════════ */}
        {tab === 'security' && (
          <div className="space-y-4">
            {/* Banned IPs */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4 text-red-400" />عناوين IP المحظورة</div>
              <div className="flex gap-2 mb-3">
                <input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="عنوان IP"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50" />
                <input value={newIpReason} onChange={e => setNewIpReason(e.target.value)} placeholder="السبب (اختياري)"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50" />
                <button onClick={addBannedIp}
                  className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors flex-shrink-0">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50 mb-2" />
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {filteredIps.map(ip => (
                  <div key={ip.id} className="flex items-center justify-between text-sm bg-white/5 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-red-400 font-mono">{ip.ip}</span>
                      {ip.reason && <span className="text-white/40 text-xs mr-2">{ip.reason}</span>}
                    </div>
                    <button onClick={() => removeBannedIp(ip.id)} className="text-white/40 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {filteredIps.length === 0 && <div className="text-white/30 text-sm text-center py-3">لا توجد IPs محظورة</div>}
              </div>
            </div>

            {/* Login attempts */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />محاولات دخول فاشلة
                </div>
                <button onClick={clearLoginAttempts} className="text-xs text-white/40 hover:text-red-400 transition-colors">مسح القديمة</button>
              </div>
              <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50 mb-2" />
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {filteredAttempts.slice(0, 100).map(a => (
                  <div key={a.id} className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-white/70">{a.identifier}</span>
                    <span className="text-red-400 font-mono">{a.ip}</span>
                    <span className="text-white/30">{new Date(a.createdAt).toLocaleString('ar')}</span>
                  </div>
                ))}
                {filteredAttempts.length === 0 && <div className="text-white/30 text-sm text-center py-3">لا توجد محاولات</div>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ BACKUP ═════════════════════════════ */}
        {tab === 'backup' && (
          <div className="space-y-4">
            <div className="bg-white/5 rounded-xl p-6 border border-white/8 text-center space-y-4">
              <Database className="w-12 h-12 text-cyan-400 mx-auto" />
              <div>
                <div className="font-bold text-lg mb-1">تصدير قاعدة البيانات</div>
                <div className="text-white/50 text-sm">يصدّر بيانات المستخدمين، الغرف، الإعدادات، وIPs المحظورة كملف JSON</div>
              </div>
              <button onClick={downloadBackup}
                className="flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl mx-auto transition-colors">
                <Download className="w-5 h-5" />تحميل النسخة الاحتياطية
              </button>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-sm text-yellow-300/80">
              <AlertTriangle className="w-4 h-4 inline ml-2" />
              النسخة الاحتياطية تحتوي على بيانات حساسة. احتفظ بها في مكان آمن.
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
