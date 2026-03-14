import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { useLocation, useSearch } from 'wouter';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const OAUTH_ERROR_MSGS: Record<string, string> = {
  google_cancelled: 'تم إلغاء تسجيل الدخول',
  google_failed: 'فشل تسجيل الدخول بـ Google، حاول مجدداً',
};

export default function AuthPage() {
  const { user, loading, setUser } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialMode = params.get('mode') === 'register' ? 'register' : 'login';
  const oauthError = params.get('error');

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(oauthError ? (OAUTH_ERROR_MSGS[oauthError] || 'خطأ في تسجيل الدخول') : '');

  useEffect(() => {
    if (!loading && user) setLocation('/home');
  }, [user, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body: Record<string, string> = { email, password };
      if (mode === 'register') body.username = username;

      const res = await fetch(`${BASE}/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ');
      } else {
        setUser(data);
        setLocation('/home');
      }
    } catch {
      setError('تعذّر الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full opacity-10 blur-3xl" style={{ backgroundColor: '#06B6D4' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-xs flex flex-col items-center gap-6"
      >
        <div className="text-center">
          <h1 className="text-white text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}
          </h1>
          <p className="text-white/40 text-sm mt-1">LrmTV</p>
        </div>

        <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>

          {/* Mode tabs */}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-primary text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              دخول
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-primary text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              حساب جديد
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <AnimatePresence mode="wait">
              {mode === 'register' && (
                <motion.div
                  key="username"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <input
                    type="text"
                    placeholder="اسم المستخدم"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    minLength={2}
                    maxLength={32}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <input
              type="email"
              placeholder="البريد الإلكتروني"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
            />

            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                placeholder="كلمة المرور"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-400 text-xs text-center"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
            </button>
          </form>
        </div>

        <button
          onClick={() => setLocation('/')}
          className="text-white/20 text-xs hover:text-white/50 transition"
        >
          ← العودة
        </button>
      </motion.div>
    </div>
  );
}
