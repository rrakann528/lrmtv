import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Headphones, Crown, Settings2, Image as ImageIcon,
  Users, Lock, Unlock, RefreshCw, ChevronLeft, Pencil, Check,
  MoreHorizontal, UserCircle, ShieldCheck, LogOut, X,
  Globe, EyeOff, MessageSquareOff, MessageSquare, Mic, MicOff, Video, VideoOff,
  Trash2, AlertTriangle,
} from 'lucide-react';
import { RoomUser } from '@/hooks/use-socket';
import { generateColorFromString, cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';

interface UsersPanelProps {
  users: RoomUser[];
  you: RoomUser | null;
  isAdmin: boolean;
  isLocked: boolean;
  allowGuestControl: boolean;
  isPrivate: boolean;
  chatDisabled: boolean;
  micDisabled: boolean;
  cameraDisabled: boolean;
  toggleLock: () => void;
  toggleAllowGuests: () => void;
  togglePrivacy: () => void;
  toggleChat: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleDJ: (socketId: string) => void;
  kickUser: (socketId: string) => void;
  transferAdmin: (socketId: string) => void;
  changeBackground: (url: string) => void;
  requestSync: () => void;
  currentRoomName?: string;
  renameRoom?: (name: string) => void;
  onUserClick?: (username: string) => void;
  deleteRoom?: () => void;
}

const BACKGROUNDS = [
  { name: 'Neon City / مدينة نيون',    file: 'lounge-1.png' },
  { name: 'Home Theater / مسرح منزلي', file: 'lounge-2.png' },
  { name: 'Void / الفضاء',            file: 'lounge-3.png' },
];

export default function UsersPanel({
  users, you, isAdmin, isLocked, allowGuestControl,
  isPrivate, chatDisabled, micDisabled, cameraDisabled,
  toggleLock, toggleAllowGuests, togglePrivacy, toggleChat, toggleMic, toggleCamera,
  toggleDJ, kickUser, transferAdmin,
  changeBackground, requestSync, currentRoomName = '', renameRoom, onUserClick,
  deleteRoom,
}: UsersPanelProps) {
  const { t, lang } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [adminSheetUser, setAdminSheetUser] = useState<RoomUser | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isRtl = lang === 'ar';

  const handleRenameSubmit = () => {
    if (nameInput.trim() && renameRoom) renameRoom(nameInput.trim());
    setEditingName(false);
  };

  const backgrounds = BACKGROUNDS.map(b => ({
    name: b.name,
    url: `${import.meta.env.BASE_URL}images/${b.file}`,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col h-full relative overflow-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <AnimatePresence mode="wait">
          {showSettings ? (
            <motion.button
              key="back"
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition"
              onClick={() => setShowSettings(false)}
            >
              <ChevronLeft className="w-4 h-4" />
              {isRtl ? 'المستخدمون' : 'Users'}
            </motion.button>
          ) : (
            <motion.span
              key="title"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-sm font-semibold text-white/80 flex items-center gap-2"
            >
              <Users className="w-4 h-4" />
              {isRtl ? `${users.length} في الغرفة` : `${users.length} in room`}
            </motion.span>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1">
          <button
            onClick={requestSync}
            title={isRtl ? 'مزامنة الآن' : 'Sync now'}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowSettings(s => !s)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition',
                showSettings
                  ? 'bg-primary/20 text-primary'
                  : 'text-white/40 hover:text-white hover:bg-white/10',
              )}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {isRtl ? 'الإعدادات' : 'Settings'}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Settings ─────────────────────────────────────────────────────── */}
        {showSettings ? (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
            className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4"
          >
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mt-1">
              <Shield className="w-4 h-4 text-primary" />
              {isRtl ? 'إعدادات الغرفة' : 'Room Settings'}
            </h3>

            {isAdmin && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-xs text-white/50 mb-1.5">{isRtl ? 'اسم الغرفة' : 'Room Name'}</p>
                {editingName ? (
                  <div className="flex gap-2">
                    <input
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setEditingName(false); }}
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-primary"
                      maxLength={60} autoFocus dir="auto"
                    />
                    <button onClick={handleRenameSubmit} className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white font-medium truncate">{currentRoomName || '—'}</span>
                    <button
                      onClick={() => { setNameInput(currentRoomName); setEditingName(true); }}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                {allowGuestControl
                  ? <Unlock className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                  : <Lock className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-white">
                    {isRtl ? 'السماح للجميع بالتحكم' : 'Allow all to control'}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5 leading-relaxed">
                    {allowGuestControl
                      ? (isRtl ? 'يمكن لأي مستخدم تشغيل/إيقاف/تقديم الفيديو' : 'Anyone can play, pause, and seek')
                      : (isRtl ? 'فقط المضيف والـ DJ يتحكمون' : 'Only host and DJs can control')}
                  </p>
                </div>
              </div>
              <Switch checked={allowGuestControl} onCheckedChange={toggleAllowGuests} />
            </div>

            {/* Privacy / Chat / Mic / Camera */}
            <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">
              {/* Private room */}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  {isPrivate
                    ? <EyeOff className="w-4 h-4 text-purple-400 shrink-0" />
                    : <Globe className="w-4 h-4 text-green-400 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {isRtl ? 'نوع الغرفة' : 'Room visibility'}
                    </p>
                    <p className="text-xs text-white/50">
                      {isPrivate
                        ? (isRtl ? 'خاصة — لا تظهر في القائمة العامة' : 'Private — hidden from public list')
                        : (isRtl ? 'عامة — تظهر للجميع' : 'Public — visible to everyone')}
                    </p>
                  </div>
                </div>
                <Switch checked={isPrivate} onCheckedChange={togglePrivacy} />
              </div>

              {/* Disable chat */}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  {chatDisabled
                    ? <MessageSquareOff className="w-4 h-4 text-red-400 shrink-0" />
                    : <MessageSquare className="w-4 h-4 text-white/40 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {isRtl ? 'الدردشة' : 'Chat'}
                    </p>
                    <p className="text-xs text-white/50">
                      {chatDisabled
                        ? (isRtl ? 'محظورة على الجميع' : 'Disabled for everyone')
                        : (isRtl ? 'مفتوحة للجميع' : 'Open for everyone')}
                    </p>
                  </div>
                </div>
                <Switch checked={!chatDisabled} onCheckedChange={toggleChat} />
              </div>

              {/* Disable mic */}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  {micDisabled
                    ? <MicOff className="w-4 h-4 text-red-400 shrink-0" />
                    : <Mic className="w-4 h-4 text-white/40 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {isRtl ? 'المايكروفون' : 'Microphone'}
                    </p>
                    <p className="text-xs text-white/50">
                      {micDisabled
                        ? (isRtl ? 'محظور على الجميع' : 'Disabled for everyone')
                        : (isRtl ? 'مفتوح للجميع' : 'Open for everyone')}
                    </p>
                  </div>
                </div>
                <Switch checked={!micDisabled} onCheckedChange={toggleMic} />
              </div>

              {/* Disable camera */}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  {cameraDisabled
                    ? <VideoOff className="w-4 h-4 text-red-400 shrink-0" />
                    : <Video className="w-4 h-4 text-white/40 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {isRtl ? 'الكاميرا' : 'Camera'}
                    </p>
                    <p className="text-xs text-white/50">
                      {cameraDisabled
                        ? (isRtl ? 'محظورة على الجميع' : 'Disabled for everyone')
                        : (isRtl ? 'مفتوحة للجميع' : 'Open for everyone')}
                    </p>
                  </div>
                </div>
                <Switch checked={!cameraDisabled} onCheckedChange={toggleCamera} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                {isRtl ? 'خلفية الغرفة' : 'Room background'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {backgrounds.map((bg) => (
                  <button
                    key={bg.url}
                    className="relative aspect-video rounded-lg overflow-hidden border-2 border-transparent hover:border-primary/60 focus:border-primary transition-all"
                    onClick={() => changeBackground(bg.url)}
                  >
                    <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-end p-1 opacity-0 hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-white font-semibold leading-tight line-clamp-1">{bg.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {deleteRoom && (
              <div className="mt-2">
                <div className="h-px bg-white/10 mb-4" />
                {showDeleteConfirm ? (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <p className="text-sm font-semibold">
                        {isRtl ? 'هل أنت متأكد؟' : 'Are you sure?'}
                      </p>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {isRtl
                        ? 'سيتم حذف الغرفة والمحادثة وقائمة التشغيل نهائياً، وسيُخرج جميع المستخدمين.'
                        : 'The room, chat history, and playlist will be permanently deleted. All users will be removed.'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 py-2 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition"
                      >
                        {isRtl ? 'إلغاء' : 'Cancel'}
                      </button>
                      <button
                        onClick={deleteRoom}
                        className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {isRtl ? 'حذف' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    {isRtl ? 'حذف الغرفة نهائياً' : 'Delete Room Permanently'}
                  </button>
                )}
              </div>
            )}
          </motion.div>

        ) : (
          /* ── Users list ────────────────────────────────────────────────────── */
          <motion.div
            key="users"
            initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2"
          >
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-1',
              allowGuestControl
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
            )}>
              {allowGuestControl ? <Unlock className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
              {allowGuestControl
                ? (isRtl ? 'الجميع يتحكم في التشغيل' : 'Everyone controls playback')
                : (isRtl ? 'فقط المضيف والـ DJ يتحكمون' : 'Host & DJ control only')}
            </div>

            {/* Global restriction banners */}
            {(micDisabled || cameraDisabled) && (
              <div className="flex flex-col gap-1.5">
                {micDisabled && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20" dir={isRtl ? 'rtl' : 'ltr'}>
                    <MicOff className="w-3.5 h-3.5 shrink-0" />
                    {isRtl ? 'المايكروفون معطّل لجميع المستخدمين' : 'Microphone disabled for everyone'}
                  </div>
                )}
                {cameraDisabled && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20" dir={isRtl ? 'rtl' : 'ltr'}>
                    <VideoOff className="w-3.5 h-3.5 shrink-0" />
                    {isRtl ? 'الكاميرا معطّلة لجميع المستخدمين' : 'Camera disabled for everyone'}
                  </div>
                )}
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
                    {/* Avatar — always opens profile */}
                    <button
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow relative shrink-0"
                      style={{ backgroundColor: generateColorFromString(user.username) }}
                      onClick={() => !isYou && onUserClick?.(user.username)}
                    >
                      {user.username.substring(0, 2).toUpperCase()}
                      <div className="absolute bottom-0 end-0 w-3 h-3 bg-green-500 border-2 border-[#1a1a1a] rounded-full" />
                    </button>

                    {/* Name — also opens profile */}
                    <button
                      className="flex flex-col min-w-0 text-start"
                      onClick={() => !isYou && onUserClick?.(user.username)}
                      disabled={isYou}
                    >
                      <span className="text-sm font-medium text-white flex items-center gap-1.5 truncate">
                        {user.displayName || user.username}
                        {isYou && <span className="text-[10px] text-white/40 font-normal">{isRtl ? '(أنت)' : '(you)'}</span>}
                        {user.isAdmin && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                        {user.isDJ && !user.isAdmin && <Headphones className="w-3 h-3 text-primary shrink-0" />}
                      </span>
                      <span className="text-[10px] text-white/50">
                        {user.isAdmin
                          ? (isRtl ? 'مضيف' : 'Host')
                          : user.isDJ ? 'DJ'
                            : (isRtl ? 'مشاهد' : 'Viewer')}
                      </span>
                    </button>
                  </div>

                  {/* Admin actions button */}
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Admin Actions Bottom Sheet ─────────────────────────────────────── */}
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
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>

              {/* Title */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                    style={{ backgroundColor: generateColorFromString(adminSheetUser.username) }}
                  >
                    {adminSheetUser.username.substring(0, 2).toUpperCase()}
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
                {/* View Profile */}
                <button
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                  onClick={() => { onUserClick?.(adminSheetUser.username); setAdminSheetUser(null); }}
                >
                  <UserCircle className="w-5 h-5 text-white/60 shrink-0" />
                  <span className="text-sm">{isRtl ? 'عرض الملف الشخصي' : 'View Profile'}</span>
                </button>

                {/* Grant / Revoke DJ */}
                <button
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                  onClick={() => { toggleDJ(adminSheetUser.socketId); setAdminSheetUser(null); }}
                >
                  <Headphones className={cn('w-5 h-5 shrink-0', adminSheetUser.isDJ ? 'text-destructive' : 'text-primary')} />
                  <span className="text-sm">
                    {adminSheetUser.isDJ
                      ? (isRtl ? 'إلغاء صلاحية التحكم في التشغيل' : 'Revoke Playback Control')
                      : (isRtl ? 'منح صلاحية التحكم في التشغيل' : 'Grant Playback Control')}
                  </span>
                </button>

                {/* Transfer Admin */}
                {!adminSheetUser.isAdmin && (
                  <button
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/8 transition text-white w-full text-start"
                    onClick={() => { transferAdmin(adminSheetUser.socketId); setAdminSheetUser(null); }}
                  >
                    <ShieldCheck className="w-5 h-5 text-yellow-400 shrink-0" />
                    <span className="text-sm">{isRtl ? 'تحويل صلاحية المضيف' : 'Transfer Host'}</span>
                  </button>
                )}

                {/* Kick */}
                {!adminSheetUser.isAdmin && (
                  <button
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-destructive/15 transition text-destructive w-full text-start"
                    onClick={() => { kickUser(adminSheetUser.socketId); setAdminSheetUser(null); }}
                  >
                    <LogOut className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-medium">{isRtl ? 'طرد من الغرفة' : 'Kick from Room'}</span>
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
