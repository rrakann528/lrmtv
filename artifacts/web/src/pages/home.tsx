import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Users, User, Users2, UserPlus, MessageCircle, Lock, Globe, Check } from 'lucide-react';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { Avatar } from '@/components/avatar';
import { RoomsTab } from './home/rooms-tab';
import { FriendsTab } from './home/friends-tab';
import { GroupsTab } from './home/groups-tab';
import { ProfileTab } from './home/profile-tab';
import { NotifBanner } from '@/components/notif-banner';
import { useQuery } from '@tanstack/react-query';
import { useUserSocket } from '@/hooks/use-user-socket';
import { useI18n, LANGUAGES } from '@/lib/i18n';

type Tab = 'rooms' | 'friends' | 'groups' | 'profile';

const HEADER_H  = 48;
const NAV_H     = 56;

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const isEditable = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    };

    const update = () => {
      const diff = window.innerHeight - vv.height;
      setOpen(diff > 80 && isEditable());
    };

    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return open;
}

export default function HomePage() {
  const { t } = useI18n();
  const keyboardOpen = useKeyboardOpen();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const isGuest = params.get('guest') === '1';

  const TABS: { id: Tab; label: string; Icon: typeof Tv }[] = [
    { id: 'rooms',   label: t('tabRooms'),   Icon: Tv },
    { id: 'friends', label: t('tabFriends'), Icon: Users },
    { id: 'groups',  label: t('tabGroups'),  Icon: Users2 },
    { id: 'profile', label: t('tabProfile'), Icon: User },
  ];

  const { user, loading } = useAuth();
  const tabParam = params.get('tab') as Tab | null;
  const validTabs: Tab[] = ['rooms', 'friends', 'groups', 'profile'];
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && validTabs.includes(tabParam) ? tabParam : 'rooms'
  );

  // React to URL ?tab= changes (e.g. from push notification navigation)
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const [acceptedToast, setAcceptedToast] = useState<string | null>(null);

  const handleFriendAccepted = useCallback((data: { byId: number; byName: string }) => {
    setAcceptedToast(data.byName);
    setTimeout(() => setAcceptedToast(null), 4000);
  }, []);

  const handleFriendRequest = useCallback(() => {
    setActiveTab('friends');
  }, []);

  useUserSocket({
    userId: user?.id,
    onFriendRequest: handleFriendRequest,
    onFriendAccepted: handleFriendAccepted,
  });

  // Badge: pending friend requests + unread DMs
  const { data: friendsBadge = 0 } = useQuery<number>({
    queryKey: ['friends-badge'],
    queryFn: async () => {
      const [fr, cv] = await Promise.all([
        apiFetch('/friends').then(r => r.json()).catch(() => []),
        apiFetch('/friends/conversations').then(r => r.json()).catch(() => []),
      ]);
      const pending = Array.isArray(fr) ? fr.filter((f: { status: string }) => f.status === 'pending_received').length : 0;
      const unread  = Array.isArray(cv) ? cv.reduce((s: number, c: { unreadCount: number }) => s + (c.unreadCount || 0), 0) : 0;
      return pending + unread;
    },
    enabled: !!user,
    refetchInterval: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Badge: unread group messages (groups with new messages since last seen)
  const { data: groupsBadge = 0 } = useQuery<number>({
    queryKey: ['groups-badge'],
    queryFn: async () => {
      const since = localStorage.getItem('lrmtv_groups_last_seen') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const data = await apiFetch(`/groups/badge?since=${encodeURIComponent(since)}`).then(r => r.json()).catch(() => ({ count: 0 }));
      return data.count || 0;
    },
    enabled: !!user,
    refetchInterval: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Clear groups badge when groups tab is active
  useEffect(() => {
    if (activeTab === 'groups') {
      localStorage.setItem('lrmtv_groups_last_seen', new Date().toISOString());
    }
  }, [activeTab]);

  // Badge: pending room invites
  const { data: roomsBadge = 0 } = useQuery<number>({
    queryKey: ['rooms-badge'],
    queryFn: () => apiFetch('/invites/badge').then(r => r.json()).catch(() => 0),
    enabled: !!user,
    refetchInterval: 20_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!loading && !user && !isGuest && window.location.pathname.endsWith('/home')) {
      setLocation('/');
    }
  }, [user, loading, isGuest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const userName = user?.displayName || user?.username || t('guestName');

  return (
    <div className="bg-background flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 bg-card border-b border-border flex-shrink-0 z-30"
        style={{ height: HEADER_H }}
      >
        <div className="flex items-center gap-1.5">
          <img src="/icon-512.png" alt="LrmTV" className="w-7 h-7 rounded-lg" />
          <span className="font-bold text-base text-foreground tracking-tight">LrmTV</span>
        </div>
        {user && (
          <button onClick={() => setActiveTab('profile')}>
            <Avatar name={userName} color={user.avatarColor} url={user.avatarUrl} size={32} />
          </button>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'rooms'   && <RoomsTab />}
            {activeTab === 'friends' && <FriendsTab acceptedToast={acceptedToast} onDismissAcceptedToast={() => setAcceptedToast(null)} />}
            {activeTab === 'groups'  && <GroupsTab />}
            {activeTab === 'profile' && (
              user
                ? <ProfileTab />
                : <GuestProfilePrompt onLogin={() => setLocation('/auth?mode=login')} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Bottom Navigation ───────────────────────────────── */}
      {!keyboardOpen && (
        <div
          className="flex-shrink-0 bg-card border-t border-border z-30"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-center justify-around px-2" style={{ height: NAV_H }}>
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              const badge = id === 'friends' && !active ? friendsBadge
                          : id === 'rooms'   && !active ? roomsBadge
                          : id === 'groups'  && !active ? groupsBadge
                          : 0;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className="flex flex-col items-center justify-center gap-0.5 flex-1 py-0.5"
                >
                  <motion.div
                    className="relative"
                    animate={{ scale: active ? 1.12 : 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <Icon
                      className={`w-5 h-5 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                      strokeWidth={active ? 2.5 : 1.8}
                    />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shadow-sm">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </motion.div>
                  <span className={`text-[10px] font-medium ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Push Notification Banner ───────────────────────────────── */}
      {user && <NotifBanner userId={user.id} />}
    </div>
  );
}

const GUEST_CAN = [
  { icon: Tv,             ar: 'شاهد الفيديوهات في غرف عامة',      en: 'Watch videos in public rooms' },
  { icon: Globe,          ar: 'اختر لغة الواجهة من 6 لغات',         en: 'Choose from 6 interface languages' },
];

const MEMBER_GETS = [
  { ar: 'أنشئ غرفك الخاصة وادعُ من تريد',        en: 'Create private rooms & invite friends' },
  { ar: 'تحدث في الدردشة داخل الغرفة',            en: 'Chat inside any room' },
  { ar: 'شغّل المايك والتحدث صوتياً مع الآخرين',  en: 'Use your mic for voice chat with others' },
  { ar: 'أضف أصدقاء وأرسل رسائل خاصة',          en: 'Add friends & send private messages' },
  { ar: 'انشئ مجموعات ومجتمعات',                  en: 'Create groups & communities' },
  { ar: 'صلاحيات DJ للتحكم الكامل بالغرفة',       en: 'DJ controls for full room management' },
  { ar: 'شخصّ حسابك بصورة واسم مستخدم فريد',     en: 'Personalize your profile with avatar & username' },
];

function GuestProfilePrompt({ onLogin }: { onLogin: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [, setLocation] = useLocation();
  const isAr = lang === 'ar';

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="flex flex-col gap-4 px-4 py-6 pb-10">

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
            <Tv className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">LrmTV</h2>
          <p className="text-muted-foreground text-xs leading-relaxed max-w-xs">
            {isAr ? 'منصة مشاهدة جماعية مجانية — شاهد مع أصدقائك بتزامن تلقائي من أي مكان في العالم'
                  : 'Free group watching platform — watch with friends in real-time sync from anywhere'}
          </p>
        </div>

        {/* As guest you can */}
        <div className="bg-card border border-border rounded-2xl p-4" dir={isAr ? 'rtl' : 'ltr'}>
          <p className="text-xs font-semibold text-muted-foreground mb-3">
            {isAr ? '✅ كزائر يمكنك' : '✅ As a guest you can'}
          </p>
          <div className="flex flex-col gap-2.5">
            {GUEST_CAN.map(({ icon: Icon, ar, en }) => (
              <div key={ar} className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-sm text-foreground/80">{isAr ? ar : en}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Member benefits */}
        <div className="bg-primary/5 border border-primary/15 rounded-2xl p-4" dir={isAr ? 'rtl' : 'ltr'}>
          <p className="text-xs font-semibold text-primary mb-3">
            {isAr ? '🚀 بالتسجيل تحصل على' : '🚀 With an account you get'}
          </p>
          <div className="flex flex-col gap-2">
            {MEMBER_GETS.map(({ ar, en }) => (
              <div key={ar} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-xs text-foreground/70">{isAr ? ar : en}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2.5">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onLogin}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/25"
          >
            <User className="w-4 h-4" />
            {t('loginBtn')}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/auth?mode=register')}
            className="w-full py-3.5 bg-card border border-border text-foreground rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {isAr ? 'إنشاء حساب جديد' : 'Create new account'}
          </motion.button>
        </div>

        {/* Language selector */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <p className="text-xs text-muted-foreground px-4 pt-3 pb-2">{t('interfaceLanguage')}</p>
          <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                  lang === l.code
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="text-xl leading-none">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Links */}
        <div className="flex items-center justify-center flex-wrap gap-3 text-xs text-muted-foreground/50 pb-2">
          <button onClick={() => setLocation('/about')} className="hover:text-muted-foreground transition">
            {isAr ? 'عن الموقع' : 'About'}
          </button>
          <span className="text-white/20">·</span>
          <button onClick={() => setLocation('/faq')} className="hover:text-muted-foreground transition">
            {isAr ? 'أسئلة شائعة' : 'FAQ'}
          </button>
          <span className="text-white/20">·</span>
          <button onClick={() => setLocation('/terms')} className="hover:text-muted-foreground transition">
            {t('terms')}
          </button>
          <span className="text-white/20">·</span>
          <button onClick={() => setLocation('/privacy')} className="hover:text-muted-foreground transition">
            {t('privacy')}
          </button>
        </div>
        <p className="text-center text-white/20 text-xs">© 2026 LrmTV</p>
      </div>
    </div>
  );
}

