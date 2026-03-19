import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { UserCircle, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

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

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

  // If user is already known (from cache or API), redirect immediately
  if (user) {
    setLocation('/home');
    return null;
  }

  useEffect(() => {
    if (!loading && user) setLocation('/home');
  }, [user, loading]);

  // While checking auth (and no cached user), show a neutral splash
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <img src="/icon-512.png" alt="LrmTV" className="w-16 h-16 rounded-2xl shadow-lg shadow-primary/20" />
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-6">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-violet-500/15 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        <img src="/icon-512.png" alt="LrmTV" className="w-20 h-20 rounded-2xl mb-6 shadow-lg shadow-primary/20" />

        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-1">LrmTV</h1>
        <p className="text-muted-foreground text-sm mb-10">شاهد مع أصدقائك في وقت واحد</p>

        <div className="w-full flex flex-col gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/auth?mode=login')}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-base shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            تسجيل الدخول
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/auth?mode=register')}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl bg-card border border-border text-foreground font-semibold text-base hover:bg-muted/60 transition-colors"
          >
            <UserPlus className="w-5 h-5" />
            إنشاء حساب جديد
          </motion.button>

          <div className="relative flex items-center my-1">
            <div className="flex-1 border-t border-border" />
            <span className="mx-3 text-xs text-muted-foreground">أو</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <motion.a
            whileTap={{ scale: 0.97 }}
            href={`${BASE}/api/auth/google`}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl bg-white text-gray-800 font-semibold text-base shadow hover:bg-gray-100 transition-colors"
          >
            <GoogleIcon />
            المتابعة بحساب Google
          </motion.a>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation('/home?guest=1')}
            className="flex items-center justify-center gap-3 w-full py-3 rounded-2xl text-muted-foreground font-medium text-sm hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <UserCircle className="w-5 h-5" />
            الدخول كزائر
          </motion.button>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
            <button onClick={() => setLocation('/terms')} className="hover:text-muted-foreground transition-colors">
              شروط الاستخدام
            </button>
            <span>·</span>
            <button onClick={() => setLocation('/privacy')} className="hover:text-muted-foreground transition-colors">
              سياسة الخصوصية
            </button>
          </div>
          <p className="text-xs text-muted-foreground/30">© 2026 LrmTV · جميع الحقوق محفوظة</p>
        </div>
      </div>
    </div>
  );
}
