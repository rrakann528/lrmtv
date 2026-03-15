import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, UserPlus, MessageCircle, UserMinus, BellOff, Bell, Check, Clock, UserCheck,
  Calendar, UserX,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useI18n } from '@/lib/i18n';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface UserProfile {
  id: number;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  createdAt: string;
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted';
  friendshipId?: number;
  muted?: boolean;
}

interface Props {
  userId?: number;
  username?: string;
  onClose: () => void;
  onChat?: (friend: { id: number; username: string; displayName: string | null; avatarColor: string; avatarUrl: string | null }) => void;
}

function formatJoinDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { year: 'numeric', month: 'long' });
  } catch {
    return d.getFullYear().toString();
  }
}

/* Deterministic color from a string */
const PALETTE = ['#06B6D4','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#3B82F6','#F97316','#84CC16','#E879F9'];
function stringColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return PALETTE[Math.abs(h) % PALETTE.length]; }

export function UserProfileSheet({ userId, username, onClose, onChat }: Props) {
  const { user: me } = useAuth();
  const { lang } = useI18n();
  const qc = useQueryClient();

  const queryKey = userId ? ['user-profile', userId] : ['user-profile-name', username];
  const queryUrl = userId ? `/users/${userId}` : `/users/by-username/${encodeURIComponent(username ?? '')}`;

  const { data: profile, isLoading, isError } = useQuery<UserProfile>({
    queryKey,
    queryFn: () => apiFetch(queryUrl).then(async r => {
      if (!r.ok) throw new Error('not_found');
      return r.json();
    }),
    enabled: !!(userId || username),
    retry: false,
  });

  const isSelf = me?.id === profile?.id;

  const requestMut  = useMutation({ mutationFn: () => apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ addresseeId: profile?.id }) }), onSuccess: () => qc.invalidateQueries({ queryKey }) });
  const respondMut  = useMutation({ mutationFn: (action: 'accepted' | 'rejected') => apiFetch(`/friends/${profile!.friendshipId}`, { method: 'PATCH', body: JSON.stringify({ action }) }), onSuccess: () => { qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: ['friends'] }); } });
  const removeMut   = useMutation({ mutationFn: () => apiFetch(`/friends/${profile!.friendshipId}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: ['friends'] }); } });
  const muteMut     = useMutation({ mutationFn: () => apiFetch(`/friends/${profile?.id}/mute`, { method: profile?.muted ? 'DELETE' : 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: ['friends'] }); } });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const displayName = profile?.displayName || profile?.username || username || '';
  const avatarColor = profile?.avatarColor || stringColor(username ?? 'user');
  const joinDate    = formatJoinDate(profile?.createdAt, lang);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative w-full bg-zinc-900 rounded-t-3xl z-10 overflow-hidden max-h-[90vh] flex flex-col shadow-2xl"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>

        {/* Close */}
        <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20 transition-colors z-10">
          <X className="w-4 h-4" />
        </button>

        <div className="overflow-y-auto flex-1">

          {/* ── Loading ───────────────────────────────────── */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-white/40">{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
            </div>
          )}

          {/* ── Error state for registered user (userId provided but API failed) ─ */}
          {!isLoading && (isError || !profile) && userId && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-sm text-white/40">{lang === 'ar' ? 'تعذّر تحميل الملف الشخصي' : 'Could not load profile'}</p>
            </div>
          )}

          {/* ── Guest user (no account / not found) ───────── */}
          {!isLoading && (isError || !profile) && !userId && username && (
            <>
              <div
                className="relative pt-10 pb-6 px-6 flex flex-col items-center text-center"
                style={{ background: `linear-gradient(160deg, ${stringColor(username)}18 0%, transparent 60%)`, borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="rounded-full p-[3px] mb-4" style={{ background: `linear-gradient(135deg, ${stringColor(username)}, ${stringColor(username)}66)` }}>
                  <div className="rounded-full overflow-hidden border-2 border-zinc-900">
                    <Avatar name={username} color={stringColor(username)} size={88} />
                  </div>
                </div>
                <h2 className="text-xl font-bold text-white">{username}</h2>
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs bg-white/8 text-white/40 px-3 py-1.5 rounded-full border border-white/10">
                  <UserX className="w-3 h-3" />
                  {lang === 'ar' ? 'مستخدم ضيف' : 'Guest User'}
                </span>
              </div>
              <p className="text-center text-xs text-white/30 py-6 px-6">
                {lang === 'ar' ? 'هذا المستخدم غير مسجّل في المنصة ولا يمكن إضافته كصديق' : 'This user is not registered and cannot be added as a friend.'}
              </p>
              <div className="pb-8" />
            </>
          )}

          {/* ── Registered profile ────────────────────────── */}
          {!isLoading && profile && (
            <>
              {/* Header with gradient */}
              <div
                className="relative pt-10 pb-6 px-6 flex flex-col items-center text-center"
                style={{
                  background: `linear-gradient(160deg, ${avatarColor}22 0%, transparent 65%)`,
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {/* Avatar ring */}
                <div className="rounded-full p-[3px] mb-4" style={{ background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}55)` }}>
                  <div className="rounded-full overflow-hidden border-2 border-zinc-900">
                    <Avatar name={displayName} color={avatarColor} url={profile.avatarUrl} size={88} />
                  </div>
                </div>

                {/* Name */}
                <h2 className="text-xl font-bold text-white leading-tight">
                  {displayName || (lang === 'ar' ? 'مستخدم' : 'User')}
                </h2>

                {/* Username (if different from display name) */}
                {profile.username && profile.displayName && (
                  <p className="text-sm text-white/40 mt-0.5">@{profile.username}</p>
                )}
                {profile.username && !profile.displayName && (
                  <p className="text-sm text-white/40 mt-0.5">@{profile.username}</p>
                )}

                {/* Status badges */}
                {isSelf && (
                  <span className="mt-2 inline-flex items-center gap-1.5 text-xs bg-primary/15 text-primary px-3 py-1.5 rounded-full border border-primary/25 font-semibold">
                    {lang === 'ar' ? 'أنت' : 'You'}
                  </span>
                )}
                {!isSelf && profile.friendshipStatus === 'accepted' && (
                  <span className="mt-2 inline-flex items-center gap-1.5 text-xs bg-green-500/15 text-green-400 px-3 py-1.5 rounded-full border border-green-500/20 font-semibold">
                    <UserCheck className="w-3.5 h-3.5" />
                    {lang === 'ar' ? 'صديق' : 'Friend'}
                  </span>
                )}
                {!isSelf && profile.friendshipStatus === 'pending_sent' && (
                  <span className="mt-2 inline-flex items-center gap-1.5 text-xs bg-white/8 text-white/50 px-3 py-1.5 rounded-full border border-white/10 font-semibold">
                    <Clock className="w-3.5 h-3.5" />
                    {lang === 'ar' ? 'تم إرسال الطلب' : 'Request Sent'}
                  </span>
                )}

                {/* Bio */}
                {profile.bio && (
                  <p className="mt-3 text-sm text-white/70 leading-relaxed max-w-xs" dir="auto">
                    {profile.bio}
                  </p>
                )}
                {!profile.bio && isSelf && (
                  <p className="mt-3 text-xs text-white/25 italic">
                    {lang === 'ar' ? 'لم تُضف نبذة بعد' : 'No bio yet'}
                  </p>
                )}

                {/* Join date */}
                {joinDate && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-white/30">
                    <Calendar className="w-3 h-3" />
                    <span>{lang === 'ar' ? `انضم في ${joinDate}` : `Joined ${joinDate}`}</span>
                  </div>
                )}
              </div>

              {/* ── Action buttons ───────────────────────────── */}
              {!isSelf && (
                <div className="px-4 py-4 space-y-2.5">

                  {/* Add friend */}
                  {profile.friendshipStatus === 'none' && (
                    <button
                      onClick={() => requestMut.mutate()}
                      disabled={requestMut.isPending}
                      className="w-full flex items-center justify-center gap-2.5 py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
                    >
                      {requestMut.isPending
                        ? <div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
                        : <UserPlus className="w-4 h-4" />}
                      {lang === 'ar' ? 'إضافة صديق' : 'Add Friend'}
                    </button>
                  )}

                  {/* Accept / Decline */}
                  {profile.friendshipStatus === 'pending_received' && (
                    <>
                      <p className="text-center text-xs text-white/40 pb-1">{lang === 'ar' ? 'أرسل لك طلب صداقة' : 'Sent you a friend request'}</p>
                      <div className="flex gap-2">
                        <button onClick={() => respondMut.mutate('accepted')} disabled={respondMut.isPending} className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-green-500/20 text-green-400 rounded-2xl font-semibold text-sm border border-green-500/20 active:scale-[0.98] transition-transform">
                          <Check className="w-4 h-4" />{lang === 'ar' ? 'قبول' : 'Accept'}
                        </button>
                        <button onClick={() => respondMut.mutate('rejected')} disabled={respondMut.isPending} className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-red-500/10 text-red-400 rounded-2xl font-semibold text-sm border border-red-500/20 active:scale-[0.98] transition-transform">
                          <X className="w-4 h-4" />{lang === 'ar' ? 'رفض' : 'Decline'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* Friend actions */}
                  {profile.friendshipStatus === 'accepted' && (
                    <>
                      {onChat && (
                        <button onClick={() => { onChat(profile); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3.5 bg-primary/15 text-primary rounded-2xl font-semibold text-sm border border-primary/20 active:scale-[0.98] transition-transform">
                          <MessageCircle className="w-4 h-4" />
                          {lang === 'ar' ? 'إرسال رسالة' : 'Send Message'}
                        </button>
                      )}
                      <button onClick={() => muteMut.mutate()} disabled={muteMut.isPending} className="w-full flex items-center gap-3 px-4 py-3.5 bg-white/5 text-white/80 rounded-2xl font-semibold text-sm border border-white/8 active:scale-[0.98] transition-transform">
                        {profile.muted ? <Bell className="w-4 h-4 text-green-400" /> : <BellOff className="w-4 h-4 text-amber-400" />}
                        {profile.muted ? (lang === 'ar' ? 'إلغاء كتم الإشعارات' : 'Unmute') : (lang === 'ar' ? 'كتم الإشعارات' : 'Mute Notifications')}
                      </button>
                      <button onClick={() => removeMut.mutate()} disabled={removeMut.isPending} className="w-full flex items-center gap-3 px-4 py-3.5 bg-red-500/8 text-red-400 rounded-2xl font-semibold text-sm border border-red-500/15 active:scale-[0.98] transition-transform">
                        <UserMinus className="w-4 h-4" />
                        {lang === 'ar' ? 'إزالة من الأصدقاء' : 'Remove Friend'}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="pb-10" />
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
