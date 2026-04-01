import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  Users, Home, BarChart3, Trash2, Ban, CheckCircle, Shield,
  RefreshCw, LogOut, ChevronLeft, Bell, Settings, Lock,
  Database, Send, Eye, Snowflake, Globe, Play, Pause,
  List, Download, Edit3, X, Check, Plus, MessageSquare,
  Volume2, VolumeX, Server, Activity, UserX, FileText,
  Copy, ExternalLink, StopCircle, Clock, Filter, Wifi,
  ChevronDown, ChevronUp, AlertTriangle, Hash, Zap, Flag,
} from 'lucide-react';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

type Tab = 'dashboard' | 'users' | 'rooms' | 'chat' | 'notifications' | 'settings' | 'security' | 'system' | 'reports';
type UserFilter = 'all' | 'admin' | 'banned' | 'muted';
type RoomFilter = 'all' | 'active' | 'frozen' | 'public' | 'private';
type UserSort = 'date' | 'name' | 'id';
type RoomSort = 'date' | 'name' | 'active';

interface Stats { totalUsers: number; totalRooms: number; bannedUsers: number; totalBannedIps: number; activeRooms: number; activeUsers: number; }
interface LiveStats { totalActiveUsers: number; totalActiveRooms: number; topRooms: { slug: string; userCount: number; isPlaying: boolean }[]; }
interface EnhancedStats { totalMessages: number; providers: { provider: string; cnt: number }[]; }
interface ActivityLogEntry { action: string; by: string; at: string; }
interface MsgCount { username: string; msg_count: number; }
interface GlobalSearchResult { users: any[]; rooms: any[]; }
interface SystemInfo { node: string; uptime: number; memRss: number; memHeap: number; memHeapTotal: number; totalMessages: number; totalUsers: number; totalRooms: number; activeRooms: number; activeUsers: number; platform: string; env: string; }
interface RegRow { day: string; count: number; }
interface AdminUser { id: number; username: string; displayName: string | null; email: string | null; provider: string; isSiteAdmin: boolean; isBanned: boolean; isMuted?: boolean; adminNote?: string; createdAt: string; }
interface AdminRoom { id: number; slug: string; name: string; type: string; isFrozen: boolean; creatorUserId: number | null; createdAt: string; activeUsers?: number; }
interface PlaylistItem { id: number; url: string; title: string; sourceType: string; }
interface BannedIp { id: number; ip: string; reason: string; createdAt: string; }
interface LoginAttempt { id: number; identifier: string; ip: string; createdAt: string; }
interface SiteSettings { maintenance_mode: string; announcement: string; welcome_message: string; max_rooms_per_user: string; max_room_members: string; }
interface ChatMsg { id: number; username: string; content: string; type: string; created_at: string; room_slug?: string; room_name?: string; }
interface PushSub { id: number; endpoint: string; created_at: string; username: string; user_id: number; }
interface AdminReport {
  id: number;
  messageId: number | null;
  messageContent: string;
  reportedUsername: string;
  reporterUsername: string;
  roomSlug: string | null;
  reason: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function RegChart({ data }: { data: RegRow[] }) {
  if (!data.length) return <div className="text-white/30 text-center py-8 text-sm">لا توجد بيانات</div>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-0.5 h-20 w-full">
      {data.map(d => (
        <div key={d.day} className="flex-1 flex flex-col items-center group relative" title={`${d.day}: ${d.count}`}>
          <div className="bg-cyan-500/60 hover:bg-cyan-400/80 rounded-sm w-full transition-all" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}

function EditableField({ value, onSave, placeholder }: { value: string; onSave: (v: string) => Promise<void>; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(value); }, [value]);
  return editing ? (
    <span className="flex items-center gap-1">
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder}
        className="bg-white/10 border border-cyan-500/40 rounded px-1.5 py-0.5 text-xs w-32 outline-none" />
      <button onClick={async () => { setSaving(true); await onSave(val); setSaving(false); setEditing(false); }}
        disabled={saving} className="text-green-400 hover:text-green-300"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={() => { setVal(value); setEditing(false); }} className="text-white/40"><X className="w-3.5 h-3.5" /></button>
    </span>
  ) : (
    <span className="cursor-pointer hover:text-cyan-300 flex items-center gap-1 group" onClick={() => setEditing(true)}>
      {value || <span className="text-white/30 italic text-xs">{placeholder || '—'}</span>}
      <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </span>
  );
}

function StatCard({ label, value, color, icon: Icon, sub }: { label: string; value: number | string | undefined; color: string; icon: React.ElementType; sub?: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 flex flex-col items-center gap-1 border border-white/8">
      <Icon className={cn("w-4 h-4", color)} />
      <span className={cn("text-xl font-bold", color)}>{value ?? '—'}</span>
      <span className="text-white/40 text-[10px] text-center leading-tight">{label}</span>
      {sub && <span className="text-white/25 text-[9px]">{sub}</span>}
    </div>
  );
}

const DEFAULT_SITE_SETTINGS: SiteSettings = { maintenance_mode: 'false', announcement: '', welcome_message: '', max_rooms_per_user: '10', max_room_members: '100' };

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [enhancedStats, setEnhancedStats] = useState<EnhancedStats | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [regData, setRegData] = useState<RegRow[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [playlist, setPlaylist] = useState<{ slug: string; items: PlaylistItem[] } | null>(null);
  const [roomChat, setRoomChat] = useState<{ slug: string; msgs: ChatMsg[] } | null>(null);
  const [globalChat, setGlobalChat] = useState<ChatMsg[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [editSettings, setEditSettings] = useState<Partial<SiteSettings>>({});
  const [wordFilter, setWordFilter] = useState<string[]>([]);
  const [pushSubs, setPushSubs] = useState<PushSub[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportFilter, setReportFilter] = useState<'pending' | 'all'>('pending');

  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [userSort, setUserSort] = useState<UserSort>('date');
  const [roomSort, setRoomSort] = useState<RoomSort>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [msgCounts, setMsgCounts] = useState<MsgCount[]>([]);
  const [roomsDaily, setRoomsDaily] = useState<RegRow[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult | null>(null);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [transferSlug, setTransferSlug] = useState('');
  const [transferVal, setTransferVal] = useState('');
  const [announceSlug, setAnnounceSlug] = useState('');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [sysAnnounceSlug, setSysAnnounceSlug] = useState('');
  const [sysAnnounceMsg, setSysAnnounceMsg] = useState('');
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUserId, setPushUserId] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [newIp, setNewIp] = useState('');
  const [newIpReason, setNewIpReason] = useState('');
  const [newWord, setNewWord] = useState('');
  const [renameSlug, setRenameSlug] = useState('');
  const [renameVal, setRenameVal] = useState('');
  const [resetPwUser, setResetPwUser] = useState<number | null>(null);
  const [resetPwVal, setResetPwVal] = useState('');
  const [noteUser, setNoteUser] = useState<AdminUser | null>(null);
  const [noteVal, setNoteVal] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        const [s, l, r, e, rd, st] = await Promise.all([
          apiFetch('/admin/stats').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/stats/live').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/stats/registrations').then(r => r.ok ? r.json() : []),
          apiFetch('/admin/stats/enhanced').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/stats/rooms-daily').then(r => r.ok ? r.json() : []),
          apiFetch('/admin/settings').then(r => r.ok ? r.json() : null),
        ]);
        setStats(s); setLiveStats(l); setRegData(r); setEnhancedStats(e); setRoomsDaily(rd);
        if (st) { setSettings(st); setEditSettings(st); }
      } else if (what === 'users') {
        const [r, mc] = await Promise.all([
          apiFetch('/admin/users?limit=500'),
          apiFetch('/admin/users/message-counts'),
        ]);
        if (r.ok) { const data = await r.json(); setUsers(Array.isArray(data) ? data : data.users ?? []); }
        if (mc.ok) setMsgCounts(await mc.json());
      } else if (what === 'rooms') {
        const r = await apiFetch('/admin/rooms');
        if (r.ok) setRooms(await r.json());
      } else if (what === 'chat') {
        const r = await apiFetch('/admin/recent-chat');
        if (r.ok) setGlobalChat(await r.json());
      } else if (what === 'security') {
        const [b, l] = await Promise.all([
          apiFetch('/admin/banned-ips').then(r => r.ok ? r.json() : []),
          apiFetch('/admin/login-attempts').then(r => r.ok ? r.json() : []),
        ]);
        setBannedIps(b); setLoginAttempts(l);
      } else if (what === 'settings') {
        const [r, w] = await Promise.all([
          apiFetch('/admin/settings').then(r => r.ok ? r.json() : DEFAULT_SITE_SETTINGS),
          apiFetch('/admin/word-filter').then(r => r.ok ? r.json() : []),
        ]);
        setSettings(r); setEditSettings(r);
        setWordFilter(w);
      } else if (what === 'system') {
        const [sys, subs, al] = await Promise.all([
          apiFetch('/admin/system').then(r => r.ok ? r.json() : null),
          apiFetch('/admin/push-subscribers').then(r => r.ok ? r.json() : []),
          apiFetch('/admin/activity-log').then(r => r.ok ? r.json() : []),
        ]);
        setSystemInfo(sys); setPushSubs(subs); setActivityLog(al);
      } else if (what === 'reports') {
        const r = await apiFetch('/admin/reports?status=all');
        if (r.ok) setReports(await r.json());
      }
    } catch (e) { console.error('[Admin] load error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!user?.isSiteAdmin) return;
    load(tab);
    setSearch(''); setPlaylist(null); setRoomChat(null);
  }, [tab, user?.isSiteAdmin, load]);

