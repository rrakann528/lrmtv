import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Settings, Globe, Bell, MessageSquare, Play, Shield, Eye,
  Volume2, ChevronLeft, RotateCcw, Check, Lock, Sparkles, Monitor,
  UserCheck, Users, Mail, MousePointerClick, DoorOpen, Captions, Maximize,
  Save,
} from 'lucide-react';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { useAuth } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';

type Category = 'general' | 'notifications' | 'chat' | 'player' | 'privacy' | 'account';

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [settings, update, reset] = useSettings();
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const categories: { id: Category; icon: typeof Settings; label: string; count: number }[] = [
    { id: 'general',       icon: Globe,          label: t('settingsGeneral'),       count: 4 },
    { id: 'notifications', icon: Bell,           label: t('settingsNotifications'), count: 5 },
    { id: 'chat',          icon: MessageSquare,   label: t('settingsChat'),          count: 5 },
    { id: 'player',        icon: Play,           label: t('settingsPlayer'),        count: 6 },
    { id: 'privacy',       icon: Shield,         label: t('settingsPrivacy'),       count: 4 },
    { id: 'account',       icon: Lock,           label: t('settingsAccount'),       count: 1 },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          {activeCategory ? (
            <button onClick={() => setActiveCategory(null)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
              <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            </button>
          ) : (
            <button onClick={() => setLocation('/')}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Settings className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-sm truncate">
              {activeCategory ? categories.find(c => c.id === activeCategory)?.label : t('settings')}
            </span>
          </div>
          {!activeCategory && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/40 hover:text-white"
              title={t('settingsReset')}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <AnimatePresence mode="wait">
          {!activeCategory ? (
            <motion.div
              key="categories"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-2"
            >
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-border rounded-2xl hover:bg-white/5 transition group"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <cat.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 text-start min-w-0">
                    <p className="text-sm font-medium text-foreground">{cat.label}</p>
                    <p className="text-xs text-muted-foreground">{cat.count} {t('settingsItems')}</p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition rtl:rotate-180" />
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-3"
            >
              {activeCategory === 'general' && (
                <GeneralSettings settings={settings} update={update} lang={lang} setLang={setLang} t={t} />
              )}
              {activeCategory === 'notifications' && (
                <NotificationSettings settings={settings} update={update} t={t} userId={user?.id} />
              )}
              {activeCategory === 'chat' && (
                <ChatSettings settings={settings} update={update} t={t} />
              )}
              {activeCategory === 'player' && (
                <PlayerSettings settings={settings} update={update} t={t} />
              )}
              {activeCategory === 'privacy' && (
                <PrivacySettings settings={settings} update={update} t={t} />
              )}
              {activeCategory === 'account' && (
                <AccountSettings t={t} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowResetConfirm(false)} />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative w-full max-w-sm mx-4 mb-8 sm:mb-0 rounded-2xl overflow-hidden"
            style={{ background: 'rgba(18,18,20,0.97)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <div className="flex flex-col items-center gap-3 pt-8 pb-2 px-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-yellow-500/15">
                <RotateCcw className="w-8 h-8 text-yellow-400" />
              </div>
              <h3 className="text-white font-bold text-lg text-center">{t('settingsResetTitle')}</h3>
              <p className="text-white/50 text-sm text-center leading-relaxed">{t('settingsResetDesc')}</p>
            </div>
            <div className="flex gap-2 p-4 pt-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => { reset(); setShowResetConfirm(false); }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-black bg-yellow-400 hover:bg-yellow-300 transition"
              >
                {t('settingsReset')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function SettingToggle({ icon: Icon, label, description, value, onChange, disabled }: {
  icon: typeof Settings;
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-white/10'}`}
      >
        <motion.div
          animate={{ x: value ? 20 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
        />
      </button>
    </div>
  );
}

function SettingSelect<T extends string>({ icon: Icon, label, value, options, onChange }: {
  icon: typeof Settings;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 pr-7">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              value === opt.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingSlider({ icon: Icon, label, value, min, max, step, unit, onChange }: {
  icon: typeof Settings;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground flex-1">{label}</p>
        <span className="text-xs text-primary font-mono">{value}{unit}</span>
      </div>
      <div className="pr-7">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full accent-primary h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>{min}{unit}</span>
          <span>{max}{unit}</span>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
      {children}
    </div>
  );
}

function GeneralSettings({ settings, update, lang, setLang, t }: any) {
  return (
    <>
      <SettingsCard>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-medium text-foreground">{t('interfaceLanguage')}</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5 pr-7">
            {LANGUAGES.map((l: any) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                  lang === l.code
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                }`}
              >
                <span className="text-xl leading-none">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingToggle
          icon={Sparkles}
          label={t('settingsReduceMotion')}
          description={t('settingsReduceMotionDesc')}
          value={settings.reduceMotion}
          onChange={v => update({ reduceMotion: v })}
        />
        <SettingToggle
          icon={Monitor}
          label={t('settingsCompactMode')}
          description={t('settingsCompactModeDesc')}
          value={settings.compactMode}
          onChange={v => update({ compactMode: v })}
        />
        <SettingToggle
          icon={DoorOpen}
          label={t('settingsConfirmLeave')}
          description={t('settingsConfirmLeaveDesc')}
          value={settings.confirmBeforeLeave}
          onChange={v => update({ confirmBeforeLeave: v })}
        />
      </SettingsCard>
    </>
  );
}

function NotificationSettings({ settings, update, t, userId }: any) {
  const { permission, loading: pushLoading, subscribe, refresh: refreshPush, isSupported } = usePush(userId);

  return (
    <>
      <SettingsCard>
        <div className="flex items-center gap-3 px-4 py-3">
          <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{t('settingsPushNotifs')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {!isSupported
                ? t('notifNotSupported')
                : permission === 'granted'
                  ? t('notifEnabled')
                  : permission === 'denied'
                    ? t('notifBlocked')
                    : t('notifDisabled')}
            </p>
          </div>
          {isSupported && permission !== 'granted' && permission !== 'denied' && (
            <button
              onClick={subscribe}
              disabled={pushLoading}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {t('notifEnable')}
            </button>
          )}
          {permission === 'granted' && (
            <button
              onClick={refreshPush}
              disabled={pushLoading}
              className="px-3 py-1.5 bg-muted rounded-xl text-xs text-muted-foreground font-medium disabled:opacity-50"
            >
              {t('notifRefresh')}
            </button>
          )}
          {permission === 'granted' && <Check className="w-4 h-4 text-green-400" />}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingToggle
          icon={Volume2}
          label={t('settingsChatSounds')}
          description={t('settingsChatSoundsDesc')}
          value={settings.chatSounds}
          onChange={v => update({ chatSounds: v })}
        />
        <SettingToggle
          icon={UserCheck}
          label={t('settingsFriendNotifs')}
          description={t('settingsFriendNotifsDesc')}
          value={settings.friendRequestNotifs}
          onChange={v => update({ friendRequestNotifs: v })}
        />
        <SettingToggle
          icon={DoorOpen}
          label={t('settingsRoomInviteNotifs')}
          description={t('settingsRoomInviteNotifsDesc')}
          value={settings.roomInviteNotifs}
          onChange={v => update({ roomInviteNotifs: v })}
        />
        <SettingToggle
          icon={Bell}
          label={t('settingsMentionNotifs')}
          description={t('settingsMentionNotifsDesc')}
          value={settings.mentionNotifs}
          onChange={v => update({ mentionNotifs: v })}
        />
      </SettingsCard>
    </>
  );
}

function ChatSettings({ settings, update, t }: any) {
  return (
    <SettingsCard>
      <SettingToggle
        icon={Eye}
        label={t('settingsShowTimestamps')}
        description={t('settingsShowTimestampsDesc')}
        value={settings.showTimestamps}
        onChange={v => update({ showTimestamps: v })}
      />
      <SettingSelect
        icon={MessageSquare}
        label={t('settingsChatFontSize')}
        value={settings.chatFontSize}
        options={[
          { value: 'small', label: t('settingsFontSmall') },
          { value: 'normal', label: t('settingsFontNormal') },
          { value: 'large', label: t('settingsFontLarge') },
        ]}
        onChange={v => update({ chatFontSize: v })}
      />
      <SettingToggle
        icon={MousePointerClick}
        label={t('settingsEnterSends')}
        description={t('settingsEnterSendsDesc')}
        value={settings.enterSends}
        onChange={v => update({ enterSends: v })}
      />
      <SettingToggle
        icon={Users}
        label={t('settingsShowJoinLeave')}
        description={t('settingsShowJoinLeaveDesc')}
        value={settings.showJoinLeave}
        onChange={v => update({ showJoinLeave: v })}
      />
      <SettingToggle
        icon={Mail}
        label={t('settingsMessagePreviews')}
        description={t('settingsMessagePreviewsDesc')}
        value={settings.messagePreviews}
        onChange={v => update({ messagePreviews: v })}
      />
    </SettingsCard>
  );
}

function PlayerSettings({ settings, update, t }: any) {
  return (
    <>
      <SettingsCard>
        <SettingToggle
          icon={Play}
          label={t('settingsAutoPlay')}
          description={t('settingsAutoPlayDesc')}
          value={settings.autoPlay}
          onChange={v => update({ autoPlay: v })}
        />
        <SettingSlider
          icon={Volume2}
          label={t('settingsDefaultVolume')}
          value={settings.defaultVolume}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={v => update({ defaultVolume: v })}
        />
        <SettingToggle
          icon={Sparkles}
          label={t('settingsSponsorBlock')}
          description={t('settingsSponsorBlockDesc')}
          value={settings.sponsorBlock}
          onChange={v => update({ sponsorBlock: v })}
        />
      </SettingsCard>
      <SettingsCard>
        <SettingSelect
          icon={Monitor}
          label={t('settingsVideoQuality')}
          value={settings.videoQuality}
          options={[
            { value: 'auto', label: t('settingsQualityAuto') },
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
            { value: '480p', label: '480p' },
            { value: '360p', label: '360p' },
          ]}
          onChange={v => update({ videoQuality: v })}
        />
        <SettingToggle
          icon={Maximize}
          label={t('settingsTheaterMode')}
          description={t('settingsTheaterModeDesc')}
          value={settings.theaterMode}
          onChange={v => update({ theaterMode: v })}
        />
        <SettingToggle
          icon={Captions}
          label={t('settingsSubtitleAuto')}
          description={t('settingsSubtitleAutoDesc')}
          value={settings.subtitleAutoEnable}
          onChange={v => update({ subtitleAutoEnable: v })}
        />
        <SettingToggle
          icon={Maximize}
          label={t('settingsDoubleClickFS')}
          description={t('settingsDoubleClickFSDesc')}
          value={settings.doubleClickFullscreen}
          onChange={v => update({ doubleClickFullscreen: v })}
        />
      </SettingsCard>
    </>
  );
}

function PrivacySettings({ settings, update, t }: any) {
  return (
    <SettingsCard>
      <SettingToggle
        icon={Eye}
        label={t('settingsShowOnline')}
        description={t('settingsShowOnlineDesc')}
        value={settings.showOnlineStatus}
        onChange={v => update({ showOnlineStatus: v })}
      />
      <SettingToggle
        icon={UserCheck}
        label={t('settingsAllowFriendReqs')}
        description={t('settingsAllowFriendReqsDesc')}
        value={settings.allowFriendRequests}
        onChange={v => update({ allowFriendRequests: v })}
      />
      <SettingSelect
        icon={Users}
        label={t('settingsProfileVisibility')}
        value={settings.profileVisibility}
        options={[
          { value: 'public', label: t('settingsVisibilityPublic') },
          { value: 'friends', label: t('settingsVisibilityFriends') },
        ]}
        onChange={v => update({ profileVisibility: v })}
      />
      <SettingToggle
        icon={Mail}
        label={t('settingsAllowDMs')}
        description={t('settingsAllowDMsDesc')}
        value={settings.allowDMs}
        onChange={v => update({ allowDMs: v })}
      />
    </SettingsCard>
  );
}

function AccountSettings({ t }: { t: (k: any) => string }) {
  const { updateProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async () => {
    if (!currentPassword || !newPassword) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateProfile({ currentPassword, newPassword });
      setSuccess(t('saveSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsCard>
        <div className="px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-medium text-foreground">{t('changePassword')}</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder={t('currentPassword')}
              className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={t('newPassword')}
              className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleSave}
              disabled={saving || !currentPassword || !newPassword}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {t('save')}
            </button>
          </div>
          {success && (
            <div className="mt-3 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-xl text-green-500 text-sm text-center">{success}</div>
          )}
          {error && (
            <div className="mt-3 px-4 py-2 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm text-center">{error}</div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}
