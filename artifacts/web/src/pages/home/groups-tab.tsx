import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users2, X, Trash2, UserPlus, Crown, LogOut, ChevronRight, ChevronLeft, Send } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth, apiFetch } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';

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
  myRole: string;
  members: GroupMember[];
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
  const [createErr, setCreateErr] = useState('');

  const { data: groups = [], isLoading } = useQuery<GroupSummary[]>({
    queryKey: ['groups'],
    queryFn: () => apiFetch('/groups').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName, description: groupDesc, avatarColor: groupColor }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed');
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      setShowCreate(false);
      setGroupName('');
      setGroupDesc('');
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
            className="flex flex-col h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-lg font-bold text-foreground">{t('groups')}</h2>
              <p className="text-xs text-muted-foreground">{t('groupsDesc')}</p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
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
          </motion.div>
        )}
      </AnimatePresence>

      {!selectedGroupId && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowCreate(true)}
          className="fixed left-4 z-[50] w-14 h-14 bg-violet-600 rounded-full shadow-xl shadow-violet-600/40 flex items-center justify-center"
          style={{ bottom: 'calc(160px + env(safe-area-inset-bottom, 0px))' }}
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

function GroupDetailView({ groupId, onBack }: { groupId: number; onBack: () => void }) {
  const { user } = useAuth();
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const [addUsername, setAddUsername] = useState('');
  const [addErr, setAddErr] = useState('');
  const [inviteSlug, setInviteSlug] = useState('');
  const [inviteResult, setInviteResult] = useState('');

  const { data: group, isLoading } = useQuery<GroupDetail>({
    queryKey: ['group', groupId],
    queryFn: async () => {
      const r = await apiFetch(`/groups/${groupId}`);
      if (!r.ok) throw new Error('Failed to load group');
      return r.json();
    },
  });

  const addMemberMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: addUsername }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed');
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      setAddUsername('');
      setAddErr('');
    },
    onError: (e: Error) => setAddErr(e.message),
  });

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

  const inviteGroupMut = useMutation({
    mutationFn: async () => {
      const slug = inviteSlug.replace(/^(.*\/room\/)/, '').trim();
      if (!slug) throw new Error('Enter room link');
      const r = await apiFetch(`/groups/${groupId}/invite-room`, {
        method: 'POST',
        body: JSON.stringify({ roomSlug: slug, roomName: slug }),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: (data) => {
      setInviteResult(`${t('invited')} ${data.invited} ${t('members')}`);
      setInviteSlug('');
      setTimeout(() => setInviteResult(''), 3000);
    },
  });

  const BackArrow = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const isAdmin = group?.myRole === 'admin';
  const isCreator = group?.creatorId === user?.id;

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

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {group.description && (
          <p className="text-sm text-muted-foreground bg-muted/30 rounded-xl px-3 py-2">{group.description}</p>
        )}

        {isAdmin && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">{t('inviteGroupToRoom')}</p>
            <div className="flex gap-2">
              <input
                value={inviteSlug}
                onChange={e => setInviteSlug(e.target.value)}
                placeholder={t('pasteRoomLink')}
                className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => inviteGroupMut.mutate()}
                disabled={!inviteSlug.trim() || inviteGroupMut.isPending}
                className="px-3 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            {inviteResult && <p className="text-xs text-green-500">{inviteResult}</p>}
          </div>
        )}

        {isAdmin && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">{t('addMember')}</p>
            <div className="flex gap-2">
              <input
                value={addUsername}
                onChange={e => setAddUsername(e.target.value)}
                placeholder={t('usernamePlaceholder')}
                className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                dir="ltr"
              />
              <button
                onClick={() => { setAddErr(''); addMemberMut.mutate(); }}
                disabled={!addUsername.trim() || addMemberMut.isPending}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
              </button>
            </div>
            {addErr && <p className="text-xs text-destructive">{addErr}</p>}
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
    </motion.div>
  );
}