  useEffect(() => {
    if (tab !== 'dashboard') { if (liveTimerRef.current) clearInterval(liveTimerRef.current); return; }
    liveTimerRef.current = setInterval(async () => {
      try { const r = await apiFetch('/admin/stats/live'); if (r.ok) setLiveStats(await r.json()); } catch {}
    }, 15_000);
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, [tab]);

  if (!user?.isSiteAdmin) return null;

  // ── Filters ───────────────────────────────────────────────────────────────
  const msgCountMap = new Map(msgCounts.map(m => [m.username, m.msg_count]));

  const filteredUsers = users
    .filter(u => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || (u.displayName ?? '').toLowerCase().includes(q);
      const matchFilter = userFilter === 'all' || (userFilter === 'admin' && u.isSiteAdmin) || (userFilter === 'banned' && u.isBanned) || (userFilter === 'muted' && u.isMuted);
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (userSort === 'name') cmp = (a.username).localeCompare(b.username);
      else if (userSort === 'id') cmp = a.id - b.id;
      else cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sortAsc ? -cmp : cmp;
    });

  const filteredRooms = rooms
    .filter(r => {
      const q = search.toLowerCase();
      const matchSearch = !q || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
      const matchFilter = roomFilter === 'all'
        || (roomFilter === 'active' && (r.activeUsers ?? 0) > 0)
        || (roomFilter === 'frozen' && r.isFrozen)
        || (roomFilter === 'public' && r.type === 'public')
        || (roomFilter === 'private' && r.type === 'private');
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (roomSort === 'name') cmp = a.name.localeCompare(b.name);
      else if (roomSort === 'active') cmp = (b.activeUsers ?? 0) - (a.activeUsers ?? 0);
      else cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sortAsc ? -cmp : cmp;
    });

  const filteredIps = bannedIps.filter(b => b.ip.includes(search) || (b.reason ?? '').includes(search));
  const filteredChat = globalChat.filter(m => !search || m.username.includes(search) || m.content.includes(search) || (m.room_slug ?? '').includes(search));
  const filteredSubs = pushSubs.filter(s => !search || s.username.includes(search));

