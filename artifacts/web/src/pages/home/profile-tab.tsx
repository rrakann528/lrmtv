import { useState, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Edit3, LogOut, Save, X, Shield, Camera, Trash2, Settings } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/lib/i18n';
import { useLocation } from 'wouter';

const AVATAR_COLORS = [
  '#06B6D4', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#EF4444', '#3B82F6', '#F97316',
  '#84CC16', '#E879F9',
];

type Section = null | 'name' | 'username' | 'bio' | 'avatar';

export function ProfileTab() {
  const { user, logout, updateProfile, setUser } = useAuth();
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [section, setSection] = useState<Section>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor || '#06B6D4');

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

  const compressImage = (file: File, maxSize: number = 256, quality: number = 0.8): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
        else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas error')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob); else reject(new Error('Compression failed'));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const compressed = await compressImage(file, 256, 0.8);
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

  const handleRemovePhoto = async () => {
    await save({ avatarUrl: '' });
  };

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
            {uploading ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
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

        <ProfileSection
          label={t('avatarLabel')}
          value={t('initialsColor')}
          onEdit={() => setSection('avatar')}
          isOpen={section === 'avatar'}
          onClose={() => setSection(null)}
        >
          <div className="flex justify-center py-1">
            <Avatar name={name} color={avatarColor} size={72} />
          </div>
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
          <SaveBtn saving={saving} onClick={() => save({ avatarColor, avatarUrl: '' })} label={t('save')} />
        </ProfileSection>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setLocation('/settings')}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary/10 border border-primary/20 text-primary rounded-2xl font-semibold text-sm"
        >
          <Settings className="w-4 h-4" />
          {t('settings')}
        </motion.button>

        {user?.isSiteAdmin && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/admin')}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-2xl font-semibold text-sm mt-2"
          >
            <Shield className="w-4 h-4" />
            {t('adminPanel')}
          </motion.button>
        )}

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
