import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users2, X, Trash2, UserPlus, Crown, LogOut, ChevronRight, ChevronLeft, Send, MessageCircle, Settings, Search, Globe, Lock, Loader2, Bell, Check, Palette, Pencil } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { io, Socket } from 'socket.io-client';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  avatarColor: string;
  creatorId: number;
  role: string;
  memberCount: number;
}

interface GroupMember {
  id: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  role: string;
}

interface GroupDetail {
  id: number;
  name: string;
  description: string | null;
  avatarColor: string;
  creatorId: number;
  isPrivate: boolean;
  myRole: string;
  members: GroupMember[];
}

interface GroupMsg {
  id: number;
  groupId: number;
  senderId: number;
  content: string;
  createdAt: string;
  senderUsername: string;
  senderDisplayName: string | null;
  senderAvatarColor: string;
  senderAvatarUrl: string | null;
}

interface GroupInvite {
  id: number;
  groupId: number;
  inviterId: number;
  groupName: string;
  groupAvatarColor: string;
  inviterUsername: string;
  inviterDisplayName: string | null;
  inviterAvatarColor: string;
  inviterAvatarUrl: string | null;
  createdAt: string;
}

const GROUP_COLORS = ['#8B5CF6', '#EC4899', '#06B6D4', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#F97316'];

export function GroupsTab() {
  const { user } = useAuth();
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupColor, setGroupColor] = useState('#8B5CF6');
  const [groupIsPrivate, setGroupIsPrivate] = useState(true);
  const [createErr, setCreateErr] = useState('');
  const [view, setView] = useState<'my' | 'discover'>('my');

  const { data: groups = [], isLoading } = useQuery<GroupSummary[]>({
    queryKey: ['groups'],
    queryFn: () => apiFetch('/groups').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const { data: pendingInvites = [] } = useQuery<GroupInvite[]>({
    queryKey: ['group-invitations'],
    queryFn: () => apiFetch('/group-invitations').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!user,
    refetchInterval: 10_000,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName, description: groupDesc, avatarColor: groupColor, isPrivate: groupIsPrivate }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed');
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['public-groups'] });
      setShowCreate(false);
      setGroupName('');
      setGroupDesc('');
      setGroupIsPrivate(true);
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const Arrow = dir === 'rtl' ? ChevronLeft : ChevronRight;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Users2 className="w-12 h-12 opacity-30" />
        <p className="text-sm">{t('loginToManageProfile')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="wait">
        {selectedGroupId ? (
          <GroupDetailView
            key={selectedGroupId}
            groupId={selectedGroupId}
            onBack={() => setSelectedGroupId(null)}
          />
        ) : (
          <motion.div
            key="list"
            className="flex flex-col h-full relative"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-lg font-bold text-foreground">{t('groups')}</h2>
              <p className="text-xs text-muted-foreground">{t('groupsDesc')}</p>
            </div>

            <div className="flex mx-4 mb-3 bg-muted/40 rounded-xl p-1">
              <button
                onClick={() => setView('my')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all ${view === 'my' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                <Users2 className="w-3.5 h-3.5" />
                {t('myGroups')}
              </button>
              <button
                onClick={() => setView('discover')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all ${view === 'discover' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                <Globe className="w-3.5 h-3.5" />
                {t('discoverGroups')}
              </button>
            </div>

            {view === 'my' ? (
              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
                {pendingInvites.length > 0 && (
                  <PendingInvitesSection invites={pendingInvites} onAccepted={(gId) => setSelectedGroupId(gId)} />
                )}
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 bg-muted/40 rounded-2xl animate-pulse" />
                  ))
                ) : groups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Users2 className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">{t('noGroups')}</p>
                    <p className="text-xs mt-1 opacity-60">{t('createFirstGroup')}</p>
                  </div>
                ) : (
                  groups.map((group, i) => (
                    <motion.button
                      key={group.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => setSelectedGroupId(group.id)}
                      className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl p-3.5 text-start"
                    >
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                        style={{ backgroundColor: group.avatarColor + '33', color: group.avatarColor }}
                      >
                        {group.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-sm text-foreground truncate">{group.name}</p>
                          {group.role === 'admin' && <Crown className="w-3 h-3 text-yellow-500 flex-shrink-0" />}
                          {(group as any).isPrivate === false && <Globe className="w-3 h-3 text-cyan-500 flex-shrink-0" />}
                          {(group as any).isPrivate !== false && <Lock className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {group.memberCount} {t('members')}
                        </p>
                      </div>
                      <Arrow className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </motion.button>
                  ))
                )}
              </div>
            ) : (
              <DiscoverGroupsView onSelectGroup={setSelectedGroupId} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!selectedGroupId && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowCreate(true)}
          className="absolute left-4 bottom-4 z-[50] w-14 h-14 bg-violet-600 rounded-full shadow-xl shadow-violet-600/40 flex items-center justify-center"
        >
          <Plus className="w-7 h-7 text-white" />
        </motion.button>
      )}

      {createPortal(
        <AnimatePresence>
          {showCreate && (
            <motion.div
              className="fixed inset-0 z-[200] flex items-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
              <motion.div
                className="relative w-full bg-card rounded-t-3xl p-6 z-10"
                style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom, 0px))' }}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              >
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg font-bold text-foreground">{t('createGroup')}</h3>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-muted/50">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {createErr && (
                  <div className="mb-3 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-xs">{createErr}</div>
                )}
                <div className="space-y-3">
                  <input
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder={t('groupNamePlaceholder')}
                    maxLength={60}
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <textarea
                    value={groupDesc}
                    onChange={e => setGroupDesc(e.target.value)}
                    placeholder={t('groupDescPlaceholder')}
                    maxLength={200}
                    rows={2}
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <div className="flex gap-2 justify-center py-1">
                    {GROUP_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setGroupColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-8 h-8 rounded-full transition-transform ${groupColor === c ? 'scale-110 ring-2 ring-white/50' : ''}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2 p-1 bg-muted/30 rounded-xl">
                    <button
                      onClick={() => setGroupIsPrivate(true)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${groupIsPrivate ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {t('privateGroup')}
                    </button>
                    <button
                      onClick={() => setGroupIsPrivate(false)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${!groupIsPrivate ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {t('publicGroup')}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-center">
                    {groupIsPrivate ? t('privateGroupDesc') : t('publicGroupDesc')}
                  </p>
                  <button
                    onClick={() => { setCreateErr(''); createMut.mutate(); }}
                    disabled={!groupName.trim() || createMut.isPending}
                    className="w-full py-3.5 bg-violet-600 text-white rounded-2xl font-bold text-base disabled:opacity-40"
                  >
                    {createMut.isPending ? '...' : t('createGroup')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function PendingInvitesSection({ invites, onAccepted }: { invites: GroupInvite[]; onAccepted: (groupId: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [processingId, setProcessingId] = useState<number | null>(null);

  const handleAction = async (invId: number, action: 'accept' | 'reject', groupId?: number) => {
    setProcessingId(invId);
    try {
      const r = await apiFetch(`/group-invitations/${invId}/${action}`, { method: 'POST' });
      if (r.ok) {
        qc.invalidateQueries({ queryKey: ['group-invitations'] });
        qc.invalidateQueries({ queryKey: ['groups'] });
        if (action === 'accept' && groupId) onAccepted(groupId);
      }
    } catch {}
    setProcessingId(null);
  };

  return (
    <div className="space-y-2 mb-3">
      <div className="flex items-center gap-2 px-1">
        <Bell className="w-3.5 h-3.5 text-amber-500" />
        <p className="text-xs font-semibold text-foreground">{t('pendingInvites')} ({invites.length})</p>
      </div>
      {invites.map(inv => (
        <motion.div
          key={inv.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-3"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base flex-shrink-0"
            style={{ backgroundColor: inv.groupAvatarColor + '33', color: inv.groupAvatarColor }}
          >
            {inv.groupName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{inv.groupName}</p>
            <p className="text-[11px] text-muted-foreground">
              {t('invitedBy')} {inv.inviterDisplayName || inv.inviterUsername}
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleAction(inv.id, 'accept', inv.groupId)}
              disabled={processingId === inv.id}
              className="w-8 h-8 rounded-full bg-green-500/15 text-green-500 flex items-center justify-center hover:bg-green-500/25 transition disabled:opacity-50"
            >
              {processingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              onClick={() => handleAction(inv.id, 'reject')}
              disabled={processingId === inv.id}
              className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

interface PublicGroup {
  id: number;
  name: string;
  description: string | null;
  avatarColor: string;
  memberCount: number;
  isMember: boolean;
}

function DiscoverGroupsView({ onSelectGroup }: { onSelectGroup: (id: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [joiningId, setJoiningId] = useState<number | null>(null);

  const { data: publicGroups = [], isLoading } = useQuery<PublicGroup[]>({
    queryKey: ['public-groups', search],
    queryFn: () => apiFetch(`/groups/public${search ? `?q=${encodeURIComponent(search)}` : ''}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });

  const handleJoin = async (groupId: number) => {
    setJoiningId(groupId);
    try {
      const r = await apiFetch(`/groups/${groupId}/join`, { method: 'POST' });
      if (r.ok) {
        qc.invalidateQueries({ queryKey: ['public-groups'] });
        qc.invalidateQueries({ queryKey: ['groups'] });
      }
    } catch {}
    setJoiningId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
      <div className="relative mb-2">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('searchGroups')}
          className="w-full bg-muted/50 border border-border rounded-xl ps-9 pe-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted/40 rounded-2xl animate-pulse" />
        ))
      ) : publicGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Globe className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{t('noPublicGroups')}</p>
        </div>
      ) : (
        publicGroups.map((g, i) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3.5"
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
              style={{ backgroundColor: g.avatarColor + '33', color: g.avatarColor }}
            >
              {g.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground truncate">{g.name}</p>
              {g.description && <p className="text-xs text-muted-foreground truncate">{g.description}</p>}
              <p className="text-[11px] text-muted-foreground">{g.memberCount} {t('members')}</p>
            </div>
            {g.isMember ? (
              <button
                onClick={() => onSelectGroup(g.id)}
                className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
              >
                {t('joined')}
              </button>
            ) : (
              <button
                onClick={() => handleJoin(g.id)}
                disabled={joiningId === g.id}
                className="px-3 py-1.5 rounded-full bg-violet-600 text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1"
              >
                {joiningId === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {t('joinGroup')}
              </button>
            )}
          </motion.div>
        ))
      )}
    </div>
  );
}

function GroupDetailView({ groupId, onBack }: { groupId: number; onBack: () => void }) {
  const { user } = useAuth();
  const { t, dir } = useI18n();
  const [tab, setTab] = useState<'chat' | 'settings'>('chat');

  const { data: group, isLoading, isError, refetch } = useQuery<GroupDetail>({
    queryKey: ['group', groupId],
    queryFn: async () => {
      const r = await apiFetch(`/groups/${groupId}`);
      if (!r.ok) throw new Error('Failed to load group');
      return r.json();
    },
  });

  const BackArrow = dir === 'rtl' ? ChevronRight : ChevronLeft;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-destructive">{t('errorOccurred') || 'Something went wrong'}</p>
        <div className="flex gap-2">
          <button onClick={onBack} className="px-4 py-2 bg-muted rounded-xl text-sm">
            <BackArrow className="w-4 h-4 inline" />
          </button>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm">
            {t('retry') || 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !group) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0, x: dir === 'rtl' ? -20 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: dir === 'rtl' ? -20 : 20 }}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted/50">
          <BackArrow className="w-5 h-5" />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0"
          style={{ backgroundColor: group.avatarColor + '33', color: group.avatarColor }}
        >
          {group.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{group.name}</p>
          <p className="text-xs text-muted-foreground">{group.members.length} {t('members')}</p>
        </div>
      </div>

      <div className="flex border-b border-border">
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${tab === 'chat' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
        >
          <MessageCircle className="w-4 h-4" />
          {t('groupChat')}
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${tab === 'settings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
        >
          <Settings className="w-4 h-4" />
          {t('members')}
        </button>
      </div>

      {tab === 'chat' ? (
        <GroupChatView groupId={groupId} group={group} />
      ) : (
        <GroupSettingsView groupId={groupId} group={group} onBack={onBack} />
      )}
    </motion.div>
  );
}

function GroupChatView({ groupId, group }: { groupId: number; group: GroupDetail }) {
  const { user } = useAuth();
  const { t, dir, lang } = useI18n();
  const [messages, setMessages] = useState<GroupMsg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const seenIds = useRef<Set<number>>(new Set());

  const { data: history = [], isLoading } = useQuery<GroupMsg[]>({
    queryKey: ['group-messages', groupId],
    queryFn: () => apiFetch(`/groups/${groupId}/messages`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });

  useEffect(() => {
    setMessages(history);
    history.forEach(m => seenIds.current.add(m.id));
  }, [history]);

  useEffect(() => {
    const token = localStorage.getItem('lrmtv_auth_token') || '';
    const socket = io(BASE || '/', {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-user-room', { userId: user?.id });
    });

    socket.on('group:message', (msg: GroupMsg) => {
      if (msg.groupId !== groupId) return;
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [groupId, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending || !user) return;
    setSending(true);
    setText('');
    const tempId = -Date.now();
    const optimistic: GroupMsg = {
      id: tempId,
      groupId,
      senderId: user.id,
      content,
      createdAt: new Date().toISOString(),
      senderUsername: user.username,
      senderDisplayName: user.displayName || null,
      senderAvatarColor: user.avatarColor || '#06B6D4',
      senderAvatarUrl: user.avatarUrl || null,
    };
    seenIds.current.add(tempId);
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await apiFetch(`/groups/${groupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const saved: GroupMsg = await res.json();
        seenIds.current.add(saved.id);
        setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
      } else {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setText(content);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(content);
    } finally {
      setSending(false);
    }
  };

  const locale = lang === 'ar' ? 'ar-SA' : lang === 'fr' ? 'fr-FR' : lang === 'tr' ? 'tr-TR' : lang === 'es' ? 'es-ES' : lang === 'id' ? 'id-ID' : 'en-US';
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const formatDateSep = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return t('today') || 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t('yesterday') || 'Yesterday';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  const groupedMessages: { date: string; msgs: GroupMsg[] }[] = [];
  let lastDate = '';
  for (const msg of messages) {
    const dateStr = new Date(msg.createdAt).toDateString();
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      groupedMessages.push({ date: msg.createdAt, msgs: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].msgs.push(msg);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MessageCircle className="w-10 h-10 opacity-20" />
            <p className="text-sm">{t('groupChatEmpty')}</p>
          </div>
        ) : (
          groupedMessages.map((grp, gi) => (
            <div key={gi}>
              <div className="flex justify-center my-3">
                <span className="text-[10px] text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                  {formatDateSep(grp.date)}
                </span>
              </div>
              <div className="space-y-1.5">
                {grp.msgs.map(msg => {
                  const isMe = msg.senderId === user?.id;
                  const isOptimistic = msg.id < 0;
                  const senderName = msg.senderDisplayName || msg.senderUsername;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && (
                        <Avatar name={senderName} color={msg.senderAvatarColor} url={msg.senderAvatarUrl} size={28} />
                      )}
                      <div className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm ${!isMe ? 'ms-2' : ''} ${
                        isMe
                          ? `bg-primary text-primary-foreground ${dir === 'rtl' ? 'rounded-tl-sm' : 'rounded-tr-sm'} ${isOptimistic ? 'opacity-60' : ''}`
                          : `bg-muted text-foreground ${dir === 'rtl' ? 'rounded-tr-sm' : 'rounded-tl-sm'}`
                      }`}>
                        {!isMe && (
                          <p className="text-[11px] font-bold mb-0.5" style={{ color: msg.senderAvatarColor }}>{senderName}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-0.5 ${isMe ? 'text-primary-foreground/50 text-end' : 'text-muted-foreground text-start'}`}>
                          {isOptimistic ? '...' : formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={t('typeMessage') || 'Type a message...'}
            className="flex-1 bg-muted/50 border border-border rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="w-10 h-10 bg-primary rounded-full flex items-center justify-center disabled:opacity-40 flex-shrink-0 active:scale-95 transition-transform"
          >
            <Send className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface FriendItem {
  id: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  status: string;
}

function GroupSettingsView({ groupId, group, onBack }: { groupId: number; group: GroupDetail; onBack: () => void }) {
  const { user } = useAuth();
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const [invitingFriendId, setInvitingFriendId] = useState<number | null>(null);
  const [invitedFriends, setInvitedFriends] = useState<Set<number>>(new Set());
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [editDesc, setEditDesc] = useState(group.description || '');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const { data: friends = [] } = useQuery<FriendItem[]>({
    queryKey: ['friends'],
    queryFn: () => apiFetch('/friends').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });

  const memberIds = new Set(group.members.map(m => m.id));
  const acceptedFriends = friends.filter(f => f.status === 'accepted');
  const invitableFriends = acceptedFriends.filter(f => !memberIds.has(f.id) && !invitedFriends.has(f.id));

  const handleInviteFriend = async (friendId: number) => {
    setInvitingFriendId(friendId);
    try {
      const r = await apiFetch(`/groups/${groupId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      });
      if (r.ok) {
        setInvitedFriends(prev => new Set(prev).add(friendId));
      }
    } catch { /* network error — spinner stops */ }
    setInvitingFriendId(null);
  };

  const handleSaveName = async () => {
    if (!editName.trim()) return;
    try {
      const r = await apiFetch(`/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name: editName.trim() }) });
      if (!r.ok) { setEditName(group.name); return; }
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['groups'] });
    } catch { setEditName(group.name); }
    setEditingName(false);
  };

  const handleSaveDesc = async () => {
    try {
      const r = await apiFetch(`/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ description: editDesc.trim() || null }) });
      if (!r.ok) { setEditDesc(group.description || ''); return; }
      qc.invalidateQueries({ queryKey: ['group', groupId] });
    } catch { setEditDesc(group.description || ''); }
    setEditingDesc(false);
  };

  const handleChangeColor = async (color: string) => {
    try {
      const r = await apiFetch(`/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ avatarColor: color }) });
      if (!r.ok) return;
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['groups'] });
    } catch { /* silent — color stays as-is */ }
    setShowColorPicker(false);
  };

  const removeMemberMut = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const deleteGroupMut = useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      onBack();
    },
  });

  const isAdmin = group.myRole === 'admin';
  const isCreator = group.creatorId === user?.id;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {isAdmin && (
        <div className="space-y-3 bg-card border border-border rounded-2xl p-3.5">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            {t('groupSettings')}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0 relative group"
              style={{ backgroundColor: group.avatarColor + '33', color: group.avatarColor }}
            >
              {group.name.slice(0, 1).toUpperCase()}
              <div className="absolute inset-0 rounded-xl bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <Palette className="w-4 h-4 text-white" />
              </div>
            </button>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex gap-1.5">
                  <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={60}
                    className="flex-1 bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                  <button onClick={handleSaveName} className="px-2.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setEditingName(false); setEditName(group.name); }} className="px-2.5 py-1.5 bg-muted rounded-lg text-xs"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <button onClick={() => setEditingName(true)} className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary transition">
                  {group.name} <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
              {editingDesc ? (
                <div className="flex gap-1.5 mt-1">
                  <input value={editDesc} onChange={e => setEditDesc(e.target.value)} maxLength={200} placeholder={t('groupDescPlaceholder')}
                    className="flex-1 bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
                  <button onClick={handleSaveDesc} className="px-2 py-1 bg-primary text-primary-foreground rounded-lg text-xs"><Check className="w-3 h-3" /></button>
                  <button onClick={() => { setEditingDesc(false); setEditDesc(group.description || ''); }} className="px-2 py-1 bg-muted rounded-lg text-xs"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <button onClick={() => setEditingDesc(true)} className="text-[11px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-1">
                  {group.description || t('addDescription')} <Pencil className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>

          {showColorPicker && (
            <div className="flex gap-2 justify-center py-1.5 bg-muted/30 rounded-xl">
              {GROUP_COLORS.map(c => (
                <button key={c} onClick={() => handleChangeColor(c)} style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full transition-transform ${group.avatarColor === c ? 'scale-110 ring-2 ring-white/50' : ''}`} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                {group.isPrivate ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3 text-cyan-500" />}
                {group.isPrivate ? t('privateGroup') : t('publicGroup')}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {group.isPrivate ? t('privateGroupDesc') : t('publicGroupDesc')}
              </p>
            </div>
            <button
              onClick={async () => {
                await apiFetch(`/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ isPrivate: !group.isPrivate }) });
                qc.invalidateQueries({ queryKey: ['group', groupId] });
                qc.invalidateQueries({ queryKey: ['groups'] });
                qc.invalidateQueries({ queryKey: ['public-groups'] });
              }}
              className="px-3 py-1.5 rounded-lg bg-muted/50 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              {group.isPrivate ? t('publicGroup') : t('privateGroup')}
            </button>
          </div>
        </div>
      )}

      {!isAdmin && group.description && (
        <p className="text-sm text-muted-foreground bg-muted/30 rounded-xl px-3 py-2">{group.description}</p>
      )}

      {isAdmin && acceptedFriends.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">{t('inviteFriendsToGroup')}</p>
          {invitableFriends.length === 0 ? (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-xl px-3 py-2.5">{t('noFriendsToInvite')}</p>
          ) : (
            <div className="space-y-1.5">
              {invitableFriends.map(f => (
                <div key={f.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-2.5">
                  <Avatar name={f.displayName || f.username} color={f.avatarColor} url={f.avatarUrl} size={34} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{f.displayName || f.username}</p>
                    <p className="text-[11px] text-muted-foreground">@{f.username}</p>
                  </div>
                  <button
                    onClick={() => handleInviteFriend(f.id)}
                    disabled={invitingFriendId === f.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition disabled:opacity-50"
                  >
                    {invitingFriendId === f.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <UserPlus className="w-3 h-3" />}
                    {t('invite')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-foreground">{t('members')} ({group.members.length})</p>
        {group.members.map(m => (
          <div key={m.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-2.5">
            <Avatar name={m.displayName || m.username} color={m.avatarColor} url={m.avatarUrl} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-foreground truncate">{m.displayName || m.username}</p>
                {m.role === 'admin' && <Crown className="w-3 h-3 text-yellow-500 flex-shrink-0" />}
              </div>
              <p className="text-xs text-muted-foreground">@{m.username}</p>
            </div>
            {isAdmin && m.id !== user?.id && (
              <button
                onClick={() => removeMemberMut.mutate(m.id)}
                disabled={removeMemberMut.isPending}
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {!isAdmin && m.id === user?.id && (
              <button
                onClick={() => {
                  removeMemberMut.mutate(m.id);
                  onBack();
                }}
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title={t('leaveGroup')}
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isCreator && (
        <button
          onClick={() => {
            if (confirm(t('deleteGroupConfirm'))) deleteGroupMut.mutate();
          }}
          disabled={deleteGroupMut.isPending}
          className="w-full flex items-center justify-center gap-2 py-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl text-sm font-semibold"
        >
          <Trash2 className="w-4 h-4" />
          {t('deleteGroup')}
        </button>
      )}
    </div>
  );
}
