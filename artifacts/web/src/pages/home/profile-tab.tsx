import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Edit3, LogOut, Save, X, Bell, BellOff, Globe } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/hooks/use-auth';
import { usePush } from '@/hooks/use-push';
import { useI18n } from '@/lib/i18n';
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
  const { lang, setLang } = useI18n();
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
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');

  if (!user) return null;

  const save = async (updates: Parameters<typeof updateProfile>[0]) => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await updateProfile(updates);
      setSuccess('تم الحفظ بنجاح');
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
          label="الاسم الظاهر"
          value={user.displayName || 'لم يُعيَّن'}
          onEdit={() => { setDisplayName(user.displayName || ''); setSection('name'); }}
          isOpen={section === 'name'}
          onClose={() => setSection(null)}
        >
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="اسمك الظاهر للآخرين"
            maxLength={40}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            dir="rtl"
          />
          <SaveBtn saving={saving} onClick={() => save({ displayName })} />
        </ProfileSection>

        {/* Username */}
        <ProfileSection
          label="اسم المستخدم"
          value={`@${user.username}`}
          onEdit={() => { setUsername(user.username); setSection('username'); }}
          isOpen={section === 'username'}
          onClose={() => setSection(null)}
        >
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="اسم المستخدم"
            maxLength={32}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            dir="ltr"
          />
          <SaveBtn saving={saving} onClick={() => save({ username })} />
        </ProfileSection>

        {/* Bio */}
        <ProfileSection
          label="نبذة عني"
          value={user.bio || 'أضف نبذة...'}
          onEdit={() => { setBio(user.bio || ''); setSection('bio'); }}
          isOpen={section === 'bio'}
          onClose={() => setSection(null)}
        >
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="اكتب نبذة مختصرة عنك"
            maxLength={160}
            rows={3}
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            dir="rtl"
          />
          <p className="text-xs text-muted-foreground text-left">{bio.length}/160</p>
          <SaveBtn saving={saving} onClick={() => save({ bio })} />
        </ProfileSection>

        {/* Avatar Picker */}
        <ProfileSection
          label="الصورة والألوان"
          value="تخصيص الأفاتار"
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
              <p className="text-xs text-muted-foreground text-center">لون الأحرف الأولى</p>
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

          <SaveBtn saving={saving} onClick={() => save({ avatarColor, avatarUrl })} />
        </ProfileSection>

        {/* Password */}
        <ProfileSection
          label="تغيير كلمة المرور"
          value="••••••••"
          onEdit={() => setSection('password')}
          isOpen={section === 'password'}
          onClose={() => setSection(null)}
        >
          <input
            type="password"
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            placeholder="كلمة المرور الحالية"
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary mb-2"
          />
          <input
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)"
            className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <SaveBtn saving={saving} onClick={() => save({ currentPassword: currentPw, newPassword: newPw })} label="تحديث كلمة المرور" />
        </ProfileSection>

        {/* Notifications */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">الإشعارات</p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                {!isSupported
                  ? 'غير مدعوم على هذا المتصفح'
                  : permission === 'granted'
                    ? 'مفعّلة'
                    : permission === 'denied'
                      ? 'محظورة من المتصفح'
                      : 'غير مفعّلة'}
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
                  تفعيل
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
                  تحديث
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
                  اختبار
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
              {testMsg === 'sent' ? 'تم الإرسال — تحقق من إشعاراتك!' : 'فشل الإرسال — جرّب "تحديث" أولاً'}
            </div>
          )}
        </div>

        {/* Language */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'اللغة' : 'Language'}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                {lang === 'ar' ? 'العربية' : 'English'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <div className="flex rounded-xl overflow-hidden border border-border">
                <button
                  onClick={() => setLang('ar')}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${lang === 'ar' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  العربية
                </button>
                <button
                  onClick={() => setLang('en')}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  English
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Logout */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={async () => { await logout(); setLocation('/'); }}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl font-semibold text-sm mt-4"
        >
          <LogOut className="w-4 h-4" />
          {lang === 'ar' ? 'تسجيل الخروج' : 'Log Out'}
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
