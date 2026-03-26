import { motion } from 'framer-motion';
import {
  X, MessageSquare, Volume2, Eye, EyeOff, Bell, BellOff,
  Clock, Type, MousePointerClick, Users, Play, Maximize,
  Captions, SkipForward, Monitor, Sparkles, Send,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSettings, type AppSettings } from '@/lib/settings';

interface Props {
  onClose: () => void;
}

export function UserRoomSettings({ onClose }: Props) {
  const { t, dir } = useI18n();
  const isRTL = dir === 'rtl';
  const [settings, update] = useSettings();

  return (
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: isRTL ? -30 : 30 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={`absolute inset-y-0 ${isRTL ? 'left-0' : 'right-0'} w-full max-w-sm flex flex-col overflow-hidden`}
        style={{ background: 'rgba(12,12,14,0.98)', [isRTL ? 'borderRight' : 'borderLeft']: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {t('userRoomSettings')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/50 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          <SettingsGroup label={t('ursChatSection')}>
            <Toggle
              icon={Bell}
              iconOff={BellOff}
              label={t('ursChatSounds')}
              desc={t('ursChatSoundsDesc')}
              value={settings.chatSounds}
              onChange={v => update({ chatSounds: v })}
            />
            <Toggle
              icon={Clock}
              label={t('ursShowTimestamps')}
              desc={t('ursShowTimestampsDesc')}
              value={settings.showTimestamps}
              onChange={v => update({ showTimestamps: v })}
            />
            <Toggle
              icon={Users}
              label={t('ursShowJoinLeave')}
              desc={t('ursShowJoinLeaveDesc')}
              value={settings.showJoinLeave}
              onChange={v => update({ showJoinLeave: v })}
            />
            <Toggle
              icon={Send}
              label={t('ursEnterSends')}
              desc={t('ursEnterSendsDesc')}
              value={settings.enterSends}
              onChange={v => update({ enterSends: v })}
            />
            <Toggle
              icon={Eye}
              iconOff={EyeOff}
              label={t('ursMessagePreviews')}
              desc={t('ursMessagePreviewsDesc')}
              value={settings.messagePreviews}
              onChange={v => update({ messagePreviews: v })}
            />
            <Select
              icon={Type}
              label={t('ursChatFontSize')}
              value={settings.chatFontSize}
              options={[
                { value: 'small', label: t('settingsFontSmall') },
                { value: 'normal', label: t('settingsFontNormal') },
                { value: 'large', label: t('settingsFontLarge') },
              ]}
              onChange={v => update({ chatFontSize: v as AppSettings['chatFontSize'] })}
            />
          </SettingsGroup>

          <SettingsGroup label={t('ursPlayerSection')}>
            <Toggle
              icon={Play}
              label={t('ursAutoPlay')}
              desc={t('ursAutoPlayDesc')}
              value={settings.autoPlay}
              onChange={v => update({ autoPlay: v })}
            />
            <Slider
              icon={Volume2}
              label={t('ursDefaultVolume')}
              value={settings.defaultVolume}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={v => update({ defaultVolume: v })}
            />
            <Toggle
              icon={Maximize}
              label={t('ursTheaterMode')}
              desc={t('ursTheaterModeDesc')}
              value={settings.theaterMode}
              onChange={v => update({ theaterMode: v })}
            />
            <Toggle
              icon={Captions}
              label={t('ursSubtitleAuto')}
              desc={t('ursSubtitleAutoDesc')}
              value={settings.subtitleAutoEnable}
              onChange={v => update({ subtitleAutoEnable: v })}
            />
            <Toggle
              icon={Maximize}
              label={t('ursDoubleClickFS')}
              desc={t('ursDoubleClickFSDesc')}
              value={settings.doubleClickFullscreen}
              onChange={v => update({ doubleClickFullscreen: v })}
            />
            <Select
              icon={Monitor}
              label={t('ursVideoQuality')}
              value={settings.videoQuality}
              options={[
                { value: 'auto', label: t('settingsQualityAuto') },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
                { value: '480p', label: '480p' },
                { value: '360p', label: '360p' },
              ]}
              onChange={v => update({ videoQuality: v as AppSettings['videoQuality'] })}
            />
          </SettingsGroup>

          <SettingsGroup label={t('ursGeneralSection')}>
            <Toggle
              icon={Monitor}
              label={t('ursCompactMode')}
              desc={t('ursCompactModeDesc')}
              value={settings.compactMode}
              onChange={v => update({ compactMode: v })}
            />
            <Toggle
              icon={Sparkles}
              label={t('ursReduceMotion')}
              desc={t('ursReduceMotionDesc')}
              value={settings.reduceMotion}
              onChange={v => update({ reduceMotion: v })}
            />
            <Toggle
              icon={MessageSquare}
              label={t('ursConfirmLeave')}
              desc={t('ursConfirmLeaveDesc')}
              value={settings.confirmBeforeLeave}
              onChange={v => update({ confirmBeforeLeave: v })}
            />
          </SettingsGroup>

        </div>
      </motion.div>
    </div>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-2 px-1">{label}</p>
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden divide-y divide-white/[0.04]">
        {children}
      </div>
    </div>
  );
}

function Toggle({ icon: Icon, iconOff: IconOff, label, desc, value, onChange }: {
  icon: typeof Eye;
  iconOff?: typeof Eye;
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const ActiveIcon = value ? Icon : (IconOff || Icon);
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition text-start">
      <ActiveIcon className={`w-4 h-4 shrink-0 ${value ? 'text-primary' : 'text-white/30'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white/90">{label}</p>
        <p className="text-[10px] text-white/40 leading-tight mt-0.5">{desc}</p>
      </div>
      <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${value ? 'bg-primary' : 'bg-white/10'}`}>
        <motion.div
          animate={{ x: value ? 16 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
        />
      </div>
    </button>
  );
}

function Select({ icon: Icon, label, value, options, onChange }: {
  icon: typeof Eye;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-4 h-4 text-white/30 shrink-0" />
        <p className="text-xs font-medium text-white/90">{label}</p>
      </div>
      <div className="flex flex-wrap gap-1 pe-7">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ icon: Icon, label, value, min, max, step, unit, onChange }: {
  icon: typeof Volume2;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3 mb-1.5">
        <Icon className="w-4 h-4 text-white/30 shrink-0" />
        <p className="text-xs font-medium text-white/90 flex-1">{label}</p>
        <span className="text-[11px] text-primary font-mono">{value}{unit}</span>
      </div>
      <div className="pe-7">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full accent-primary h-1 rounded-full appearance-none bg-white/10 cursor-pointer"
        />
      </div>
    </div>
  );
}
