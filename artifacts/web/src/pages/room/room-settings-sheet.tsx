import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Lock, Unlock, Check, Pencil, X,
  Globe, EyeOff, MessageSquareOff, MessageSquare, Mic, MicOff, Video, VideoOff,
  Trash2, AlertTriangle, UserX, UserCheck, SkipForward,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface RoomSettingsSheetProps {
  isAdmin: boolean;
  allowGuestControl: boolean;
  allowGuestEntry: boolean;
  isPrivate: boolean;
  chatDisabled: boolean;
  micDisabled: boolean;
  cameraDisabled: boolean;
  sponsorSkipEnabled: boolean;
  toggleAllowGuests: () => void;
  toggleGuestEntry: () => void;
  togglePrivacy: () => void;
  toggleChat: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleSponsorSkip: () => void;
  currentRoomName?: string;
  renameRoom?: (name: string) => void;
  deleteRoom?: () => void;
  onClose: () => void;
}

export function RoomSettingsSheet({
  isAdmin,
  allowGuestControl,
  allowGuestEntry,
  isPrivate,
  chatDisabled,
  micDisabled,
  cameraDisabled,
  sponsorSkipEnabled,
  toggleAllowGuests,
  toggleGuestEntry,
  togglePrivacy,
  toggleChat,
  toggleMic,
  toggleCamera,
  toggleSponsorSkip,
  currentRoomName = '',
  renameRoom,
  deleteRoom,
  onClose,
}: RoomSettingsSheetProps) {
  const { t } = useI18n();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleRenameSubmit = () => {
    if (nameInput.trim() && renameRoom) renameRoom(nameInput.trim());
    setEditingName(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <motion.div
        className="relative w-full bg-zinc-900 rounded-t-3xl z-10 overflow-hidden shadow-2xl max-h-[85vh] flex flex-col"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-white">
              {t('roomSettings')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 py-4 flex flex-col gap-3" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}>

          {/* Room name */}
          {isAdmin && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-xs text-white/50 mb-1.5">{t('roomName')}</p>
              {editingName ? (
                <div className="flex gap-2">
                  <input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameSubmit();
                      if (e.key === 'Escape') setEditingName(false);
                    }}
                    className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-primary"
                    maxLength={60}
                    autoFocus
                    dir="auto"
                  />
                  <button
                    onClick={handleRenameSubmit}
                    className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0"
                  >
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

          {/* Allow all to control */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              {allowGuestControl
                ? <Unlock className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                : <Lock className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />}
              <div>
                <p className="text-sm font-medium text-white">
                  {t('allowAllToControl')}
                </p>
                <p className="text-xs text-white/50 mt-0.5 leading-relaxed">
                  {allowGuestControl ? t('anyonePauseSeek') : t('hostDjControlOnly')}
                </p>
              </div>
            </div>
            <Switch checked={allowGuestControl} onCheckedChange={toggleAllowGuests} />
          </div>

          {/* Guest entry */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              {allowGuestEntry
                ? <UserCheck className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                : <UserX className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />}
              <div>
                <p className="text-sm font-medium text-white">
                  {t('guestEntry')}
                </p>
                <p className="text-xs text-white/50 mt-0.5 leading-relaxed">
                  {allowGuestEntry ? t('guestsCanJoin') : t('registeredOnly')}
                </p>
              </div>
            </div>
            <Switch checked={allowGuestEntry} onCheckedChange={toggleGuestEntry} />
          </div>

          {/* Privacy / Chat / Mic / Camera group */}
          <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/5">

            {/* Private room */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                {isPrivate
                  ? <EyeOff className="w-4 h-4 text-purple-400 shrink-0" />
                  : <Globe className="w-4 h-4 text-green-400 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-white">
                    {t('roomVisibility')}
                  </p>
                  <p className="text-xs text-white/50">
                    {isPrivate ? t('privateHidden') : t('publicVisible')}
                  </p>
                </div>
              </div>
              <Switch checked={isPrivate} onCheckedChange={togglePrivacy} />
            </div>

            {/* Chat */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                {chatDisabled
                  ? <MessageSquareOff className="w-4 h-4 text-red-400 shrink-0" />
                  : <MessageSquare className="w-4 h-4 text-white/40 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-white">
                    {t('chat')}
                  </p>
                  <p className="text-xs text-white/50">
                    {chatDisabled ? t('disabledForAll') : t('openForAll')}
                  </p>
                </div>
              </div>
              <Switch checked={!chatDisabled} onCheckedChange={toggleChat} />
            </div>

            {/* Mic */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                {micDisabled
                  ? <MicOff className="w-4 h-4 text-red-400 shrink-0" />
                  : <Mic className="w-4 h-4 text-white/40 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-white">
                    {t('mic')}
                  </p>
                  <p className="text-xs text-white/50">
                    {micDisabled ? t('disabledForAll') : t('openForAll')}
                  </p>
                </div>
              </div>
              <Switch checked={!micDisabled} onCheckedChange={toggleMic} />
            </div>

            {/* Camera */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                {cameraDisabled
                  ? <VideoOff className="w-4 h-4 text-red-400 shrink-0" />
                  : <Video className="w-4 h-4 text-white/40 shrink-0" />}
                <div>
                  <p className="text-sm font-medium text-white">
                    {t('camera')}
                  </p>
                  <p className="text-xs text-white/50">
                    {cameraDisabled ? t('disabledForAll') : t('openForAll')}
                  </p>
                </div>
              </div>
              <Switch checked={!cameraDisabled} onCheckedChange={toggleCamera} />
            </div>

            {/* Sponsor Skip */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <SkipForward className={cn('w-4 h-4 shrink-0', sponsorSkipEnabled ? 'text-green-400' : 'text-white/40')} />
                <div>
                  <p className="text-sm font-medium text-white">
                    {t('sponsorSkip')}
                  </p>
                  <p className="text-xs text-white/50">
                    {sponsorSkipEnabled ? t('sponsorSkipOn') : t('sponsorSkipOff')}
                  </p>
                </div>
              </div>
              <Switch checked={sponsorSkipEnabled} onCheckedChange={toggleSponsorSkip} />
            </div>
          </div>

          {/* Delete room */}
          {deleteRoom && (
            <div className="mt-1">
              <div className="h-px bg-white/10 mb-3" />
              <AnimatePresence mode="wait">
                {showDeleteConfirm ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <p className="text-sm font-semibold">
                        {t('areYouSure')}
                      </p>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {t('deleteRoomWarning')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        onClick={deleteRoom}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t('delete')}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button
                    key="delete-btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    {t('deleteRoomPermanently')}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
