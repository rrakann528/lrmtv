import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus, Clock, Send, Bell, BellOff,
  Check, X, Loader2, Users, MessageCircle, Users2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiFetch } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { generateColorFromString, cn } from '@/lib/utils';
import { DmChat } from '@/pages/home/dm-chat';
import { Socket } from 'socket.io-client';
import { useI18n } from '@/lib/i18n';

interface Friend {
  id: number;
  status: string;
  friendshipId: number;
  username: string;
  displayName: string | null;
  avatarColor: string;
  avatarUrl: string | null;
}

interface RoomUser {
  socketId: string;
  userId?: number;
  username: string;
}

interface FriendsPanelProps {
  userId: number;
  roomSlug: string;
  roomName: string;
  socket: Socket | null;
  roomUsers: RoomUser[];
  myUsername: string;
}

function Avatar({ username, color, avatarUrl, size = 36 }: { username: string; color?: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35, backgroundColor: color || generateColorFromString(username) }}
    >
      {username.substring(0, 2).toUpperCase()}
    </div>
  );
}

interface GroupSummary {
  id: number;
  name: string;
  avatarColor: string;
  memberCount: number;
}

export default function FriendsPanel({ userId, roomSlug, roomName, socket: _socket, roomUsers, myUsername: _myUsername }: FriendsPanelProps) {
  const { t } = useI18n();
  const [friends, setFriends]       = useState<Friend[]>([]);
  const [inviting, setInviting]     = useState<number | null>(null);
  const [inviteResults, setInviteResults] = useState<Map<number, 'sent' | 'no_notif'>>(new Map());
  const [dmFriend, setDmFriend]     = useState<Friend | null>(null);
  const [groups, setGroups]         = useState<GroupSummary[]>([]);
  const [showGroups, setShowGroups] = useState(false);
  const [invitingGroup, setInvitingGroup] = useState<number | null>(null);
  const [groupInviteResults, setGroupInviteResults] = useState<Map<number, string>>(new Map());

  const { permission, subscribed, subscribe, inviteFriend } = usePush(userId);

  const loadFriends = useCallback(async () => {
    const r = await apiFetch('/friends');
    if (r.ok) {
      const data = await r.json();
      setFriends(Array.isArray(data) ? data : []);
    }
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const loadGroups = useCallback(async () => {
    try {
      const r = await apiFetch('/groups');
      if (r.ok) {
        const data = await r.json();
        setGroups(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const [groupInviteErr, setGroupInviteErr] = useState<string | null>(null);

  const handleInviteGroup = async (groupId: number) => {
    setInvitingGroup(groupId);
    setGroupInviteErr(null);
    try {
      const r = await apiFetch(`/groups/${groupId}/invite-room`, {
        method: 'POST',
        body: JSON.stringify({ roomSlug, roomName }),
      });
      if (r.ok) {
        const data = await r.json();
        setGroupInviteResults(prev => new Map(prev).set(groupId, `${data.invited}`));
      } else {
        setGroupInviteErr(t('errorOccurred') || 'Failed');
      }
    } catch {
      setGroupInviteErr(t('errorOccurred') || 'Failed');
    }
    setInvitingGroup(null);
  };

  const respond = async (id: number, action: 'accept' | 'decline') => {
    await apiFetch(`/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    loadFriends();
  };

  const handleInvite = async (friendId: number) => {
    if (permission !== 'granted' && !subscribed) await subscribe();
    setInviting(friendId);
    const result = await inviteFriend(friendId, roomSlug, roomName);
    setInviteResults(prev => new Map(prev).set(friendId, result.sent === 0 ? 'no_notif' : 'sent'));
    setInviting(null);
  };

  const accepted  = friends.filter(f => f.status === 'accepted');
  const pending   = friends.filter(f => f.status === 'pending_received');
  const sent      = friends.filter(f => f.status === 'pending_sent');

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full relative overflow-hidden"
    >
      {/* Push permission banner */}
      {permission !== 'granted' && !dmFriend && (
        <div className="shrink-0 mx-3 mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center gap-3">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <p className="text-white/70 text-xs flex-grow">فعّل الإشعارات لاستقبال دعوات الأصدقاء</p>
          <button onClick={subscribe} className="shrink-0 px-3 py-1 rounded-full bg-primary text-black text-xs font-semibold">
            تفعيل
          </button>
        </div>
      )}

      <div className="flex-grow overflow-y-auto px-3 pb-4 pt-3 flex flex-col gap-2">

        {/* Pending requests */}
        {pending.length > 0 && (
          <div>
            <p className="text-white/40 text-[11px] font-medium mb-2 px-1">طلبات الصداقة</p>
            {pending.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2">
                <Avatar username={f.username} color={f.avatarColor} avatarUrl={f.avatarUrl} />
                <span className="flex-grow text-white text-sm font-medium">{f.displayName || f.username}</span>
                <button onClick={() => respond(f.friendshipId, 'accept')} className="p-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => respond(f.friendshipId, 'decline')} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Accepted friends */}
        {accepted.length > 0 && (
          <div>
            <p className="text-white/40 text-[11px] font-medium mb-2 px-1">الأصدقاء</p>
            {accepted.map(f => {
              const inRoom = roomUsers.some(u => u.userId === f.id);

              return (
                <div key={f.id} className="mb-2 rounded-xl bg-white/5 overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <Avatar username={f.username} color={f.avatarColor} avatarUrl={f.avatarUrl} size={34} />

                    <button
                      className="flex-grow text-sm font-medium text-start text-white hover:text-primary transition"
                      onClick={() => setDmFriend(f)}
                    >
                      <span className="flex items-center gap-2">
                        {f.displayName || f.username}
                        {inRoom && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" title="في الغرفة" />
                        )}
                      </span>
                    </button>

                    {/* Actions: always show chat, and invite if not in room */}
                    <div className="flex items-center gap-1.5">
                      {!inRoom && (
                        inviteResults.get(f.id) === 'sent'
                          ? <span className="text-green-400 text-xs flex items-center gap-1"><Check className="w-3 h-3" />أُرسلت</span>
                          : inviteResults.get(f.id) === 'no_notif'
                          ? <span className="text-yellow-400 text-xs flex items-center gap-1"><BellOff className="w-3 h-3" />لم يفعّل</span>
                          : <button
                              onClick={() => handleInvite(f.id)}
                              disabled={inviting === f.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition disabled:opacity-50"
                            >
                              {inviting === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              دعوة
                            </button>
                      )}
                      <button
                        onClick={() => setDmFriend(f)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/10 text-white text-xs font-medium hover:bg-primary/20 hover:text-primary transition"
                      >
                        <MessageCircle className="w-3 h-3" />
                        دردشة
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Sent requests */}
        {sent.length > 0 && (
          <div>
            <p className="text-white/40 text-[11px] font-medium mb-2 px-1">طلبات مُرسلة</p>
            {sent.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2 opacity-60">
                <Avatar username={f.username} color={f.avatarColor} />
                <span className="flex-grow text-white text-sm">{f.username}</span>
                <Clock className="w-4 h-4 text-white/30" />
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 && (
          <div>
            <button
              onClick={() => setShowGroups(!showGroups)}
              className="flex items-center gap-2 text-white/40 text-[11px] font-medium mb-2 px-1 w-full"
            >
              <Users2 className="w-3 h-3" />
              <span className="flex-grow text-start">{t('inviteGroupMembers')}</span>
              {showGroups ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showGroups && groupInviteErr && (
              <p className="text-xs text-red-400 mb-2 px-1">{groupInviteErr}</p>
            )}
            {showGroups && groups.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-2">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: g.avatarColor + '33', color: g.avatarColor }}
                >
                  {g.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-grow min-w-0">
                  <p className="text-white text-sm font-medium truncate">{g.name}</p>
                  <p className="text-white/30 text-[10px]">{g.memberCount} {t('members')}</p>
                </div>
                {groupInviteResults.has(g.id)
                  ? <span className="text-green-400 text-xs flex items-center gap-1"><Check className="w-3 h-3" />{groupInviteResults.get(g.id)}</span>
                  : <button
                      onClick={() => handleInviteGroup(g.id)}
                      disabled={invitingGroup === g.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition disabled:opacity-50"
                    >
                      {invitingGroup === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {t('inviteGroupMembers')}
                    </button>
                }
              </div>
            ))}
          </div>
        )}

        {accepted.length === 0 && pending.length === 0 && sent.length === 0 && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-grow py-12 text-center">
            <Users className="w-10 h-10 text-white/10 mb-3" />
            <p className="text-white/30 text-sm">لا يوجد أصدقاء بعد</p>
            <p className="text-white/20 text-xs mt-1">أضف أصدقاء من صفحتك الشخصية</p>
          </div>
        )}
      </div>

      {/* DM overlay — opens full DmChat for the selected friend */}
      <AnimatePresence>
        {dmFriend && (
          <DmChat
            friend={dmFriend}
            onBack={() => setDmFriend(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
