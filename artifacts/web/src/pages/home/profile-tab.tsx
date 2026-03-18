import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Edit3, LogOut, Save, X, Bell, BellOff, Shield } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import { useLocation } from 'wouter';
import {
  AVATARS, AVATAR_CATEGORIES, CATEGORY_LABELS,
  toPresetUrl, isPresetAvatar, getPresetId,
} from '@/lib/avatars';

const AVATAR_COLORS = [
  '#06B6D4', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#EF4444', '#3B82F6', '#F97316',
  '#84CC16', '#E879F9',
];

type Section = null | 'name' | 'username' | 'bio' | 'avatar' | 'password';

export function ProfileTab() {
  const { user, logout, updateProfile } = useAuth();
  const { lang, setLang, t } = useI18n();
  const [, setLocation] = useLocation();
  const { permission, loading: pushLoading, subscribe, refresh: refreshPush, test: testPush, isSupported } = usePush(user?.id);
  const [testMsg, setTestMsg] = useState<'idle' | 'sent' | 'fail'>('idle');
  const [section, setSection] = useState<Section>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor || '#06B6D4');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [avatarCategory, setAvatarCategory] = useState<typeof AVATAR_CATEGORIES[number]>('boy');

  if (!user) return null;

  const save = async (updates: Parameters<typeof updateProfile>[0]) => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await updateProfile(updates);
      setSuccess(t('saveSuccess'));
      setSection(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const name = user.displayName || user.username;

  const currentPresetId = isPresetAvatar(user.avatarUrl) ? getPresetId(user.avatarUrl!) : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Profile header */}
      <div className="flex flex-col items-center pt-8 pb-6 px-4 bg-card border-b border-border">
        <div className="relative mb-3">
          <Avatar name={name} color={user.avatarColor} url={user.avatarUrl} size={88} />
          <button
            onClick={() => { setSection('avatar'); }}
            className="absolute -bottom-1 -left-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg text-primary-foreground text-base leading-none"
          >
            ✏️
          </button>
        </div>
        <h2 className="text-xl font-bold text-foreground">{name}</h2>
        <p className="text-sm text-muted-foreground">@{user.username}</p>
        {user.bio && <p className="text-sm text-muted-foreground mt-1 text-center">{user.bio}</p>}
      </div>

      {/* Success/Error banner */}
      {success && (
        <div className="mx-4 mt-3 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-xl text-green-500 text-sm text-center">{success}</div>
      )}
      {error && (
        <div className="mx-4 mt-3 px-4 py-2 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm text-center">{error}</div>
      )}

      <div className="flex-1 px-4 py-4 space-y-3">

        {/* Display Name */}
        <ProfileSection
          label={t('displayNameLabel')}
          value={user.displayName || t('notSet')}
          onEdit={() => { setDisplayName(user.displayName || ''); setSection('name'); }}
          isOpen={section === 'name'}
          onClose={() => setSection(null)}
        >
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={t('displayNamePlaceholder')}
            maxLength={40}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <SaveBtn saving={saving} onClick={() => save({ displayName })} label={t('save')} />
        </ProfileSection>

        {/* Username */}
        <ProfileSection
          label={t('usernameLabel')}
          value={`@${user.username}`}
          onEdit={() => { setUsername(user.username); setSection('username'); }}
          isOpen={section === 'username'}
          onClose={() => setSection(null)}
        >
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('usernamePlaceholder')}
            maxLength={32}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            dir="ltr"
          />
          <SaveBtn saving={saving} onClick={() => save({ username })} label={t('save')} />
        </ProfileSection>

        {/* Bio */}
        <ProfileSection
          label={t('bioLabel')}
          value={user.bio || t('bioEmpty')}
          onEdit={() => { setBio(user.bio || ''); setSection('bio'); }}
          isOpen={section === 'bio'}
          onClose={() => setSection(null)}
        >
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder={t('bioPlaceholder')}
            maxLength={160}
            rows={3}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground text-left">{bio.length}/160</p>
          <SaveBtn saving={saving} onClick={() => save({ bio })} label={t('save')} />
        </ProfileSection>

        {/* Avatar Picker */}
        <ProfileSection
          label={t('avatarLabel')}
          value={t('avatarCustomize')}
          onEdit={() => setSection('avatar')}
          isOpen={section === 'avatar'}
          onClose={() => setSection(null)}
        >
          {/* Preview */}
          <div className="flex justify-center py-1">
            <Avatar
              name={name}
              color={avatarColor}
              url={isPresetAvatar(avatarUrl) ? avatarUrl : undefined}
              size={72}
            />
          </div>

          {/* Category tabs — only show non-empty categories */}
          <div className="flex gap-1.5 justify-center">
            {AVATAR_CATEGORIES.filter(cat => AVATARS[cat].length > 0).map(cat => (
              <button
                key={cat}
                onClick={() => setAvatarCategory(cat)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  avatarCategory === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {CATEGORY_LABELS[cat].ar}
              </button>
            ))}
          </div>

          {/* Avatar grid */}
          <div className="grid grid-cols-4 gap-2">
            {AVATARS[avatarCategory].map(av => {
              const selected = (avatarUrl === toPresetUrl(av.id)) || (currentPresetId === av.id && !avatarUrl);
              return (
                <button
                  key={av.id}
                  onClick={() => setAvatarUrl(toPresetUrl(av.id))}
                  className={`aspect-square rounded-2xl overflow-hidden transition-all bg-white ${
                    selected
                      ? 'ring-2 ring-primary scale-105 shadow-lg'
                      : 'ring-1 ring-border opacity-80 hover:opacity-100'
                  }`}
                >
                  <img src={av.url} alt={av.label} className="w-full h-full object-cover" />
                </button>
              );
            })}
            {/* No avatar / initials option */}
            <button
              onClick={() => setAvatarUrl('')}
              className={`aspect-square rounded-2xl overflow-hidden transition-all flex items-center justify-center text-xs font-bold ${
                !avatarUrl || !isPresetAvatar(avatarUrl)
                  ? 'ring-2 ring-primary scale-105 shadow-lg bg-primary/20 text-primary'
                  : 'ring-1 ring-border bg-muted text-muted-foreground'
              }`}
            >
              <span style={{ fontSize: 22 }}>{name.slice(0, 1).toUpperCase()}</span>
            </button>
          </div>

          {/* Color picker (for initials avatar) */}
          {(!avatarUrl || !isPresetAvatar(avatarUrl)) && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground text-center">{t('initialsColor')}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {AVATAR_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-8 h-8 rounded-full transition-transform ${avatarColor === c ? 'scale-110 ring-2 ring-white ring-offset-1 ring-offset-background' : ''}`}
                  />
                ))}
              </div>
            </div>
          )}

          <SaveBtn saving={saving} onClick={() => save({ avatarColor, avatarUrl })} label={t('save')} />
        </ProfileSection>


        {/* Notifications */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t('notificationsLabel')}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                {!isSupported
                  ? t('notifNotSupported')
                  : permission === 'granted'
                    ? t('notifEnabled')
                    : permission === 'denied'
                      ? t('notifBlocked')
                      : t('notifDisabled')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isSupported && permission !== 'granted' && permission !== 'denied' && (
                <button
                  onClick={subscribe}
                  disabled={pushLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold disabled:opacity-50"
                >
                  {pushLoading
                    ? <div className="w-3 h-3 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
                    : <Bell className="w-3.5 h-3.5" />}
                  {t('notifEnable')}
                </button>
              )}
              {permission === 'granted' && (
                <button
                  onClick={refreshPush}
                  disabled={pushLoading}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-muted rounded-xl text-xs text-muted-foreground font-medium disabled:opacity-50"
                >
                  {pushLoading
                    ? <div className="w-3 h-3 border-2 border-muted-foreground/40 border-t-transparent rounded-full animate-spin" />
                    : <Bell className="w-3.5 h-3.5" />}
                  {t('notifRefresh')}
                </button>
              )}
              {permission === 'granted' && (
                <button
                  onClick={async () => {
                    setTestMsg('idle');
                    const ok = await testPush();
                    setTestMsg(ok ? 'sent' : 'fail');
                    setTimeout(() => setTestMsg('idle'), 4000);
                  }}
                  disabled={pushLoading}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/20 rounded-xl text-xs text-green-500 font-medium disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {t('notifTest')}
                </button>
              )}
              {permission === 'denied' && (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <BellOff className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
          {testMsg !== 'idle' && (
            <div className={`px-4 py-2 text-xs text-center border-t border-border ${testMsg === 'sent' ? 'text-green-500' : 'text-destructive'}`}>
              {testMsg === 'sent' ? t('notifSent') : t('notifFailed')}
            </div>
          )}
        </div>

        {/* Admin panel link — visible to site admins only */}
        {user?.isSiteAdmin && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/admin')}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-2xl font-semibold text-sm mt-4"
          >
            <Shield className="w-4 h-4" />
            {t('adminPanel')}
          </motion.button>
        )}

        {/* ── Language selector ───────────────────────────── */}
        <div className="mt-4 bg-card border border-border rounded-2xl overflow-hidden">
          <p className="text-xs text-muted-foreground px-4 pt-3 pb-2">
            {t('interfaceLanguage')}
          </p>
          <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                  lang === l.code
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="text-xl leading-none">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Logout */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={async () => { await logout(); setLocation('/'); }}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl font-semibold text-sm mt-4"
        >
          <LogOut className="w-4 h-4" />
          {t('logout')}
        </motion.button>
      </div>
    </div>
  );
}

function ProfileSection({ label, value, onEdit, isOpen, onClose, children }: {
  label: string;
  value: string;
  onEdit: () => void;
  isOpen: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={isOpen ? onClose : onEdit}
        className="w-full flex items-center justify-between px-4 py-3.5"
      >
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
        </div>
        {isOpen ? (
          <X className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Edit3 className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function SaveBtn({ saving, onClick, label = 'حفظ' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
    >
      {saving ? (
        <div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
      ) : (
        <Save className="w-4 h-4" />
      )}
      {label}
    </button>
  );
}
