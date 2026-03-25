import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Users, User, Users2 } from 'lucide-react';
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
