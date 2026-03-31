import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Upload, FolderOpen, Link, Check, Search, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubtitleSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (srtText: string, label: string, sourceUrl?: string) => void;
  lang?: 'en' | 'ar';
}

interface SubtitleResult {
  subtitle_id: string;
  file_id: number;
  file_name: string;
  language: string;
  download_count: number;
  ratings: number;
  movie_name: string;
  episode_title: string;
  season?: number;
  episode?: number;
  feature_type: string;
}

type Tab = 'search' | 'upload' | 'url';

const LANG_LABELS: Record<string, string> = {
  ar: 'عربي', en: 'English', fr: 'Français', tr: 'Türkçe',
  es: 'Español', zh: '中文', de: 'Deutsch', it: 'Italiano',
  pt: 'Português', ru: 'Русский', ja: '日本語', ko: '한국어',
};

export default function SubtitleSearch({ isOpen, onClose, onApply, lang = 'en' }: SubtitleSearchProps) {
  const isAr = lang === 'ar';
  const [tab, setTab] = useState<Tab>('search');

  // ── Search tab ──────────────────────────────────────────────────────────────
  const [query, setQuery]         = useState('');
  const [season, setSeason]       = useState('');
  const [episode, setEpisode]     = useState('');
  const [searchLang, setSearchLang] = useState('ar,en');
  const [results, setResults]     = useState<SubtitleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const params = new URLSearchParams({ q, lang: searchLang });
      if (season.trim())  params.set('season', season.trim());
      if (episode.trim()) params.set('episode', episode.trim());
      const r = await fetch(`/api/subtitles/search?${params}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `Error ${r.status}`);
      setResults(json as SubtitleResult[]);
      if ((json as SubtitleResult[]).length === 0) {
        setSearchError(isAr ? 'لا توجد نتائج' : 'No results found');
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query, season, episode, searchLang, isAr]);

  const doDownload = useCallback(async (item: SubtitleResult) => {
    if (!item.file_id) return;
    setDownloading(String(item.subtitle_id));
    try {
      const r = await fetch('/api/subtitles/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: item.file_id }),
      });
      const json = await r.json() as { link?: string; error?: string };
      if (!r.ok || !json.link) throw new Error(json.error ?? 'Download failed');

      const proxy = await fetch(`/api/proxy/subtitle?url=${encodeURIComponent(json.link)}`);
      if (!proxy.ok) throw new Error('Proxy error');
      const text = await proxy.text();
      const label = item.movie_name || item.file_name.replace(/\.[^.]+$/, '') || 'subtitle';
      onApply(text, label, json.link);
      onClose();
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  }, [onApply, onClose]);

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
  const [url, setUrl]               = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError]     = useState<string | null>(null);

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

  const TABS: { id: Tab; label: string; labelAr: string; icon: React.ReactNode }[] = [
    { id: 'search', label: 'Search',      labelAr: 'بحث',      icon: <Search className="w-3.5 h-3.5" /> },
    { id: 'upload', label: 'Upload file', labelAr: 'رفع ملف',  icon: <FolderOpen className="w-3.5 h-3.5" /> },
    { id: 'url',    label: 'URL link',    labelAr: 'رابط URL', icon: <Link className="w-3.5 h-3.5" /> },
  ];

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
            className="absolute inset-x-0 bottom-0 z-50 bg-zinc-900 rounded-t-2xl border-t border-white/10 flex flex-col max-h-[85%]"
          >
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-base">
                  {isAr ? 'ترجمة' : 'Subtitles'}
                </h3>
                <span className="text-[10px] text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded-full font-medium">
                  OpenSubtitles
                </span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex mx-4 mb-3 bg-white/5 rounded-xl p-1 shrink-0">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition',
                    tab === t.id ? 'bg-primary text-white shadow' : 'text-white/50 hover:text-white',
                  )}
                >
                  {t.icon}
                  {isAr ? t.labelAr : t.label}
                </button>
              ))}
            </div>

            {/* ── Search tab ─────────────────────────────────────────── */}
            {tab === 'search' && (
              <div className="flex flex-col overflow-hidden flex-1 min-h-0">
                {/* Inputs */}
                <div className="flex flex-col px-4 gap-2 shrink-0">
                  {/* Query + Lang */}
                  <div className="flex gap-2">
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && doSearch()}
                      placeholder={isAr ? 'اسم الفيلم أو المسلسل…' : 'Movie or show name…'}
                      dir="auto"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl text-white text-sm py-2.5 px-3 placeholder-white/25 focus:outline-none focus:border-primary/60"
                    />
                    <select
                      value={searchLang}
                      onChange={e => setSearchLang(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-xl text-white/80 text-xs py-2.5 px-2 focus:outline-none focus:border-primary/60 shrink-0"
                    >
                      <option value="ar,en">عربي + EN</option>
                      {Object.entries(LANG_LABELS).map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Season / Episode (optional) */}
                  <div className="flex gap-2">
                    <input
                      value={season}
                      onChange={e => setSeason(e.target.value)}
                      placeholder={isAr ? 'موسم (اختياري)' : 'Season (opt.)'}
                      type="number" min="1"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl text-white text-sm py-2 px-3 placeholder-white/20 focus:outline-none focus:border-primary/60"
                    />
                    <input
                      value={episode}
                      onChange={e => setEpisode(e.target.value)}
                      placeholder={isAr ? 'حلقة (اختياري)' : 'Episode (opt.)'}
                      type="number" min="1"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl text-white text-sm py-2 px-3 placeholder-white/20 focus:outline-none focus:border-primary/60"
                    />
                  </div>

                  {/* Search button */}
                  <button
                    onClick={doSearch}
                    disabled={searching || !query.trim()}
                    className="flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-xl transition mb-1"
                  >
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    {isAr ? 'بحث' : 'Search'}
                  </button>

                  {searchError && (
                    <p className="text-red-400 text-xs text-center pb-1">{searchError}</p>
                  )}
                </div>

                {/* Results */}
                {results.length > 0 && (
                  <div className="overflow-y-auto flex-1 px-4 pb-6 mt-1 space-y-1.5">
                    {results.map(item => (
                      <button
                        key={item.subtitle_id}
                        onClick={() => doDownload(item)}
                        disabled={downloading === String(item.subtitle_id)}
                        className="w-full flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/8 rounded-xl px-3 py-2.5 text-right transition disabled:opacity-60"
                        dir={isAr ? 'rtl' : 'ltr'}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-white/90 text-xs font-semibold truncate">
                            {item.movie_name || item.file_name}
                          </p>
                          {item.episode_title && (
                            <p className="text-white/40 text-[10px] truncate">{item.episode_title}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-primary text-[10px] font-medium">
                              {LANG_LABELS[item.language] ?? item.language}
                            </span>
                            {item.season != null && (
                              <span className="text-white/30 text-[10px]">
                                S{String(item.season).padStart(2,'0')}E{String(item.episode ?? 0).padStart(2,'0')}
                              </span>
                            )}
                            <span className="text-white/25 text-[10px]">
                              ↓ {(item.download_count ?? 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {downloading === String(item.subtitle_id)
                          ? <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                          : <Download className="w-4 h-4 text-white/30 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {!searching && results.length === 0 && !searchError && (
                  <div className="flex flex-col items-center justify-center flex-1 pb-8 gap-2 text-white/25">
                    <Search className="w-8 h-8" />
                    <p className="text-xs">{isAr ? 'ابحث عن ترجمة…' : 'Search for subtitles…'}</p>
                    <p className="text-[10px] text-white/15">Powered by OpenSubtitles.com</p>
                  </div>
                )}
              </div>
            )}

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
