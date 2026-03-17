import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, apiFetch, writeToken } from '@/hooks/use-auth';
import { useLocation, useSearch } from 'wouter';
import { Eye, EyeOff, Loader2, Mail, CheckCircle2 } from 'lucide-react';

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
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [loginField, setLoginField] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(oauthError ? (OAUTH_ERROR_MSGS[oauthError] || 'خطأ في تسجيل الدخول') : '');

  // OTP state
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!loading && user && step !== 'otp') setLocation('/home');
  }, [user, loading, step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      let body: Record<string, string>;
      if (mode === 'login') {
        const isEmail = loginField.includes('@');
        body = { [isEmail ? 'email' : 'username']: loginField.trim(), password };
      } else {
        body = { email, username, password };
      }

      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ');
        return;
      }

      if (data.token) writeToken(data.token);
      const { token: _t, ...userData } = data;

      if (mode === 'register' && !userData.emailVerified) {
        // Show OTP screen first — then send in background
        setPendingUser(userData);
        setStep('otp');
        setResendCooldown(60);
        apiFetch('/auth/send-otp', { method: 'POST' }).catch(() => {});
      } else {
        setUser(userData);
        setLocation('/home');
      }
    } catch {
      setError('تعذّر الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOtpInput(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    setOtpError('');
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(''));
      otpRefs.current[5]?.focus();
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setOtpError('أدخل الرمز كاملاً'); return; }
    setOtpSubmitting(true);
    setOtpError('');
    try {
      const res = await apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) { setOtpError(data.error || 'رمز غير صحيح'); return; }
      setUser({ ...pendingUser, emailVerified: true });
      setLocation('/home');
    } catch {
      setOtpError('تعذّر الاتصال بالخادم');
    } finally {
      setOtpSubmitting(false);
    }
  }

  async function resendOtp() {
    if (resendCooldown > 0) return;
    try {
      await apiFetch('/auth/send-otp', { method: 'POST' });
      setResendCooldown(60);
      setOtp(['', '', '', '', '', '']);
      setOtpError('');
      otpRefs.current[0]?.focus();
    } catch { setOtpError('فشل إعادة الإرسال'); }
  }

  async function skipVerification() {
    setUser({ ...pendingUser });
    setLocation('/home');
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
        {/* ── OTP Step ── */}
        <AnimatePresence mode="wait">
          {step === 'otp' ? (
            <motion.div
              key="otp"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-7 h-7 text-cyan-400" />
                </div>
                <h1 className="text-white text-xl font-bold">تحقق من بريدك</h1>
                <p className="text-white/40 text-sm mt-1">
                  أرسلنا رمزاً إلى<br />
                  <span className="text-cyan-400 font-mono">{email}</span>
                </p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                  {/* OTP boxes */}
                  <div className="flex gap-2 justify-center" dir="ltr" onPaste={handleOtpPaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => { otpRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpInput(i, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(i, e)}
                        className="w-11 h-13 text-center text-xl font-bold text-white bg-white/5 border border-white/15 rounded-xl focus:border-cyan-400 focus:outline-none transition"
                        style={{ height: '52px' }}
                      />
                    ))}
                  </div>

                  {otpError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
                      {otpError}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={otpSubmitting || otp.join('').length < 6}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    {otpSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    تأكيد الرمز
                  </button>
                </form>

                <div className="flex flex-col gap-2 text-center">
                  <button
                    onClick={resendOtp}
                    disabled={resendCooldown > 0}
                    className="text-sm text-cyan-400 hover:text-cyan-300 disabled:text-white/30 transition"
                  >
                    {resendCooldown > 0 ? `إعادة الإرسال خلال ${resendCooldown}ث` : 'إعادة إرسال الرمز'}
                  </button>
                  <button
                    onClick={skipVerification}
                    className="text-xs text-white/20 hover:text-white/40 transition"
                  >
                    تخطي الآن
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            /* ── Auth Form ── */
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <h1 className="text-white text-2xl font-bold tracking-tight">
                  {mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}
                </h1>
                <p className="text-white/40 text-sm mt-1">LrmTV</p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
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

                  {mode === 'login' ? (
                    <input
                      type="text"
                      placeholder="البريد الإلكتروني أو اسم المستخدم"
                      value={loginField}
                      onChange={e => setLoginField(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                      dir="ltr"
                    />
                  ) : (
                    <input
                      type="email"
                      placeholder="البريد الإلكتروني"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                    />
                  )}

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
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
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
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
