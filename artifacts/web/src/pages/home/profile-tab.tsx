import { useState, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Edit3, LogOut, Save, X, Bell, BellOff, Shield, Camera, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import { useLocation } from 'wouter';

type Section = null | 'name' | 'username' | 'bio';

export function ProfileTab() {
  const { user, logout, updateProfile, setUser } = useAuth();
  const { lang, setLang, t } = useI18n();
  const [, setLocation] = useLocation();
  const { permission, loading: pushLoading, subscribe, refresh: refreshPush, test: testPush, isSupported } = usePush(user?.id);
  const [testMsg, setTestMsg] = useState<'idle' | 'sent' | 'fail'>('idle');
  const [section, setSection] = useState<Section>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');

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
      setError(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const compressImage = (file: File, maxSize = 256, quality = 0.8): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
        else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas error')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = URL.createObjectURL(file);
    });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('file', compressed, 'avatar.jpg');
      const token = localStorage.getItem('lrmtv_auth_token');
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${BASE}/api/auth/avatar-upload`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const updated = await res.json();
      setUser(updated);
      setSuccess(t('saveSuccess'));
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError(t('saveError'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => { await save({ avatarUrl: '' }); };

  const name = user.displayName || user.username;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex flex-col items-center pt-8 pb-6 px-4 bg-card border-b border-border">
        <div className="relative mb-3">
          <Avatar name={name} color={user.avatarColor} url={user.avatarUrl} size={88} />
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 w-9 h-9 bg-primary rounded-full flex items-center justify-center shadow-lg text-primary-foreground"
          >
            {uploading
              ? <div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
              : <Camera className="w-4 h-4" />}
          </button>
          {user.avatarUrl && (
            <button
              onClick={handleRemovePhoto}
              className="absolute -bottom-1 -left-1 w-7 h-7 bg-destructive rounded-full flex items-center justify-center shadow-lg text-white"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <h2 className="text-xl font-bold text-foreground">{name}</h2>
        <p className="text-sm text-muted-foreground">@{user.username}</p>
        {user.bio && <p className="text-sm text-muted-foreground mt-1 text-center">{user.bio}</p>}
      </div>

      {success && (
        <div className="mx-4 mt-3 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-xl text-green-500 text-sm text-center">{success}</div>
      )}
      {error && (
        <div className="mx-4 mt-3 px-4 py-2 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm text-center">{error}</div>
      )}

      <div className="flex-1 px-4 py-4 space-y-3">

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
          <p className="text-xs text-muted-foreground text-start">{bio.length}/160</p>
          <SaveBtn saving={saving} onClick={() => save({ bio })} label={t('save')} />
        </ProfileSection>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
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

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={async () => { await logout(); setLocation('/'); }}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl font-semibold text-sm mt-4"
        >
          <LogOut className="w-4 h-4" />
          {t('logout')}
        </motion.button>

        <div className="flex items-center justify-center gap-4 mt-6 text-xs text-muted-foreground">
          <button onClick={() => setLocation('/terms')} className="hover:text-foreground transition">
            {t('terms')}
          </button>
          <span className="text-white/20">·</span>
          <button onClick={() => setLocation('/privacy')} className="hover:text-foreground transition">
            {t('privacy')}
          </button>
        </div>
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
        <div>
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

function SaveBtn({ saving, onClick, label = 'Save' }: { saving: boolean; onClick: () => void; label?: string }) {
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
