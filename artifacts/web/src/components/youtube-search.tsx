import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Search, Link as LinkIcon, Plus, Loader2, X, Youtube, Scan } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const LinkSniffer = lazy(() => import('./link-sniffer'));

interface YTResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
}

interface Props {
  onAdd: (url: string, title: string) => Promise<void> | void;
  onSniffAdd?: (url: string, title: string) => Promise<void> | void;
  isAdding?: boolean;
  lang?: string;
  isDj?: boolean;
  roomSlug?: string;
}

type Mode = 'search' | 'url' | 'sniff';

export default function YoutubeSearch({ onAdd, onSniffAdd, isAdding, lang = 'en', isDj, roomSlug }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery]   = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [results, setResults]   = useState<YTResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  const BASE = import.meta.env.BASE_URL as string;

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}api/youtube/search?q=${encodeURIComponent(q)}&maxResults=8`);
      if (!res.ok) throw new Error('Search failed');
      const data: { items: YTResult[] } = await res.json();
      setResults(data.items || []);
      setOpen(true);
    } catch {
      setError(t('searchFailed'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [BASE, lang]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    searchTimerRef.current = setTimeout(() => doSearch(val), 500);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    doSearch(query);
  };

  const handleSelect = async (item: YTResult) => {
    setOpen(false);
    setQuery('');
    setResults([]);
    await onAdd(item.url, item.title);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    await onAdd(url, url);
    setUrlInput('');
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setOpen(false);
    setQuery('');
    setUrlInput('');
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Mode toggle */}
      <div className="flex gap-1 mb-1">
        <button
          type="button"
          onClick={() => switchMode('search')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 h-6 rounded-lg text-[11px] font-medium transition-colors',
            mode === 'search'
              ? 'bg-red-600/80 text-white'
              : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10',
          )}
        >
          <Youtube className="w-3.5 h-3.5" />
          {t('ytSearch')}
        </button>
        <button
          type="button"
          onClick={() => switchMode('url')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 h-6 rounded-lg text-[11px] font-medium transition-colors',
            mode === 'url'
              ? 'bg-primary/80 text-white'
              : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10',
          )}
        >
          <LinkIcon className="w-3.5 h-3.5" />
          {t('directUrl')}
        </button>
        {isDj && (
          <button
            type="button"
            onClick={() => switchMode('sniff')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-6 rounded-lg text-[11px] font-medium transition-colors',
              mode === 'sniff'
                ? 'bg-purple-600/80 text-white'
                : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10',
            )}
          >
            <Scan className="w-3.5 h-3.5" />
            المتصفح الذكي
          </button>
        )}
      </div>

      {/* Search mode */}
      {mode === 'search' && (
        <form onSubmit={handleSearchSubmit} className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={handleQueryChange}
              placeholder={t('searchPlaceholder')}
              className="w-full h-8 ps-8 pe-7 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/30 outline-none focus:border-red-500/60 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </form>
      )}

      {/* URL mode */}
      {mode === 'url' && (
        <form onSubmit={handleUrlSubmit} className="flex gap-2 items-center">
          <div className="relative flex-1">
            <LinkIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            <input
              ref={inputRef}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder={t('videoUrl')}
              className="w-full h-8 ps-8 pe-3 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/30 outline-none focus:border-primary transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!urlInput.trim() || isAdding}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-primary hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </form>
      )}

      {/* Sniff mode */}
      {mode === 'sniff' && (
        <Suspense fallback={<div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>}>
          <LinkSniffer onSelectVideo={onSniffAdd || onAdd} roomSlug={roomSlug || ''} />
        </Suspense>
      )}

      {/* Error (search mode) */}
      {error && mode === 'search' && (
        <p className="text-xs text-red-400 mt-1 px-1">{error}</p>
      )}

      {/* Search results dropdown */}
      {open && results.length > 0 && mode === 'search' && (
        <div className="absolute top-full start-0 end-0 mt-1 z-50 bg-zinc-900/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto">
          {results.map((item) => (
            <button
              key={item.videoId}
              type="button"
              onClick={() => handleSelect(item)}
              disabled={isAdding}
              className="w-full flex items-center gap-2.5 p-2 hover:bg-white/10 transition-colors text-start disabled:opacity-60"
            >
              <img
                src={item.thumbnail}
                alt=""
                className="w-16 h-10 object-cover rounded-md shrink-0 bg-zinc-800"
                loading="lazy"
              />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium leading-snug line-clamp-2">
                  {item.title}
                </p>
                <p className="text-white/40 text-[10px] mt-0.5 truncate">{item.channel}</p>
              </div>
              <Plus className="w-4 h-4 text-white/30 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
