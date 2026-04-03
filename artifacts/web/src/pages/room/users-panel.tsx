import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Headphones, Crown,
  Users, Lock, Unlock, RefreshCw,
  MoreHorizontal, UserCircle, ShieldCheck, LogOut, X,
  MicOff,
} from 'lucide-react';
import { RoomUser } from '@/hooks/use-socket';
import { generateColorFromString, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface UsersPanelProps {
  users: RoomUser[];
  you: RoomUser | null;
  isAdmin: boolean;
  allowGuestControl: boolean;
  micDisabled: boolean;
  toggleDJ: (socketId: string) => void;
  kickUser: (socketId: string) => void;
  transferAdmin: (socketId: string) => void;
  requestSync: () => void;
  onUserClick?: (username: string, userId?: number) => void;
}

export default function UsersPanel({
  users, you, isAdmin, allowGuestControl, micDisabled,
  toggleDJ, kickUser, transferAdmin, requestSync, onUserClick,
}: UsersPanelProps) {
  const { t } = useI18n();
  const [adminSheetUser, setAdminSheetUser] = useState<RoomUser | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full relative overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <span className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Users className="w-4 h-4" />
          {`${users.length} ${t('inRoom')}`}
        </span>

        <button
          onClick={requestSync}
          title={t('syncNow')}
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Users list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2">

        {/* Control mode banner */}
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-1',
          allowGuestControl
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
        )}>
          {allowGuestControl
            ? <Unlock className="w-3.5 h-3.5 shrink-0" />
            : <Lock className="w-3.5 h-3.5 shrink-0" />}
          {allowGuestControl ? t('everyoneControls') : t('hostDjOnly')}
        </div>

        {/* Global restriction banners */}
        {micDisabled && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20">
            <MicOff className="w-3.5 h-3.5 shrink-0" />
            {t('micDisabledAll')}
          </div>
        )}

        {users.map((user) => {
          const isYou = user.socketId === you?.socketId;
          return (
            <div
              key={user.socketId}
              className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/8 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Avatar */}
                <button
                  className="w-10 h-10 rounded-full relative shrink-0"
                  onClick={() => !isYou && onUserClick?.(user.username, user.userId)}
                >
                  {user.avatarUrl
                    ? <img src={user.avatarUrl} alt={user.displayName || user.username} className="w-10 h-10 rounded-full object-cover" />
                    : <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow" style={{ backgroundColor: user.avatarColor || generateColorFromString(user.username) }}>
                        {(user.displayName || user.username).substring(0, 2).toUpperCase()}
                      </div>
                  }
                  <div className="absolute bottom-0 end-0 w-3 h-3 bg-green-500 border-2 border-[#1a1a1a] rounded-full" />
                </button>

                {/* Name */}
                <button
                  className="flex flex-col min-w-0 text-start"
                  onClick={() => !isYou && onUserClick?.(user.username, user.userId)}
                  disabled={isYou}
                >
                  <span className="text-sm font-medium text-white flex items-center gap-1.5 truncate">
                    {user.displayName || user.username}
                    {isYou && (
                      <span className="text-[10px] text-white/40 font-normal">
                        {t('youParens')}
                      </span>
                    )}
                    {user.isAdmin && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                    {user.isDJ && !user.isAdmin && <Headphones className="w-3 h-3 text-primary shrink-0" />}
                  </span>
                  <span className="text-[10px] text-white/50">
                    {user.isAdmin ? t('host') : user.isDJ ? 'DJ' : t('viewer')}
                  </span>
                </button>
              </div>

              {/* Admin actions */}
              {isAdmin && !isYou && (
                <button
                  className="p-2 rounded-lg active:bg-white/10 text-white/40 hover:text-white shrink-0"
                  onClick={() => setAdminSheetUser(user)}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Admin Actions Bottom Sheet */}
      <AnimatePresence>
        {adminSheetUser && (
          <motion.div
            className="absolute inset-0 z-20 flex items-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => setAdminSheetUser(null)} />
            <motion.div
              className="relative w-full bg-[#1a1a2e] rounded-t-2xl z-10 overflow-hidden"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>

              {/* Title */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden">
                    {adminSheetUser.avatarUrl
                      ? <img src={adminSheetUser.avatarUrl} alt={adminSheetUser.displayName || adminSheetUser.username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: adminSheetUser.avatarColor || generateColorFromString(adminSheetUser.username) }}>
                          {(adminSheetUser.displayName || adminSheetUser.username).substring(0, 2).toUpperCase()}
                        </div>
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {adminSheetUser.displayName || adminSheetUser.username}
                    </p>
                    <p className="text-xs text-white/50">@{adminSheetUser.username}</p>
                  </div>
                </div>
                <button onClick={() => setAdminSheetUser(null)} className="p-2 rounded-xl hover:bg-white/10 text-white/50">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Actions */}
              <div className="flex flex-col py-2 px-2">
                <button
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                  onClick={() => { onUserClick?.(adminSheetUser.username, adminSheetUser.userId); setAdminSheetUser(null); }}
                >
                  <UserCircle className="w-5 h-5 text-white/60 shrink-0" />
                  <span className="text-sm">{t('viewProfile')}</span>
                </button>

                <button
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                  onClick={() => { toggleDJ(adminSheetUser.socketId); setAdminSheetUser(null); }}
                >
                  <Headphones className={cn('w-5 h-5 shrink-0', adminSheetUser.isDJ ? 'text-destructive' : 'text-primary')} />
                  <span className="text-sm">
                    {adminSheetUser.isDJ ? t('revokePlayback') : t('grantPlayback')}
                  </span>
                </button>

                {!adminSheetUser.isAdmin && (
                  <button
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                    onClick={() => { transferAdmin(adminSheetUser.socketId); setAdminSheetUser(null); }}
                  >
                    <ShieldCheck className="w-5 h-5 text-yellow-400 shrink-0" />
                    <span className="text-sm">{t('transferHost')}</span>
                  </button>
                )}

                {!adminSheetUser.isAdmin && (
                  <button
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-destructive/15 transition text-destructive w-full text-start"
                    onClick={() => { kickUser(adminSheetUser.socketId); setAdminSheetUser(null); }}
                  >
                    <LogOut className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-medium">{t('kickFromRoom')}</span>
                  </button>
                )}
              </div>

              <div style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
