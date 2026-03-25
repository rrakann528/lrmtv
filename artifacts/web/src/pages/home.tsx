import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Users, User, Users2, LogIn } from 'lucide-react';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { Avatar } from '@/components/avatar';
import { RoomsTab } from './home/rooms-tab';
import { FriendsTab } from './home/friends-tab';
import { GroupsTab } from './home/groups-tab';
import { ProfileTab } from './home/profile-tab';
import { NotifBanner } from '@/components/notif-banner';
import { useQuery } from '@tanstack/react-query';
import { useUserSocket } from '@/hooks/use-user-socket';
import { useI18n } from '@/lib/i18n';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

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
    refetchInterval: 20_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

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
        {user ? (
          <button onClick={() => setActiveTab('profile')}>
            <Avatar name={userName} color={user.avatarColor} url={user.avatarUrl} size={32} />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <a
              href={`${BASE}/api/auth/google`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-gray-700 text-xs font-semibold shadow-sm hover:bg-gray-100 transition-colors"
            >
              <GoogleIcon size={14} />
              Google
            </a>
            <button
              onClick={() => setLocation('/auth?mode=login')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              {t('loginBtn')}
            </button>
          </div>
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

function GuestProfilePrompt({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
        <User className="w-10 h-10 text-muted-foreground" />
      </div>
      <div>
        <h3 className="font-bold text-foreground text-lg mb-1">{t('youAreGuest')}</h3>
        <p className="text-muted-foreground text-sm">{t('loginToManageProfile')}</p>
      </div>
      <button onClick={onLogin} className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl font-bold">
        {t('loginBtn')}
      </button>
    </div>
  );
}