  // ── User Actions ──────────────────────────────────────────────────────────
  const banToggle = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/ban`, { method: 'PATCH' });
    if (r.ok) { const d = await r.json(); setUsers(p => p.map(x => x.id === u.id ? { ...x, isBanned: d.isBanned } : x)); }
  };
  const muteToggle = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/mute`, { method: 'PATCH' });
    if (r.ok) { const d = await r.json(); setUsers(p => p.map(x => x.id === u.id ? { ...x, isMuted: d.isMuted } : x)); showFeedback(d.isMuted ? 'تم كتم المستخدم' : 'تم رفع الكتم'); }
  };
  const adminToggle = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/admin`, { method: 'PATCH' });
    if (r.ok) { const d = await r.json(); setUsers(p => p.map(x => x.id === u.id ? { ...x, isSiteAdmin: d.isSiteAdmin } : x)); }
  };
  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`حذف "${u.username}" نهائياً؟`)) return;
    const r = await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
    if (r.ok) { setUsers(p => p.filter(x => x.id !== u.id)); showFeedback('تم الحذف'); }
  };
  const kickUser = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/kick`, { method: 'POST' });
    if (r.ok) { const d = await r.json(); showFeedback(d.rooms.length > 0 ? `تم الطرد من ${d.rooms.length} غرفة` : 'المستخدم غير متصل'); }
  };
  const saveNote = async () => {
    if (!noteUser) return;
    const r = await apiFetch(`/admin/users/${noteUser.id}/note`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: noteVal }) });
    if (r.ok) { setUsers(p => p.map(x => x.id === noteUser!.id ? { ...x, adminNote: noteVal } : x)); showFeedback('تم حفظ الملاحظة'); setNoteUser(null); }
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
  const exportUsers = () => { window.open('/api/admin/users/export', '_blank'); };

  // ── Room Actions ──────────────────────────────────────────────────────────
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
  const clearPlaylist = async (r: AdminRoom) => {
    if (!confirm(`مسح قائمة التشغيل في "${r.name}"؟`)) return;
    const res = await apiFetch(`/admin/rooms/${r.slug}/playlist`, { method: 'DELETE' });
    if (res.ok) { showFeedback('تم مسح قائمة التشغيل'); setPlaylist(null); }
  };
  const viewChat = async (r: AdminRoom) => {
    const res = await apiFetch(`/admin/rooms/${r.slug}/chat`);
    if (res.ok) setRoomChat({ slug: r.slug, msgs: await res.json() });
  };
  const clearChat = async (r: AdminRoom) => {
    if (!confirm(`مسح محادثة "${r.name}" نهائياً؟`)) return;
    const res = await apiFetch(`/admin/rooms/${r.slug}/chat`, { method: 'DELETE' });
    if (res.ok) { showFeedback('تم مسح المحادثة'); setRoomChat(null); }
  };
  const renameRoom = async () => {
    if (!renameSlug || !renameVal.trim()) return;
    const res = await apiFetch(`/admin/rooms/${renameSlug}/rename`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: renameVal.trim() }) });
    if (res.ok) { const d = await res.json(); setRooms(p => p.map(x => x.slug === renameSlug ? { ...x, name: d.name } : x)); showFeedback('تم إعادة التسمية'); setRenameSlug(''); setRenameVal(''); }
    else showFeedback('فشل', false);
  };
  const forceVideo = async (r: AdminRoom, action: 'play' | 'pause') => {
    const res = await apiFetch(`/admin/rooms/${r.slug}/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    if (res.ok) showFeedback(action === 'play' ? 'تم تشغيل الفيديو' : 'تم إيقاف الفيديو');
  };
  const deleteRoom = async (r: AdminRoom) => {
    if (!confirm(`حذف "${r.name}" نهائياً؟`)) return;
    const res = await apiFetch(`/admin/rooms/${r.slug}`, { method: 'DELETE' });
    if (res.ok) { setRooms(p => p.filter(x => x.slug !== r.slug)); showFeedback('تم حذف الغرفة'); }
  };
  const exportRooms = () => { window.open('/api/admin/rooms/export', '_blank'); };

  // ── New Feature Actions ───────────────────────────────────────────────────

  // F1: إيقاف جميع الغرف
  const pauseAllRooms = async () => {
    if (!confirm('إيقاف تشغيل الفيديو في جميع الغرف النشطة؟')) return;
    const r = await apiFetch('/admin/rooms/pause-all', { method: 'POST' });
    if (r.ok) { const d = await r.json(); showFeedback(`تم إيقاف ${d.paused} غرفة`); }
  };

  // F2: حظر IP المستخدم
  const banUserIp = async (u: AdminUser) => {
    const r = await apiFetch(`/admin/users/${u.id}/ban-ip`, { method: 'POST' });
    if (r.ok) { const d = await r.json(); showFeedback(`تم حظر IP: ${d.ip}`); }
    else { const d = await r.json(); showFeedback(d.error || 'لا يوجد IP محفوظ', false); }
  };

  // F3: نقل ملكية الغرفة
  const transferOwner = async () => {
    if (!transferSlug || !transferVal.trim()) return;
    const r = await apiFetch(`/admin/rooms/${transferSlug}/transfer-owner`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newOwnerUsername: transferVal.trim() }) });
    if (r.ok) { const d = await r.json(); showFeedback(`تم نقل الملكية إلى @${d.newOwnerUsername}`); setTransferSlug(''); setTransferVal(''); }
    else { const d = await r.json(); showFeedback(d.error || 'فشل', false); }
  };

  // F4: تصدير محادثة الغرفة CSV
  const exportRoomChat = (slug: string) => { window.open(`/api/admin/rooms/${slug}/chat/export`, '_blank'); };

  // F5: حذف غرف مستخدم
  const deleteUserRooms = async (u: AdminUser) => {
    if (!confirm(`حذف جميع غرف @${u.username}؟`)) return;
    const r = await apiFetch(`/admin/users/${u.id}/rooms`, { method: 'DELETE' });
    if (r.ok) { const d = await r.json(); showFeedback(`تم حذف ${d.deleted} غرفة`); load('users'); }
  };

  // F6: بحث عالمي
  const doGlobalSearch = async () => {
    if (globalSearch.length < 2) return;
    setGlobalSearching(true);
    const r = await apiFetch(`/admin/global-search?q=${encodeURIComponent(globalSearch)}`);
    if (r.ok) setGlobalResults(await r.json());
    setGlobalSearching(false);
  };

  // F7: إرسال إعلان لغرفة محددة
  const sendRoomAnnounce = async () => {
    if (!announceSlug || !announceMsg.trim()) return;
    const r = await apiFetch(`/admin/rooms/${announceSlug}/announce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: announceMsg }) });
    if (r.ok) { showFeedback(`تم إرسال الإعلان إلى /${announceSlug}`); setAnnounceSlug(''); setAnnounceMsg(''); }
    else showFeedback('فشل الإرسال', false);
  };

  // ── Chat Actions ──────────────────────────────────────────────────────────
  const deleteMsg = async (id: number) => {
    const r = await apiFetch(`/admin/chat/${id}`, { method: 'DELETE' });
    if (r.ok) { setGlobalChat(p => p.filter(m => m.id !== id)); showFeedback('تم حذف الرسالة'); }
  };

  // ── Notifications ─────────────────────────────────────────────────────────
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

  // ── Settings ──────────────────────────────────────────────────────────────
  const saveSettings = async () => {
    const r = await apiFetch('/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editSettings) });
    if (r.ok) { showFeedback('تم حفظ الإعدادات'); setSettings(editSettings as SiteSettings); }
    else showFeedback('فشل الحفظ', false);
  };
  const addWord = async () => {
    if (!newWord.trim()) return;
    const r = await apiFetch('/admin/word-filter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: newWord.trim() }) });
    if (r.ok) { setWordFilter(await r.json()); setNewWord(''); }
  };
  const removeWord = async (w: string) => {
    const r = await apiFetch(`/admin/word-filter/${encodeURIComponent(w)}`, { method: 'DELETE' });
    if (r.ok) setWordFilter(await r.json());
  };

  // ── Security ──────────────────────────────────────────────────────────────
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

  // ── Reports ───────────────────────────────────────────────────────────────
  const reviewReport = async (id: number, action: 'dismiss' | 'ban' | 'kick' | 'mute') => {
    const label = action === 'ban' ? 'حظر المستخدم' : action === 'kick' ? 'طرده الآن' : action === 'mute' ? 'كتمه' : 'تجاهل البلاغ';
    if (!confirm(`${label}؟`)) return;
    const r = await apiFetch(`/admin/reports/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (r.ok) { showFeedback(label + ' — تم'); load('reports'); }
    else showFeedback('فشل الإجراء', false);
  };
  const deleteReport = async (id: number) => {
    const r = await apiFetch(`/admin/reports/${id}`, { method: 'DELETE' });
    if (r.ok) setReports(p => p.filter(x => x.id !== id));
  };

  // ── System ────────────────────────────────────────────────────────────────
  const deletePushSub = async (id: number) => {
    const r = await apiFetch(`/admin/push-subscribers/${id}`, { method: 'DELETE' });
    if (r.ok) { setPushSubs(p => p.filter(x => x.id !== id)); showFeedback('تم الحذف'); }
  };
  const downloadBackup = () => { window.open('/api/admin/backup', '_blank'); };

  const formatUptime = (s: number) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return `${d > 0 ? d + 'ي ' : ''}${h}س ${m}د`;
  };
  const roomAge = (d: string) => {
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return days === 0 ? 'اليوم' : `${days} يوم`;
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard',     label: 'الرئيسية',    icon: BarChart3 },
    { id: 'users',         label: 'المستخدمون',  icon: Users },
    { id: 'rooms',         label: 'الغرف',        icon: Home },
    { id: 'chat',          label: 'المحادثات',   icon: MessageSquare },
    { id: 'notifications', label: 'الإشعارات',   icon: Bell },
    { id: 'settings',      label: 'الإعدادات',   icon: Settings },
    { id: 'security',      label: 'الأمان',       icon: Lock },
    { id: 'system',        label: 'النظام',       icon: Server },
    { id: 'reports',       label: 'البلاغات',     icon: Flag },
  ];

  const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500/50";
  const btnCls = (color: string) => `flex items-center gap-2 px-4 py-2 ${color} font-semibold rounded-xl text-sm transition-colors`;

  return (
    <div className="h-screen h-dvh bg-[#0D0D0E] text-white flex flex-col overflow-hidden" dir="rtl">

      {/* Feedback toast */}
      {feedback && (
        <div className={cn("fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xl transition-all",
          feedback.ok ? "bg-green-500/90 text-white" : "bg-red-500/90 text-white")}>
          {feedback.msg}
        </div>
      )}

      {/* Reset password modal */}
      {resetPwUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setResetPwUser(null)}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">إعادة تعيين كلمة المرور</h3>
            <input type="password" placeholder="كلمة المرور الجديدة (6+ أحرف)" value={resetPwVal} onChange={e => setResetPwVal(e.target.value)}
              className={cn(inputCls, "mb-3")} />
            <div className="flex gap-2">
              <button onClick={resetPw} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold py-2 rounded-xl text-sm">حفظ</button>
              <button onClick={() => setResetPwUser(null)} className="flex-1 bg-white/10 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin note modal */}
      {noteUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setNoteUser(null)}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">ملاحظة أدمن — @{noteUser.username}</h3>
            <p className="text-white/40 text-xs mb-3">مرئية للأدمن فقط</p>
            <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)} rows={4} placeholder="اكتب ملاحظة..."
              className={cn(inputCls, "resize-none mb-3")} />
            <div className="flex gap-2">
              <button onClick={saveNote} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold py-2 rounded-xl text-sm">حفظ</button>
              <button onClick={() => setNoteUser(null)} className="flex-1 bg-white/10 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer owner modal */}
      {transferSlug && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setTransferSlug('')}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">نقل ملكية /{transferSlug}</h3>
            <p className="text-white/40 text-xs mb-3">أدخل اسم المستخدم الجديد</p>
            <input value={transferVal} onChange={e => setTransferVal(e.target.value)} placeholder="اسم المستخدم"
              className={cn(inputCls, "mb-3")} onKeyDown={e => e.key === 'Enter' && transferOwner()} autoFocus />
            <div className="flex gap-2">
              <button onClick={transferOwner} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold py-2 rounded-xl text-sm">نقل</button>
              <button onClick={() => setTransferSlug('')} className="flex-1 bg-white/10 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Room announce modal */}
      {announceSlug && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setAnnounceSlug('')}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">إعلان في غرفة /{announceSlug}</h3>
            <p className="text-white/40 text-xs mb-3">يظهر كرسالة نظام في الدردشة</p>
            <textarea value={announceMsg} onChange={e => setAnnounceMsg(e.target.value)} rows={3} placeholder="نص الإعلان..."
              className={cn(inputCls, "resize-none mb-3")} autoFocus />
            <div className="flex gap-2">
              <button onClick={sendRoomAnnounce} className="flex-1 bg-violet-500 hover:bg-violet-400 text-white font-semibold py-2 rounded-xl text-sm">إرسال</button>
              <button onClick={() => setAnnounceSlug('')} className="flex-1 bg-white/10 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename room modal */}
      {renameSlug && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setRenameSlug('')}>
          <div className="bg-[#1a1a1b] rounded-2xl p-6 w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">إعادة تسمية /{renameSlug}</h3>
            <input value={renameVal} onChange={e => setRenameVal(e.target.value)} placeholder="الاسم الجديد"
              className={cn(inputCls, "mb-3")} onKeyDown={e => e.key === 'Enter' && renameRoom()} autoFocus />
            <div className="flex gap-2">
              <button onClick={renameRoom} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold py-2 rounded-xl text-sm">حفظ</button>
              <button onClick={() => setRenameSlug('')} className="flex-1 bg-white/10 py-2 rounded-xl text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="font-bold text-cyan-400 text-lg">لوحة الأدمن</span>
          {liveStats && <span className="text-[10px] text-green-400 bg-green-500/10 rounded-full px-2 py-0.5">{liveStats.totalActiveUsers} متصل</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(tab)} className="p-1.5 text-white/40 hover:text-white/80 rounded-lg hover:bg-white/5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={pauseAllRooms} title="إيقاف جميع الغرف" className="p-1.5 text-red-400/60 hover:text-red-400 rounded-lg hover:bg-red-500/10">
            <StopCircle className="w-4 h-4" />
          </button>
          <button onClick={() => navigate('/home')} className="flex items-center gap-1 px-3 py-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/5 text-sm">
            <ChevronLeft className="w-4 h-4" />الرئيسية
          </button>
          <button onClick={() => { logout(); navigate('/auth'); }} className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 text-sm">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Global Search */}
      <div className="px-4 py-2 border-b border-white/5 bg-black/20">
        <div className="flex gap-2 max-w-5xl mx-auto">
          <div className="flex-1 relative">
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doGlobalSearch()}
              placeholder="بحث عالمي: مستخدم، غرفة، بريد..." 
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cyan-500/30 pr-8" />
            {globalSearching && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30 text-[10px]">⟳</span>}
          </div>
          <button onClick={doGlobalSearch} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60">بحث</button>
          {globalResults && <button onClick={() => { setGlobalResults(null); setGlobalSearch(''); }} className="text-white/30 hover:text-white/60 text-xs px-2">✕</button>}
        </div>
        {globalResults && (
          <div className="mt-2 max-w-5xl mx-auto bg-[#1a1a1b] rounded-xl border border-white/10 p-3 space-y-3">
            {globalResults.users.length > 0 && (
              <div>
                <div className="text-[10px] text-white/40 mb-1.5 font-semibold uppercase tracking-wider">مستخدمون ({globalResults.users.length})</div>
                <div className="space-y-1">
                  {globalResults.users.map((u: any) => (
                    <div key={u.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5">
                      <span className="text-cyan-400">@{u.username}</span>
                      <span className="text-white/40">{u.display_name ?? ''}</span>
                      {u.is_banned && <span className="text-[10px] text-red-400">محظور</span>}
                      <button onClick={() => { setTab('users'); setSearch(u.username); setGlobalResults(null); }}
                        className="text-white/30 hover:text-white/70 text-[10px] mr-auto">عرض</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {globalResults.rooms.length > 0 && (
              <div>
                <div className="text-[10px] text-white/40 mb-1.5 font-semibold uppercase tracking-wider">غرف ({globalResults.rooms.length})</div>
                <div className="space-y-1">
                  {globalResults.rooms.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5">
                      <span className="text-violet-400">/{r.slug}</span>
                      <span className="text-white/60">{r.name}</span>
                      {r.is_frozen && <span className="text-[10px] text-blue-400">مجمّدة</span>}
                      <button onClick={() => { setTab('rooms'); setSearch(r.slug); setGlobalResults(null); }}
                        className="text-white/30 hover:text-white/70 text-[10px] mr-auto">عرض</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {globalResults.users.length === 0 && globalResults.rooms.length === 0 && (
              <p className="text-white/30 text-xs text-center py-2">لا توجد نتائج</p>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 bg-black/20 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0",
              tab === id ? "border-b-2 border-cyan-400 text-cyan-400" : "text-white/50 hover:text-white/80")}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 max-w-5xl mx-auto w-full space-y-4">

        {/* ══════════════════ DASHBOARD ══════════════════════════════════════ */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {/* Quick actions */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <div className="text-xs text-amber-400 font-semibold mb-2 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />إجراءات سريعة</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={async () => { const v = settings?.maintenance_mode === 'true' ? 'false' : 'true'; const r = await apiFetch('/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maintenance_mode: v }) }); if (r.ok) { setSettings(p => p ? { ...p, maintenance_mode: v } : p); setEditSettings(p => ({ ...p, maintenance_mode: v })); showFeedback(v === 'true' ? 'تم تفعيل الصيانة' : 'تم إلغاء الصيانة'); } }}
                  className={cn("text-xs px-3 py-1.5 rounded-lg transition-colors", settings?.maintenance_mode === 'true' ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30")}>
                  {settings?.maintenance_mode === 'true' ? '✅ إلغاء الصيانة' : '🔧 وضع الصيانة'}
                </button>
                <button onClick={() => setTab('notifications')} className="text-xs px-3 py-1.5 bg-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/30">
                  📣 بث رسالة
                </button>
                <button onClick={downloadBackup} className="text-xs px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30">
                  💾 نسخ احتياطي
                </button>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="المستخدمون" value={stats?.totalUsers} color="text-cyan-400" icon={Users} />
              <StatCard label="الغرف" value={stats?.totalRooms} color="text-violet-400" icon={Home} />
              <StatCard label="الرسائل" value={enhancedStats?.totalMessages?.toLocaleString()} color="text-blue-400" icon={MessageSquare} />
              <StatCard label="نشطون الآن" value={liveStats?.totalActiveUsers} color="text-green-400" icon={Wifi} />
              <StatCard label="غرف نشطة" value={liveStats?.totalActiveRooms} color="text-orange-400" icon={Activity} />
              <StatCard label="محظورون" value={stats?.bannedUsers} color="text-red-400" icon={Ban} />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-xs text-white/50 mb-3 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />تسجيلات آخر 30 يوم</div>
                <RegChart data={regData} />
              </div>
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-xs text-white/50 mb-3 flex items-center gap-1.5"><Home className="w-3.5 h-3.5" />غرف جديدة آخر 30 يوم</div>
                <RegChart data={roomsDaily} />
              </div>
            </div>

            {/* Provider breakdown */}
            {enhancedStats?.providers && enhancedStats.providers.length > 0 && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-xs text-white/50 mb-3">مصادر التسجيل</div>
                <div className="flex gap-3 flex-wrap">
                  {enhancedStats.providers.map(p => (
                    <div key={p.provider} className="flex items-center gap-1.5 text-sm">
                      <span className="text-white/60">{p.provider}</span>
                      <span className="text-cyan-400 font-bold">{p.cnt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top active rooms */}
            {liveStats?.topRooms && liveStats.topRooms.length > 0 && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-xs text-white/50 mb-3">أكثر الغرف نشاطاً الآن</div>
                <div className="space-y-2">
                  {liveStats.topRooms.map(r => (
                    <div key={r.slug} className="flex items-center justify-between text-sm">
                      <span className="text-white/80 font-mono text-xs">/{r.slug}</span>
                      <div className="flex items-center gap-2">
                        {r.isPlaying && <Play className="w-3 h-3 text-green-400" />}
                        <span className="text-cyan-400 font-semibold text-xs">{r.userCount} مستخدم</span>
                        <button onClick={() => window.open(`/room/${r.slug}`, '_blank')} className="text-white/30 hover:text-white/70"><ExternalLink className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ USERS ══════════════════════════════════════════ */}
        {tab === 'users' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} className={cn(inputCls, "flex-1")} />
              <button onClick={exportUsers} className="flex items-center gap-1 px-3 py-2 bg-green-500/20 text-green-400 rounded-xl text-xs hover:bg-green-500/30 flex-shrink-0">
                <Download className="w-3.5 h-3.5" />CSV
              </button>
            </div>
            {/* Filter chips */}
            <div className="flex gap-1.5 flex-wrap items-center">
              {(['all', 'admin', 'banned', 'muted'] as UserFilter[]).map(f => (
                <button key={f} onClick={() => setUserFilter(f)}
                  className={cn("px-3 py-1 rounded-full text-xs transition-colors",
                    userFilter === f ? "bg-cyan-500/30 text-cyan-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                  {f === 'all' ? `الكل (${users.length})` : f === 'admin' ? 'أدمن' : f === 'banned' ? 'محظور' : 'مكتوم'}
                </button>
              ))}
              <span className="text-white/20 text-xs mr-2">|</span>
              <span className="text-xs text-white/30">فرز:</span>
              {(['date', 'name', 'id'] as UserSort[]).map(s => (
                <button key={s} onClick={() => { if (userSort === s) setSortAsc(p => !p); else { setUserSort(s); setSortAsc(false); } }}
                  className={cn("px-2 py-0.5 rounded text-[10px] transition-colors flex items-center gap-0.5",
                    userSort === s ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-white/30 hover:text-white/60")}>
                  {s === 'date' ? 'تاريخ' : s === 'name' ? 'اسم' : 'رقم'}
                  {userSort === s && (sortAsc ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
                </button>
              ))}
            </div>
            <div className="text-xs text-white/40">{filteredUsers.length} مستخدم</div>
            <div className="space-y-2">
              {filteredUsers.map(u => (
                <div key={u.id} className={cn("bg-white/5 rounded-xl px-4 py-3 border",
                  u.isBanned ? "border-red-500/30" : u.isMuted ? "border-orange-500/20" : "border-white/8")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EditableField value={u.displayName || u.username} onSave={v => editUserField(u.id, 'displayName', v)} />
                        <span className="text-white/40 text-xs">@<EditableField value={u.username} onSave={v => editUserField(u.id, 'username', v)} /></span>
                        {u.isSiteAdmin && <Shield className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
                        {u.isBanned && <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5">محظور</span>}
                        {u.isMuted && <span className="text-[10px] bg-orange-500/20 text-orange-400 rounded px-1.5 py-0.5">مكتوم</span>}
                        {u.id === user!.id && <span className="text-[10px] text-cyan-400/60">أنت</span>}
                        <span className="text-[10px] text-white/25">#{u.id}</span>
                      </div>
                      <div className="text-xs text-white/30 mt-0.5 truncate">
                        <EditableField value={u.email || ''} onSave={v => editUserField(u.id, 'email', v)} placeholder="بريد إلكتروني" />
                        {' · '}{u.provider} · {new Date(u.createdAt).toLocaleDateString('ar')}
                      </div>
                      {u.adminNote && <div className="text-[10px] text-amber-400/70 mt-1 flex items-center gap-1"><FileText className="w-3 h-3" />{u.adminNote}</div>}
                      {msgCountMap.get(u.username) && (
                        <span className="text-[10px] text-blue-400/70 mt-0.5 flex items-center gap-1">
                          <MessageSquare className="w-2.5 h-2.5" />{msgCountMap.get(u.username)} رسالة
                        </span>
                      )}
                    </div>
                    {u.id !== user!.id && (
                      <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                        <button onClick={() => adminToggle(u)} title={u.isSiteAdmin ? 'سحب الأدمن' : 'منح أدمن'}
                          className={cn("p-1.5 rounded-lg transition-colors", u.isSiteAdmin ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                          <Shield className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => muteToggle(u)} title={u.isMuted ? 'رفع الكتم' : 'كتم الشات'}
                          className={cn("p-1.5 rounded-lg transition-colors", u.isMuted ? "bg-orange-500/20 text-orange-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                          {u.isMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => { setNoteUser(u); setNoteVal(u.adminNote || ''); }} title="ملاحظة أدمن"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-amber-400 transition-colors">
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => kickUser(u)} title="طرد من الغرف"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-yellow-400 transition-colors">
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setResetPwUser(u.id)} title="إعادة تعيين كلمة المرور"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors">
                          <Lock className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => banToggle(u)} title={u.isBanned ? 'رفع الحظر' : 'حظر'}
                          className={cn("p-1.5 rounded-lg transition-colors", u.isBanned ? "bg-green-500/10 text-green-400" : "bg-orange-500/10 text-orange-400")}>
                          {u.isBanned ? <CheckCircle className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => banUserIp(u)} title="حظر IP الأخير"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-red-400 transition-colors">
                          <Hash className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteUserRooms(u)} title="حذف جميع الغرف"
                          className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-orange-400 transition-colors">
                          <Home className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteUser(u)} title="حذف المستخدم"
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

        {/* ══════════════════ ROOMS ══════════════════════════════════════════ */}
        {tab === 'rooms' && (
          <div className="space-y-3">
            {/* Room chat viewer */}
            {roomChat && (
              <div className="bg-white/5 rounded-xl p-4 border border-violet-500/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-violet-400" />محادثة /{roomChat.slug}</span>
                  <button onClick={() => setRoomChat(null)} className="text-white/40 hover:text-white/70"><X className="w-4 h-4" /></button>
                </div>
                {roomChat.msgs.length === 0 ? <div className="text-white/30 text-sm">لا توجد رسائل</div> : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {roomChat.msgs.map(m => (
                      <div key={m.id} className="flex items-start gap-2 text-xs">
                        <span className="text-cyan-400 flex-shrink-0">{m.username}</span>
                        <span className="text-white/60 flex-1 break-all">{m.content}</span>
                        <span className="text-white/25 flex-shrink-0">{new Date(m.created_at).toLocaleTimeString('ar')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Playlist viewer */}
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
                        <span className="truncate flex-1">{item.title}</span>
                        <span className="text-white/30 flex-shrink-0">{item.sourceType}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} className={cn(inputCls, "flex-1")} />
              <button onClick={exportRooms} className="flex items-center gap-1 px-3 py-2 bg-green-500/20 text-green-400 rounded-xl text-xs hover:bg-green-500/30 flex-shrink-0">
                <Download className="w-3.5 h-3.5" />CSV
              </button>
            </div>
            {/* Filter chips */}
            <div className="flex gap-1.5 flex-wrap items-center">
              {(['all', 'active', 'frozen', 'public', 'private'] as RoomFilter[]).map(f => (
                <button key={f} onClick={() => setRoomFilter(f)}
                  className={cn("px-3 py-1 rounded-full text-xs transition-colors",
                    roomFilter === f ? "bg-cyan-500/30 text-cyan-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                  {f === 'all' ? `الكل (${rooms.length})` : f === 'active' ? 'نشطة' : f === 'frozen' ? 'مجمّدة' : f === 'public' ? 'عامة' : 'خاصة'}
                </button>
              ))}
              <span className="text-white/20 text-xs mr-2">|</span>
              <span className="text-xs text-white/30">فرز:</span>
              {(['date', 'name', 'active'] as RoomSort[]).map(s => (
                <button key={s} onClick={() => { if (roomSort === s) setSortAsc(p => !p); else { setRoomSort(s); setSortAsc(false); } }}
                  className={cn("px-2 py-0.5 rounded text-[10px] transition-colors flex items-center gap-0.5",
                    roomSort === s ? "bg-violet-500/20 text-violet-400" : "bg-white/5 text-white/30 hover:text-white/60")}>
                  {s === 'date' ? 'تاريخ' : s === 'name' ? 'اسم' : 'نشاط'}
                  {roomSort === s && (sortAsc ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
                </button>
              ))}
            </div>
            <div className="text-xs text-white/40">{filteredRooms.length} غرفة</div>
            <div className="space-y-2">
              {filteredRooms.map(r => (
                <div key={r.slug} className={cn("bg-white/5 rounded-xl px-4 py-3 border", r.isFrozen ? "border-blue-500/30" : "border-white/8")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{r.name}</span>
                        <button onClick={() => typeToggle(r)}
                          className={cn("text-[10px] rounded px-1.5 py-0.5 transition-colors",
                            r.type === 'public' ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30")}>
                          {r.type === 'public' ? 'عامة' : 'خاصة'}
                        </button>
                        {r.isFrozen && <span className="text-[10px] bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5">مجمّدة</span>}
                        {(r.activeUsers ?? 0) > 0 && <span className="text-[10px] text-green-400 font-semibold">{r.activeUsers} نشط</span>}
                      </div>
                      <div className="text-xs text-white/30 mt-0.5 flex items-center gap-2">
                        <span>/{r.slug}</span>
                        <span>·</span>
                        <Clock className="w-3 h-3" />
                        <span>{roomAge(r.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
                      <button onClick={() => viewPlaylist(r)} title="قائمة التشغيل" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-cyan-400 transition-colors"><List className="w-3.5 h-3.5" /></button>
                      <button onClick={() => viewChat(r)} title="عرض المحادثة" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-violet-400 transition-colors"><MessageSquare className="w-3.5 h-3.5" /></button>
                      <button onClick={() => clearChat(r)} title="مسح المحادثة" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-orange-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => clearPlaylist(r)} title="مسح قائمة التشغيل" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-red-400 transition-colors"><StopCircle className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setRenameSlug(r.slug); setRenameVal(r.name); }} title="إعادة التسمية" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setTransferSlug(r.slug); setTransferVal(''); }} title="نقل الملكية" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-violet-400 transition-colors"><Zap className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setAnnounceSlug(r.slug); setAnnounceMsg(''); }} title="إرسال إعلان" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-amber-400 transition-colors"><Bell className="w-3.5 h-3.5" /></button>
                      <button onClick={() => exportRoomChat(r.slug)} title="تصدير المحادثة CSV" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-green-400 transition-colors"><Download className="w-3.5 h-3.5" /></button>
                      <button onClick={() => forceVideo(r, 'play')} title="تشغيل إجباري" className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"><Play className="w-3.5 h-3.5" /></button>
                      <button onClick={() => forceVideo(r, 'pause')} title="إيقاف إجباري" className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"><Pause className="w-3.5 h-3.5" /></button>
                      <button onClick={() => window.open(`/room/${r.slug}`, '_blank')} title="دخول" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors"><ExternalLink className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { navigator.clipboard.writeText(`https://lrmtv.sbs/room/${r.slug}`); showFeedback('تم نسخ الرابط'); }} title="نسخ الرابط" className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={() => freezeToggle(r)} title={r.isFrozen ? 'إلغاء التجميد' : 'تجميد'}
                        className={cn("p-1.5 rounded-lg transition-colors", r.isFrozen ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                        <Snowflake className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteRoom(r)} title="حذف" className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredRooms.length === 0 && !loading && <div className="text-center text-white/30 py-10">لا توجد نتائج</div>}
            </div>
          </div>
        )}

        {/* ══════════════════ CHAT MONITOR ══════════════════════════════════ */}
        {tab === 'chat' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">آخر {globalChat.length} رسالة من جميع الغرف</span>
              <button onClick={() => load('chat')} className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />تحديث
              </button>
            </div>
            <input type="text" placeholder="بحث في الرسائل..." value={search} onChange={e => setSearch(e.target.value)} className={inputCls} />
            <div className="space-y-1.5">
              {filteredChat.map(m => (
                <div key={m.id} className={cn("flex items-start gap-2 px-3 py-2 rounded-xl border text-xs group",
                  m.type === 'system' ? "bg-white/3 border-white/5" : "bg-white/5 border-white/8")}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("font-semibold", m.type === 'system' ? "text-white/40" : "text-cyan-400")}>{m.username}</span>
                      {m.room_slug && <span className="text-white/25 text-[10px]">في /{m.room_slug}</span>}
                      <span className="text-white/20 text-[10px]">{new Date(m.created_at).toLocaleString('ar')}</span>
                    </div>
                    <p className="text-white/70 mt-0.5 break-all">{m.content}</p>
                  </div>
                  <button onClick={() => deleteMsg(m.id)} className="opacity-0 group-hover:opacity-100 p-1 text-red-400/60 hover:text-red-400 flex-shrink-0 transition-all">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {filteredChat.length === 0 && !loading && <div className="text-center text-white/30 py-10">لا توجد رسائل</div>}
            </div>
          </div>
        )}

        {/* ══════════════════ NOTIFICATIONS ══════════════════════════════════ */}
        {tab === 'notifications' && (
          <div className="space-y-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-cyan-400" />رسالة نظام لجميع الغرف النشطة</div>
              <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} placeholder="اكتب رسالة النظام..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-cyan-500/50 resize-none h-20 mb-3" />
              <button onClick={sendBroadcast} className={btnCls("bg-cyan-500 hover:bg-cyan-400 text-black")}>
                <Send className="w-4 h-4" />إرسال للكل
              </button>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-violet-400" />إشعار Push لجميع المشتركين</div>
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)} placeholder="العنوان" className={cn(inputCls, "mb-2")} />
              <input value={pushBody} onChange={e => setPushBody(e.target.value)} placeholder="النص" className={cn(inputCls, "mb-3")} />
              <button onClick={sendPushAll} className={btnCls("bg-violet-500 hover:bg-violet-400 text-white")}>
                <Bell className="w-4 h-4" />إرسال للكل
              </button>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-orange-400" />إشعار Push لمستخدم محدد</div>
              <input value={pushUserId} onChange={e => setPushUserId(e.target.value)} placeholder="ID المستخدم" type="number" className={cn(inputCls, "mb-2")} />
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)} placeholder="العنوان" className={cn(inputCls, "mb-2")} />
              <input value={pushBody} onChange={e => setPushBody(e.target.value)} placeholder="النص" className={cn(inputCls, "mb-3")} />
              <button onClick={sendPushUser} className={btnCls("bg-orange-500 hover:bg-orange-400 text-white")}>
                <Send className="w-4 h-4" />إرسال
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════ SETTINGS ═══════════════════════════════════════ */}
        {tab === 'settings' && (
          <div className="space-y-4">
            {settings ? (
              <>
                {[
                  { key: 'maintenance_mode',     label: 'وضع الصيانة',             type: 'toggle', desc: 'يمنع الوصول لغير الأدمن' },
                  { key: 'announcement',         label: 'إعلان الموقع',             type: 'text',   desc: 'يظهر في الصفحة الرئيسية' },
                  { key: 'welcome_message',      label: 'رسالة الترحيب',            type: 'text',   desc: 'تظهر في صفحة الهبوط' },
                  { key: 'max_rooms_per_user',   label: 'الحد الأقصى للغرف/مستخدم', type: 'number', desc: '' },
                  { key: 'max_room_members',     label: 'الحد الأقصى لأعضاء الغرفة', type: 'number', desc: '' },
                ].map(({ key, label, type, desc }) => (
                  <div key={key} className="bg-white/5 rounded-xl p-4 border border-white/8">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        {desc && <div className="text-xs text-white/40 mt-0.5">{desc}</div>}
                      </div>
                      {type === 'toggle' ? (
                        <button onClick={() => setEditSettings(p => ({ ...p, [key]: p[key as keyof SiteSettings] === 'true' ? 'false' : 'true' }))}
                          className={cn("w-12 h-6 rounded-full transition-colors relative flex-shrink-0",
                            editSettings[key as keyof SiteSettings] === 'true' ? "bg-cyan-500" : "bg-white/20")}>
                          <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                            editSettings[key as keyof SiteSettings] === 'true' ? "right-1" : "left-1")} />
                        </button>
                      ) : (
                        <input type={type} value={editSettings[key as keyof SiteSettings] ?? ''}
                          onChange={e => setEditSettings(p => ({ ...p, [key]: e.target.value }))}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-cyan-500/50 w-32 text-right" />
                      )}
                    </div>
                  </div>
                ))}
                <button onClick={saveSettings} className={cn(btnCls("bg-cyan-500 hover:bg-cyan-400 text-black"), "w-full justify-center py-3")}>
                  <Check className="w-4 h-4" />حفظ الإعدادات
                </button>

                {/* Word filter */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                  <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Filter className="w-4 h-4 text-orange-400" />فلتر الكلمات المحظورة</div>
                  <div className="flex gap-2 mb-3">
                    <input value={newWord} onChange={e => setNewWord(e.target.value)} placeholder="كلمة محظورة"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500/50"
                      onKeyDown={e => e.key === 'Enter' && addWord()} />
                    <button onClick={addWord} className="p-2 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg flex-shrink-0"><Plus className="w-4 h-4" /></button>
                  </div>
                  {wordFilter.length === 0 ? <p className="text-white/30 text-xs">لا توجد كلمات محظورة</p> : (
                    <div className="flex flex-wrap gap-2">
                      {wordFilter.map(w => (
                        <span key={w} className="flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs">
                          {w}
                          <button onClick={() => removeWord(w)} className="hover:text-red-300"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center text-white/30 py-10">جاري التحميل...</div>
            )}
          </div>
        )}

        {/* ══════════════════ SECURITY ═══════════════════════════════════════ */}
        {tab === 'security' && (
          <div className="space-y-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4 text-red-400" />عناوين IP المحظورة ({bannedIps.length})</div>
              <div className="flex gap-2 mb-3">
                <input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="عنوان IP"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500/50" />
                <input value={newIpReason} onChange={e => setNewIpReason(e.target.value)} placeholder="السبب"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500/50" />
                <button onClick={addBannedIp} className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg flex-shrink-0"><Plus className="w-4 h-4" /></button>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في IPs..." className={cn(inputCls, "mb-3 text-xs")} />
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filteredIps.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                    <div>
                      <span className="text-sm font-mono text-red-400">{b.ip}</span>
                      {b.reason && <span className="text-xs text-white/40 mr-2">{b.reason}</span>}
                    </div>
                    <button onClick={() => removeBannedIp(b.id)} className="p-1 text-white/30 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {filteredIps.length === 0 && <p className="text-white/30 text-sm">لا توجد IPs محظورة</p>}
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-400" />محاولات تسجيل الدخول الفاشلة ({loginAttempts.length})</div>
                <button onClick={clearLoginAttempts} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 className="w-3 h-3" />مسح القديم</button>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {loginAttempts.slice(0, 50).map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5">
                    <span className="text-white/60 flex-1 truncate">{a.identifier}</span>
                    <span className="text-white/30 font-mono flex-shrink-0">{a.ip}</span>
                    <span className="text-white/20 flex-shrink-0">{new Date(a.createdAt).toLocaleDateString('ar')}</span>
                    <button onClick={() => { setNewIp(a.ip); setNewIpReason(`محاولة تسجيل دخول: ${a.identifier}`); }} title="حظر هذا IP"
                      className="text-white/20 hover:text-red-400 flex-shrink-0"><Ban className="w-3 h-3" /></button>
                  </div>
                ))}
                {loginAttempts.length === 0 && <p className="text-white/30 text-sm">لا توجد محاولات</p>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ SYSTEM ════════════════════════════════════════ */}
        {tab === 'system' && (
          <div className="space-y-4">
            {/* Server info */}
            {systemInfo && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/8">
                <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Server className="w-4 h-4 text-cyan-400" />معلومات الخادم</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    { label: 'وقت التشغيل', value: formatUptime(systemInfo.uptime) },
                    { label: 'Node.js', value: systemInfo.node },
                    { label: 'البيئة', value: systemInfo.env },
                    { label: 'النظام', value: systemInfo.platform },
                    { label: 'RAM المستخدمة', value: `${systemInfo.memRss} MB` },
                    { label: 'Heap المستخدمة', value: `${systemInfo.memHeap} / ${systemInfo.memHeapTotal} MB` },
                    { label: 'المستخدمون النشطون', value: systemInfo.activeUsers },
                    { label: 'الغرف النشطة', value: systemInfo.activeRooms },
                    { label: 'إجمالي المستخدمين', value: systemInfo.totalUsers },
                    { label: 'إجمالي الغرف', value: systemInfo.totalRooms },
                    { label: 'إجمالي الرسائل', value: systemInfo.totalMessages?.toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-1.5 border-b border-white/5">
                      <span className="text-white/50 text-xs">{label}</span>
                      <span className="text-white/90 text-xs font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Push subscribers */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-violet-400" />مشتركو Push ({pushSubs.length})</div>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..." className={cn(inputCls, "mb-3 text-xs")} />
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filteredSubs.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs py-1">
                    <div>
                      <span className="text-white/80">@{s.username}</span>
                      <span className="text-white/30 mr-2 text-[10px]">{new Date(s.created_at).toLocaleDateString('ar')}</span>
                    </div>
                    <button onClick={() => deletePushSub(s.id)} className="text-white/20 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {filteredSubs.length === 0 && <p className="text-white/30 text-sm">لا يوجد مشتركون</p>}
              </div>
            </div>

            {/* Backup */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-green-400" />النسخ الاحتياطي</div>
              <p className="text-white/40 text-xs mb-3">تنزيل نسخة احتياطية تشمل: المستخدمين، الغرف، الإعدادات، IPs المحظورة</p>
              <button onClick={downloadBackup} className={btnCls("bg-green-500/20 text-green-400 hover:bg-green-500/30")}>
                <Download className="w-4 h-4" />تنزيل النسخة الاحتياطية
              </button>
            </div>

            {/* Activity Log */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />سجل نشاط الأدمن ({activityLog.length})</div>
                <button onClick={() => load('system')} className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1"><RefreshCw className="w-3 h-3" />تحديث</button>
              </div>
              {activityLog.length === 0 ? (
                <p className="text-white/30 text-sm">لا توجد سجلات</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {activityLog.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-white/5">
                      <Activity className="w-2.5 h-2.5 text-orange-400/60 flex-shrink-0" />
                      <span className="flex-1 text-white/70">{entry.action}</span>
                      <span className="text-white/30 flex-shrink-0">@{entry.by}</span>
                      <span className="text-white/20 flex-shrink-0">{new Date(entry.at).toLocaleString('ar')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Room Announce from System */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/8">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-amber-400" />إرسال إعلان لغرفة</div>
              <input value={sysAnnounceSlug} onChange={e => setSysAnnounceSlug(e.target.value)} placeholder="slug الغرفة"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500/50 mb-2" />
              <textarea value={sysAnnounceMsg} onChange={e => setSysAnnounceMsg(e.target.value)} rows={2}
                placeholder="نص الإعلان..." className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500/50 resize-none mb-2" />
              <button onClick={async () => {
                if (!sysAnnounceSlug.trim() || !sysAnnounceMsg.trim()) return;
                const r = await apiFetch(`/admin/rooms/${sysAnnounceSlug.trim()}/announce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: sysAnnounceMsg }) });
                if (r.ok) { showFeedback(`تم إرسال الإعلان إلى /${sysAnnounceSlug}`); setSysAnnounceSlug(''); setSysAnnounceMsg(''); }
                else showFeedback('فشل الإرسال', false);
              }} className={btnCls("bg-amber-500/20 text-amber-400 hover:bg-amber-500/30")}>
                <Send className="w-4 h-4" />إرسال
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════ REPORTS ═══════════════════════════════════════ */}
        {tab === 'reports' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Flag className="w-4 h-4 text-orange-400" />
                البلاغات
                {reports.filter(r => r.status === 'pending').length > 0 && (
                  <span className="bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {reports.filter(r => r.status === 'pending').length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setReportFilter('pending')}
                  className={cn("text-xs px-3 py-1 rounded-lg transition-colors", reportFilter === 'pending' ? "bg-orange-500/20 text-orange-400" : "bg-white/5 text-white/40 hover:text-white/70")}>
                  قيد الانتظار
                </button>
                <button onClick={() => setReportFilter('all')}
                  className={cn("text-xs px-3 py-1 rounded-lg transition-colors", reportFilter === 'all' ? "bg-white/20 text-white" : "bg-white/5 text-white/40 hover:text-white/70")}>
                  الكل
                </button>
                <button onClick={() => load('reports')} className="p-1.5 text-white/40 hover:text-white/70 rounded-lg hover:bg-white/5">
                  <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                </button>
              </div>
            </div>

            {reports.filter(r => reportFilter === 'all' || r.status === 'pending').length === 0 ? (
              <div className="text-center py-16 text-white/30 text-sm">
                <Flag className="w-8 h-8 mx-auto mb-3 opacity-30" />
                لا توجد بلاغات {reportFilter === 'pending' ? 'قيد الانتظار' : ''}
              </div>
            ) : (
              <div className="space-y-3">
                {reports
                  .filter(r => reportFilter === 'all' || r.status === 'pending')
                  .map(report => (
                    <div key={report.id} className={cn(
                      "bg-white/5 rounded-xl p-4 border space-y-3",
                      report.status === 'pending' ? "border-orange-500/20" : "border-white/8 opacity-60"
                    )}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-orange-400">{report.reportedUsername}</span>
                            <span className="text-[10px] text-white/30">←</span>
                            <span className="text-[10px] text-white/40">بلاغ من: {report.reporterUsername}</span>
                            {report.roomSlug && (
                              <span className="text-[10px] bg-white/5 text-white/30 rounded px-1.5 py-0.5">#{report.roomSlug}</span>
                            )}
                            <span className={cn("text-[10px] rounded px-1.5 py-0.5",
                              report.status === 'pending' ? "bg-orange-500/15 text-orange-400" :
                              report.status === 'resolved' ? "bg-green-500/15 text-green-400" :
                              "bg-white/10 text-white/30"
                            )}>
                              {report.status === 'pending' ? 'قيد الانتظار' : report.status === 'resolved' ? 'تم الحل' : 'مرفوض'}
                            </span>
                          </div>
                          <div className="mt-1.5 text-xs text-white/30">
                            السبب: <span className="text-white/50">{
                              report.reason === 'abuse' ? 'إساءة / شتم' :
                              report.reason === 'spam' ? 'سبام' :
                              report.reason === 'inappropriate' ? 'محتوى غير لائق' :
                              report.reason === 'harassment' ? 'تحرش / مضايقة' : 'أخرى'
                            }</span>
                            <span className="mr-2 text-white/20">{new Date(report.createdAt).toLocaleString('ar')}</span>
                          </div>
                          {report.messageContent && (
                            <div className="mt-2 px-3 py-2 bg-black/30 rounded-lg text-xs text-white/60 border border-white/5 break-all">
                              "{report.messageContent}"
                            </div>
                          )}
                          {report.reviewedBy && (
                            <div className="mt-1 text-[10px] text-white/20">راجعه: {report.reviewedBy}</div>
                          )}
                        </div>
                        <button onClick={() => deleteReport(report.id)} className="p-1 text-white/20 hover:text-red-400 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {report.status === 'pending' && (
                        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/5">
                          <button onClick={() => reviewReport(report.id, 'kick')}
                            className="text-xs px-3 py-1.5 bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 rounded-lg transition-colors flex items-center gap-1">
                            <UserX className="w-3 h-3" />طرد
                          </button>
                          <button onClick={() => reviewReport(report.id, 'mute')}
                            className="text-xs px-3 py-1.5 bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 rounded-lg transition-colors flex items-center gap-1">
                            <VolumeX className="w-3 h-3" />كتم
                          </button>
                          <button onClick={() => reviewReport(report.id, 'ban')}
                            className="text-xs px-3 py-1.5 bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-lg transition-colors flex items-center gap-1">
                            <Ban className="w-3 h-3" />حظر
                          </button>
                          <button onClick={() => reviewReport(report.id, 'dismiss')}
                            className="text-xs px-3 py-1.5 bg-white/5 text-white/40 hover:bg-white/10 rounded-lg transition-colors flex items-center gap-1 mr-auto">
                            <X className="w-3 h-3" />تجاهل
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
