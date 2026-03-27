import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, apiFetch, writeToken } from '@/hooks/use-auth';
import { useLocation, useSearch } from 'wouter';
import { Eye, EyeOff, Loader2, Mail, CheckCircle2, Globe, KeyRound } from 'lucide-react';
import { useI18n, LANGUAGES } from '@/lib/i18n';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

type Step = 'form' | 'otp' | 'forgot-email' | 'forgot-otp' | 'forgot-newpass';

export default function AuthPage() {
  const { user, loading, setUser } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialMode = params.get('mode') === 'register' ? 'register' : 'login';
  const oauthError = params.get('error');

  const OAUTH_ERROR_KEYS: Record<string, string> = {
    google_cancelled: 'authGoogleCancelled',
    google_failed: 'authGoogleFailed',
  };

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [step, setStep] = useState<Step>('form');
  const [loginField, setLoginField] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState(oauthError ? (OAUTH_ERROR_KEYS[oauthError] || 'authOauthError') : '');
  const [errorRaw, setErrorRaw] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);

  const displayError = errorKey ? t(errorKey as any) : errorRaw;

  // Email OTP (registration)
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Forgot password flow
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState(['', '', '', '', '', '']);
  const [forgotOtpError, setForgotOtpError] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotResendCooldown, setForgotResendCooldown] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const forgotOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!loading && user && step !== 'otp') {
      if (!user.email || user.emailVerified !== false) {
        setLocation('/');
      } else {
        setPendingUser(user);
        setStep('otp');
        apiFetch('/auth/send-otp', { method: 'POST' }).catch(() => {});
      }
    }
  }, [user, loading]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(v => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (forgotResendCooldown <= 0) return;
    const timer = setTimeout(() => setForgotResendCooldown(v => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [forgotResendCooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(''); setErrorRaw('');
    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      let body: Record<string, string>;
      if (mode === 'login') {
        const isEmail = loginField.includes('@');
        body = { [isEmail ? 'email' : 'username']: loginField.trim(), password };
      } else {
        body = { email, username, password, displayName: displayName.trim() || username };
      }

      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        if (data.error) setErrorRaw(data.error); else setErrorKey('authGenericError');
        return;
      }

      if (data.token) writeToken(data.token);
      const { token: _t, ...userData } = data;

      if (mode === 'register' && !userData.emailVerified) {
        setPendingUser(userData);
        setStep('otp');
        setResendCooldown(60);
        apiFetch('/auth/send-otp', { method: 'POST' }).catch(() => {});
      } else {
        setUser(userData);
        setLocation('/');
      }
    } catch {
      setErrorKey('authConnectionError');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOtpInput(idx: number, val: string, otpArr: string[], setOtpArr: (v: string[]) => void, refs: React.MutableRefObject<(HTMLInputElement | null)[]>, setErr: (v: string) => void) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otpArr];
    next[idx] = digit;
    setOtpArr(next);
    setErr('');
    if (digit && idx < 5) refs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent, otpArr: string[], refs: React.MutableRefObject<(HTMLInputElement | null)[]>) {
    if (e.key === 'Backspace' && !otpArr[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent, setOtpArr: (v: string[]) => void, refs: React.MutableRefObject<(HTMLInputElement | null)[]>) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) {
      setOtpArr(digits.split(''));
      refs.current[5]?.focus();
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setOtpError(t('authEnterFullCode')); return; }
    setOtpSubmitting(true);
    setOtpError('');
    try {
      const res = await apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) { setOtpError(data.error || t('authInvalidCode')); return; }
      setUser({ ...pendingUser, emailVerified: true });
      setLocation('/');
    } catch {
      setOtpError(t('authConnectionError'));
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
    } catch { setOtpError(t('authResendFailed')); }
  }

  // ── Forgot password handlers ────────────────────────────────────────────────
  async function handleForgotSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotSubmitting(true);
    setForgotOtpError('');
    try {
      const res = await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail.trim() }) });
      if (!res.ok) {
        const data = await res.json();
        setForgotOtpError(data.error || t('authGenericError'));
        return;
      }
      setForgotResendCooldown(60);
      setStep('forgot-otp');
      setTimeout(() => forgotOtpRefs.current[0]?.focus(), 100);
    } catch {
      setForgotOtpError(t('authConnectionError'));
    } finally {
      setForgotSubmitting(false);
    }
  }

  async function handleForgotVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = forgotOtp.join('');
    if (code.length < 6) { setForgotOtpError(t('authEnterFullCode')); return; }
    setForgotSubmitting(true);
    setForgotOtpError('');
    // Just move to new password step — we'll verify code together with new password
    setForgotSubmitting(false);
    setStep('forgot-newpass');
  }

  async function handleForgotResend() {
    if (forgotResendCooldown > 0) return;
    try {
      const res = await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail.trim() }) });
      if (!res.ok) return;
      setForgotResendCooldown(60);
      setForgotOtp(['', '', '', '', '', '']);
      setForgotOtpError('');
      forgotOtpRefs.current[0]?.focus();
    } catch {}
  }

  async function handleForgotReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setForgotOtpError(t('forgotPasswordMismatch')); return; }
    if (newPassword.length < 6) { setForgotOtpError('كلمة المرور 6 أحرف على الأقل'); return; }
    setForgotSubmitting(true);
    setForgotOtpError('');
    try {
      const res = await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim(), code: forgotOtp.join(''), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setForgotOtpError(data.error || t('authGenericError')); return; }
      setResetSuccess(true);
      setTimeout(() => {
        setStep('form');
        setResetSuccess(false);
        setForgotEmail('');
        setForgotOtp(['', '', '', '', '', '']);
        setNewPassword('');
        setConfirmPassword('');
      }, 2000);
    } catch {
      setForgotOtpError(t('authConnectionError'));
    } finally {
      setForgotSubmitting(false);
    }
  }

  const currentLang = LANGUAGES.find(l => l.code === lang);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background" dir={dir}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full opacity-10 blur-3xl" style={{ backgroundColor: '#06B6D4' }} />
      </div>

      <div className="absolute top-4 z-20" style={{ insetInlineEnd: '1rem' }}>
        <button
          onClick={() => setShowLangPicker(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition text-sm"
        >
          <Globe size={16} />
          <span>{currentLang?.flag} {currentLang?.label}</span>
        </button>

        <AnimatePresence>
          {showLangPicker && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full mt-2 w-48 rounded-xl border border-white/10 overflow-hidden"
              style={{ backgroundColor: 'rgba(20,20,30,0.95)', backdropFilter: 'blur(12px)', insetInlineEnd: 0 }}
            >
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setShowLangPicker(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-white/10 ${lang === l.code ? 'text-cyan-400 bg-white/5' : 'text-white/70'}`}
                >
                  <span className="text-lg">{l.flag}</span>
                  <span>{l.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-xs flex flex-col items-center gap-6"
      >
        <AnimatePresence mode="wait">

          {/* ── Email verification OTP (after registration) ── */}
          {step === 'otp' && (
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
                <h1 className="text-white text-xl font-bold">{t('authVerifyEmail')}</h1>
                <p className="text-white/40 text-sm mt-1">
                  {t('authSentCodeTo')}<br />
                  <span className="text-cyan-400 font-mono">{email}</span>
                </p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                  <div className="flex gap-2 justify-center" dir="ltr" onPaste={e => handleOtpPaste(e, setOtp, otpRefs)}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => { otpRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpInput(i, e.target.value, otp, setOtp, otpRefs, setOtpError)}
                        onKeyDown={e => handleOtpKeyDown(i, e, otp, otpRefs)}
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
                    {t('authConfirmCode')}
                  </button>
                </form>

                <div className="text-center">
                  <button
                    onClick={resendOtp}
                    disabled={resendCooldown > 0}
                    className="text-sm text-cyan-400 hover:text-cyan-300 disabled:text-white/30 transition"
                  >
                    {resendCooldown > 0 ? `${t('authResendIn')} ${resendCooldown}${t('authSecondsSuffix')}` : t('authResendCode')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Forgot: enter email ── */}
          {step === 'forgot-email' && (
            <motion.div
              key="forgot-email"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center mx-auto mb-3">
                  <KeyRound className="w-7 h-7 text-violet-400" />
                </div>
                <h1 className="text-white text-xl font-bold">{t('forgotPasswordOtpTitle')}</h1>
                <p className="text-white/40 text-sm mt-1">{t('forgotPasswordDesc')}</p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <form onSubmit={handleForgotSendOtp} className="flex flex-col gap-3">
                  <input
                    type="email"
                    placeholder={t('authEmail')}
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                    dir="ltr"
                  />

                  {forgotOtpError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
                      {forgotOtpError}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotSubmitting || !forgotEmail.trim()}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    {forgotSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                    {t('forgotPasswordSend')}
                  </button>
                </form>

                <button
                  onClick={() => { setStep('form'); setForgotOtpError(''); }}
                  className="text-sm text-white/30 hover:text-white/60 transition text-center"
                >
                  {dir === 'rtl' ? '→' : '←'} {t('authBack')}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Forgot: enter OTP ── */}
          {step === 'forgot-otp' && (
            <motion.div
              key="forgot-otp"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center mx-auto mb-3">
                  <Mail className="w-7 h-7 text-violet-400" />
                </div>
                <h1 className="text-white text-xl font-bold">{t('forgotPasswordOtpTitle')}</h1>
                <p className="text-white/40 text-sm mt-1">
                  {t('forgotPasswordOtpDesc')}<br />
                  <span className="text-violet-400 font-mono">{forgotEmail}</span>
                </p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <form onSubmit={handleForgotVerifyOtp} className="flex flex-col gap-4">
                  <div className="flex gap-2 justify-center" dir="ltr" onPaste={e => handleOtpPaste(e, setForgotOtp, forgotOtpRefs)}>
                    {forgotOtp.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => { forgotOtpRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpInput(i, e.target.value, forgotOtp, setForgotOtp, forgotOtpRefs, setForgotOtpError)}
                        onKeyDown={e => handleOtpKeyDown(i, e, forgotOtp, forgotOtpRefs)}
                        className="w-11 text-center text-xl font-bold text-white bg-white/5 border border-white/15 rounded-xl focus:border-violet-400 focus:outline-none transition"
                        style={{ height: '52px' }}
                      />
                    ))}
                  </div>

                  {forgotOtpError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
                      {forgotOtpError}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotOtp.join('').length < 6}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-violet-600 text-white font-semibold text-sm hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-60"
                  >
                    <CheckCircle2 size={16} />
                    {t('authConfirmCode')}
                  </button>
                </form>

                <div className="text-center">
                  <button
                    onClick={handleForgotResend}
                    disabled={forgotResendCooldown > 0}
                    className="text-sm text-violet-400 hover:text-violet-300 disabled:text-white/30 transition"
                  >
                    {forgotResendCooldown > 0 ? `${t('authResendIn')} ${forgotResendCooldown}${t('authSecondsSuffix')}` : t('authResendCode')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Forgot: new password ── */}
          {step === 'forgot-newpass' && (
            <motion.div
              key="forgot-newpass"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-3">
                  {resetSuccess
                    ? <CheckCircle2 className="w-7 h-7 text-green-400" />
                    : <KeyRound className="w-7 h-7 text-green-400" />
                  }
                </div>
                <h1 className="text-white text-xl font-bold">{t('forgotPasswordNewPassTitle')}</h1>
                {resetSuccess && (
                  <p className="text-green-400 text-sm mt-1">{t('forgotPasswordSuccess')}</p>
                )}
              </div>

              {!resetSuccess && (
                <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <form onSubmit={handleForgotReset} className="flex flex-col gap-3">
                    <div className="relative">
                      <input
                        type={showNewPass ? 'text' : 'password'}
                        placeholder={t('forgotPasswordNewPass')}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-green-500/50 transition"
                      />
                      <button type="button" onClick={() => setShowNewPass(v => !v)}
                        className="absolute top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                        style={{ insetInlineStart: '0.75rem' }}>
                        {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showConfirmPass ? 'text' : 'password'}
                        placeholder={t('forgotPasswordConfirmPass')}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-green-500/50 transition"
                      />
                      <button type="button" onClick={() => setShowConfirmPass(v => !v)}
                        className="absolute top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                        style={{ insetInlineStart: '0.75rem' }}>
                        {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    {forgotOtpError && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
                        {forgotOtpError}
                      </motion.p>
                    )}

                    <button
                      type="submit"
                      disabled={forgotSubmitting || !newPassword || !confirmPassword}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-500 active:scale-95 transition-all disabled:opacity-60"
                    >
                      {forgotSubmitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                      {t('forgotPasswordReset')}
                    </button>
                  </form>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Login / Register form ── */}
          {step === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="text-center">
                <h1 className="text-white text-2xl font-bold tracking-tight">
                  {mode === 'login' ? t('authLogin') : t('authRegister')}
                </h1>
                <p className="text-white/40 text-sm mt-1">LrmTV</p>
              </div>

              <div className="w-full rounded-2xl border border-white/10 p-6 flex flex-col gap-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  <button
                    onClick={() => { setMode('login'); setErrorKey(''); setErrorRaw(''); }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-primary text-white' : 'text-white/40 hover:text-white/70'}`}
                  >
                    {t('authLoginTab')}
                  </button>
                  <button
                    onClick={() => { setMode('register'); setErrorKey(''); setErrorRaw(''); }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-primary text-white' : 'text-white/40 hover:text-white/70'}`}
                  >
                    {t('authRegisterTab')}
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <AnimatePresence mode="wait">
                    {mode === 'register' && (
                      <motion.div
                        key="register-fields"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex flex-col gap-3"
                      >
                        <input
                          type="text"
                          placeholder={t('authDisplayName')}
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          maxLength={40}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                        />
                        <input
                          type="text"
                          placeholder={t('authUsername')}
                          value={username}
                          onChange={e => setUsername(e.target.value)}
                          required
                          minLength={2}
                          maxLength={32}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                          dir="ltr"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {mode === 'login' ? (
                    <input
                      type="text"
                      placeholder={t('authEmailOrUsername')}
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
                      placeholder={t('authEmail')}
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
                      placeholder={t('authPassword')}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-primary/50 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="absolute top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                      style={{ insetInlineStart: '0.75rem' }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {/* Forgot password link — login only */}
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => { setForgotEmail(loginField.includes('@') ? loginField : ''); setForgotOtpError(''); setStep('forgot-email'); }}
                      className="text-xs text-white/30 hover:text-primary transition text-start"
                    >
                      {t('forgotPassword')}
                    </button>
                  )}

                  {displayError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center">
                      {displayError}
                    </motion.p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {mode === 'login' ? t('authLoginSubmit') : t('authCreateAccount')}
                  </button>
                </form>

                <div className="relative flex items-center my-1">
                  <div className="flex-1 border-t border-white/10" />
                  <span className="mx-3 text-xs text-white/30">{t('authOr')}</span>
                  <div className="flex-1 border-t border-white/10" />
                </div>

                <a
                  href={`${BASE}/api/auth/google`}
                  className="flex items-center justify-center gap-3 w-full py-3 rounded-xl bg-white text-gray-800 font-semibold text-sm shadow hover:bg-gray-100 transition-colors active:scale-95"
                >
                  <GoogleIcon />
                  {t('authGoogleBtn')}
                </a>
              </div>

              <button
                onClick={() => setLocation('/')}
                className="text-white/20 text-xs hover:text-white/50 transition"
              >
                {dir === 'rtl' ? '→' : '←'} {t('authBack')}
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
