import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Upload, FolderOpen, Link, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubtitleSearchProps {
  isOpen: boolean;
  onClose: () => void;
  /** sourceUrl is provided when subtitle came from a URL (so others can fetch it), absent for file uploads */
  onApply: (srtText: string, label: string, sourceUrl?: string) => void;
  lang?: 'en' | 'ar';
}

type Tab = 'upload' | 'url';

export default function SubtitleSearch({ isOpen, onClose, onApply, lang = 'en' }: SubtitleSearchProps) {
  const isAr = lang === 'ar'; // used for text only
  const [tab, setTab] = useState<Tab>('upload');

  // ── Upload tab ──────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'srt' && ext !== 'vtt' && ext !== 'ass' && ext !== 'ssa') {
      setFileError(isAr ? 'صيغة غير مدعومة — استخدم SRT أو VTT' : 'Unsupported format — use SRT or VTT');
      return;
    }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      onApply(ev.target?.result as string, file.name.replace(/\.[^.]+$/, ''));
      onClose();
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }, [isAr, onApply, onClose]);

  // ── URL tab ─────────────────────────────────────────────────────────────────
  const [url, setUrl]           = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const applyUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setUrlLoading(true);
    setUrlError(null);
    try {
      const r = await fetch(`/api/proxy/subtitle?url=${encodeURIComponent(trimmed)}`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const text = await r.text();
      if (!text.trim()) throw new Error(isAr ? 'الملف فارغ' : 'Empty file');
      const label = trimmed.split('/').pop()?.replace(/\?.*$/, '').replace(/\.[^.]+$/, '') ?? 'subtitle';
      onApply(text, label, trimmed);
      onClose();
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : String(e));
    } finally {
      setUrlLoading(false);
    }
  }, [url, isAr, onApply, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 z-40"
            onClick={onClose}
          />

          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-50 bg-zinc-900 rounded-t-2xl border-t border-white/10 flex flex-col"
          >
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3">
              <h3 className="text-white font-semibold text-base">
                {isAr ? 'ترجمة' : 'Subtitles'}
              </h3>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex mx-4 mb-4 bg-white/5 rounded-xl p-1">
              {(['upload', 'url'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition',
                    tab === t ? 'bg-primary text-white shadow' : 'text-white/50 hover:text-white',
                  )}
                >
                  {t === 'upload'
                    ? <><FolderOpen className="w-3.5 h-3.5" />{isAr ? 'رفع ملف' : 'Upload file'}</>
                    : <><Link className="w-3.5 h-3.5" />{isAr ? 'رابط URL' : 'URL link'}</>}
                </button>
              ))}
            </div>

            {/* ── Upload tab ─────────────────────────────────────────── */}
            {tab === 'upload' && (
              <div className="flex flex-col items-center px-6 pb-10 gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-white/40" />
                </div>
                <div className="text-center">
                  <p className="text-white font-medium text-sm">
                    {isAr ? 'ارفع ملف ترجمة من جهازك' : 'Upload a subtitle file from your device'}
                  </p>
                  <p className="text-white/35 text-xs mt-1">SRT · VTT · ASS</p>
                </div>
                {fileError && <p className="text-red-400 text-xs text-center">{fileError}</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt,.vtt,.ass,.ssa"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-95 text-white font-medium text-sm px-6 py-2.5 rounded-xl transition"
                >
                  <FolderOpen className="w-4 h-4" />
                  {isAr ? 'اختر ملف…' : 'Choose file…'}
                </button>
              </div>
            )}

            {/* ── URL tab ────────────────────────────────────────────── */}
            {tab === 'url' && (
              <div className="flex flex-col px-4 pb-10 gap-3">
                <p className="text-white/50 text-xs">
                  {isAr
                    ? 'أدخل رابطاً مباشراً لملف SRT أو VTT'
                    : 'Paste a direct link to an SRT or VTT file'}
                </p>
                <div className="relative">
                  <Link className="absolute top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none right-3" />
                  <input
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(null); }}
                    onKeyDown={e => e.key === 'Enter' && applyUrl()}
                    placeholder="https://example.com/subtitle.srt"
                    dir="ltr"
                    className={cn(
                      'w-full bg-white/5 border border-white/10 rounded-xl text-white text-sm py-2.5',
                      'pr-9 pl-3',
                      'placeholder-white/20 focus:outline-none focus:border-primary/60',
                    )}
                  />
                </div>
                {urlError && <p className="text-red-400 text-xs">{urlError}</p>}
                <button
                  onClick={applyUrl}
                  disabled={urlLoading || !url.trim()}
                  className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-xl transition"
                >
                  {urlLoading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Check className="w-4 h-4" />}
                  {isAr ? 'تطبيق' : 'Apply'}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
