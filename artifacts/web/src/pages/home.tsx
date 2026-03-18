import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Users, User } from 'lucide-react';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { Avatar } from '@/components/avatar';
import { RoomsTab } from './home/rooms-tab';
import { FriendsTab } from './home/friends-tab';
import { ProfileTab } from './home/profile-tab';
import { NotifBanner } from '@/components/notif-banner';
import { useQuery } from '@tanstack/react-query';
import { useUserSocket } from '@/hooks/use-user-socket';
import AdBanner from '@/components/ad-banner';

type Tab = 'rooms' | 'friends' | 'profile';

const TABS: { id: Tab; label: string; Icon: typeof Tv }[] = [
  { id: 'rooms',   label: 'الغرف',    Icon: Tv },
  { id: 'friends', label: 'الأصدقاء', Icon: Users },
  { id: 'profile', label: 'حسابي',    Icon: User },
];

const HEADER_H  = 56;
const NAV_H     = 64;
const AD_BAR_H  = 60;

export default function HomePage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const isGuest = params.get('guest') === '1';

  const { user, loading } = useAuth();
  const tabParam = params.get('tab') as Tab | null;
  const validTabs: Tab[] = ['rooms', 'friends', 'profile'];
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
    if (!loading && !user && !isGuest) setLocation('/');
  }, [user, loading, isGuest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const userName = user?.displayName || user?.username || 'زائر';

  return (
    <div className="bg-background" style={{ minHeight: '100dvh', minWidth: '100vw' }}>
      {/* ── Fixed Header ─────────────────────────────────────────── */}
      <div
        className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 bg-card border-b border-border"
        style={{ height: HEADER_H }}
      >
        <div className="flex items-center gap-2">
          <Tv className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg text-foreground tracking-tight">LrmTV</span>
        </div>
        {user ? (
          <button onClick={() => setActiveTab('profile')}>
            <Avatar name={userName} color={user.avatarColor} url={user.avatarUrl} size={36} />
          </button>
        ) : (
          <button
            onClick={() => setLocation('/auth?mode=login')}
            className="text-xs font-semibold text-primary"
          >
            تسجيل الدخول
          </button>
        )}
      </div>

      {/* ── Scrollable content between header and nav ────────────── */}
      <div
        className="overflow-hidden"
        style={{
          position: 'fixed',
          top: HEADER_H,
          left: 0,
          right: 0,
          bottom: `calc(${NAV_H + AD_BAR_H}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
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
            {activeTab === 'profile' && (
              user
                ? <ProfileTab />
                : <GuestProfilePrompt onLogin={() => setLocation('/auth?mode=login')} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Ad Bar (above bottom nav) ─────────────────────────────── */}
      <AdBanner bottom={NAV_H} />

      {/* ── Fixed Bottom Navigation ───────────────────────────────── */}
      <div
        className="fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border"
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
                className="flex flex-col items-center justify-center gap-1 flex-1 py-1"
              >
                <motion.div
                  className="relative"
                  animate={{ scale: active ? 1.12 : 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <Icon
                    className={`w-6 h-6 ${active ? 'text-primary' : 'text-muted-foreground'}`}
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

      {/* ── Push Notification Banner ───────────────────────────────── */}
      {user && <NotifBanner userId={user.id} />}
    </div>
  );
}

function GuestProfilePrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
        <User className="w-10 h-10 text-muted-foreground" />
      </div>
      <div>
        <h3 className="font-bold text-foreground text-lg mb-1">أنت زائر</h3>
        <p className="text-muted-foreground text-sm">سجّل دخولك لإدارة ملفك الشخصي</p>
      </div>
      <button onClick={onLogin} className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl font-bold">
        تسجيل الدخول
      </button>
    </div>
  );
}
