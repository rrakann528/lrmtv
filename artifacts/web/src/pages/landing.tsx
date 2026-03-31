import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { UserCircle, LogIn, UserPlus, Tv2, MessageCircle, Music2, Globe, Lock, Zap } from 'lucide-react';
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
  const { user } = useAuth();

  useEffect(() => {
    if (user) setLocation('/home');
  }, [user]);

  if (user) return null;

  return (
    <div className="min-h-screen flex flex-col items-center bg-background relative overflow-x-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-violet-500/15 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm mx-auto px-6 flex flex-col items-center">
        {/* ── Hero ── */}
        <div className="flex flex-col items-center text-center pt-16 pb-8">
          <img src="/icon-512.png" alt="LrmTV" className="w-20 h-20 rounded-2xl mb-5 shadow-lg shadow-primary/20" />
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-1">LrmTV</h1>
          <p className="text-muted-foreground text-sm">شاهد مع أصدقائك في وقت واحد</p>
        </div>

        {/* ── Auth Buttons ── */}
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

        {/* ── About LrmTV (inline, always visible) ── */}
        <div className="w-full mt-10 border-t border-white/8 pt-8" dir="rtl">
          <h2 className="text-center text-white/70 text-sm font-bold mb-1">ما هو LrmTV؟</h2>
          <p className="text-center text-white/45 text-xs leading-relaxed mb-6">
            منصة مشاهدة جماعية مجانية تتيح لك ولأصدقائك مشاهدة الفيديوهات والبث المباشر معاً
            في نفس الوقت — مع دردشة فورية وتزامن تلقائي مثالي، من أي مكان في العالم.
          </p>

          {/* Features grid */}
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex flex-col gap-1.5 bg-white/[0.04] rounded-2xl p-3.5 border border-white/8">
                <div className="flex items-center gap-2 mb-0.5">
                  <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-white/85 text-xs font-bold">{title}</span>
                </div>
                <p className="text-white/45 text-[11px] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="mt-6 bg-white/[0.03] rounded-2xl p-4 border border-white/8">
            <h3 className="text-white/70 text-xs font-bold mb-3">كيف يعمل؟</h3>
            <ol className="space-y-1.5 text-white/45 text-xs">
              <li className="flex gap-2"><span className="text-primary font-bold">١</span> أنشئ حساباً أو ادخل كزائر</li>
              <li className="flex gap-2"><span className="text-primary font-bold">٢</span> أنشئ غرفة مشاهدة أو انضم لغرفة موجودة</li>
              <li className="flex gap-2"><span className="text-primary font-bold">٣</span> أضف رابط الفيديو (YouTube أو بث مباشر)</li>
              <li className="flex gap-2"><span className="text-primary font-bold">٤</span> شارك الرابط واستمتع بالمشاهدة الجماعية</li>
            </ol>
          </div>
        </div>

        {/* ── Footer links ── */}
        <div className="mt-8 pb-12 flex flex-col items-center gap-2">
          <div className="flex items-center flex-wrap justify-center gap-3 text-xs text-muted-foreground/50">
            <button onClick={() => setLocation('/about')} className="hover:text-muted-foreground transition-colors">
              عن الموقع
            </button>
            <span>·</span>
            <button onClick={() => setLocation('/faq')} className="hover:text-muted-foreground transition-colors">
              أسئلة شائعة
            </button>
            <span>·</span>
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

const FEATURES = [
  {
    icon: Tv2,
    title: 'مشاهدة جماعية',
    desc: 'شاهد YouTube وبث HLS مع أصدقائك بتزامن تلقائي لحظي.',
  },
  {
    icon: MessageCircle,
    title: 'دردشة فورية',
    desc: 'تحدث مع أصدقائك أثناء المشاهدة عبر الدردشة داخل الغرفة.',
  },
  {
    icon: Music2,
    title: 'قائمة تشغيل',
    desc: 'أضف مقاطع متعددة وأدر قائمة التشغيل بسهولة.',
  },
  {
    icon: Lock,
    title: 'غرف خاصة',
    desc: 'أنشئ غرفاً خاصة بدعوات حصرية لأصدقائك فقط.',
  },
  {
    icon: Globe,
    title: '6 لغات',
    desc: 'واجهة كاملة بالعربية والإنجليزية والفرنسية والتركية والإسبانية والإندونيسية.',
  },
  {
    icon: Zap,
    title: 'سريع وموثوق',
    desc: 'اتصال فوري بدون تأخير مع دعم الاتصال الصوتي بين المستخدمين.',
  },
];
