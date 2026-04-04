import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, Film, Play, AlertCircle, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/hooks/use-auth';
import { useI18n } from '@/lib/i18n';

interface SniffedUrl {
  url: string;
  type: 'm3u8' | 'mp4' | 'mpd' | 'other';
  quality?: string;
  score: number;
}

interface LinkSnifferProps {
  onSelectVideo: (url: string, title: string) => void;
  roomSlug: string;
}

export default function LinkSniffer({ onSelectVideo, roomSlug }: LinkSnifferProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SniffedUrl[]>([]);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const { lang } = useI18n();

  const handleSniff = useCallback(async () => {
    const url = inputUrl.trim();
    if (!url) return;

    setLoading(true);
    setError('');
    setResults([]);
    setDuration(null);

    try {
      const res = await apiFetch('/link-sniff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, roomSlug }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'فشل الاستخراج');
        if (data.hint) setError((prev) => `${prev}\n${data.hint}`);
        return;
      }

      if (data.success && data.urls?.length > 0) {
        setResults(data.urls);
        setDuration(data.duration);
        const best = data.urls[0];
        const label = best.quality ? `${best.type.toUpperCase()} ${best.quality}` : best.type.toUpperCase();
        onSelectVideo(best.url, label);
      } else {
        setError(data.error || 'لم يتم العثور على روابط فيديو في هذه الصفحة');
      }
    } catch {
      setError('خطأ في الاتصال — تأكد من اتصالك بالإنترنت');
    } finally {
      setLoading(false);
    }
  }, [inputUrl]);

  const handleSelect = useCallback(
    (item: SniffedUrl) => {
      const label = item.quality ? `${item.type.toUpperCase()} ${item.quality}` : item.type.toUpperCase();
      onSelectVideo(item.url, label);
    },
    [onSelectVideo],
  );

  const typeColor: Record<string, string> = {
    m3u8: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    mp4: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    mpd: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    other: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex gap-2">
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleSniff()}
          placeholder="الصق رابط الصفحة هنا..."
          className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 text-sm outline-none focus:border-cyan-400 transition"
          dir="ltr"
          disabled={loading}
        />
        <button
          onClick={handleSniff}
          disabled={loading || !inputUrl.trim()}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0 transition-all hover:brightness-110"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري البحث...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              <span>استخراج</span>
            </>
          )}
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
            <Film className="w-5 h-5 text-cyan-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="text-white/60 text-sm text-center">
            جاري تحليل الصفحة واستخراج روابط الفيديو...
            <br />
            <span className="text-white/40 text-xs">قد يستغرق الأمر حتى 45 ثانية</span>
          </p>
        </div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm whitespace-pre-line">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {results.length > 0 && (
        <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[300px] scrollbar-thin">
          {duration !== null && (
            <p className="text-white/40 text-xs px-1">
              تم العثور على {results.length} رابط في {(duration / 1000).toFixed(1)} ثانية
            </p>
          )}
          {results.map((item, i) => (
            <motion.button
              key={item.url}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => handleSelect(item)}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cyan-500/30 transition-all text-left group"
              dir="ltr"
            >
              <div className="shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                <Play className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${typeColor[item.type] || typeColor.other}`}
                  >
                    {item.type.toUpperCase()}
                  </span>
                  {item.quality && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                      {item.quality}
                    </span>
                  )}
                </div>
                <p className="text-white/60 text-xs truncate font-mono">{item.url}</p>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-white/30 group-hover:text-cyan-400 shrink-0 transition-colors" />
            </motion.button>
          ))}
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
          <Film className="w-8 h-8 text-white/20" />
          <p className="text-white/40 text-sm">
            الصق رابط صفحة من موقع بث
            <br />
            <span className="text-white/30 text-xs">
              مدعوم: EgyBest, Shahid4u, FaselHD, MyCima, Akwam وغيرها
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
