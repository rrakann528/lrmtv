import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, HelpCircle, ChevronDown } from 'lucide-react';

const APP = 'LrmTV';
const EMAIL = 'support@lrmtv.sbs';

const FAQS = [
  {
    q: 'ما هو LrmTV؟',
    a: `${APP} منصة مشاهدة جماعية مجانية تتيح لك مشاهدة الفيديوهات والبث المباشر مع أصدقائك في نفس الوقت عبر الإنترنت، مع دردشة فورية وتزامن تلقائي مثالي.`,
  },
  {
    q: 'هل LrmTV مجاني؟',
    a: `نعم، ${APP} مجاني بالكامل. لا يوجد اشتراك أو دفع مطلوب. يمكنك إنشاء غرف، دعوة أصدقاء، والدردشة معهم بدون أي تكلفة.`,
  },
  {
    q: 'هل أحتاج لتنزيل تطبيق؟',
    a: `لا، ${APP} يعمل مباشرة من متصفح الإنترنت على الجوال والكمبيوتر. لا تحتاج لتنزيل أي شيء.`,
  },
  {
    q: 'ما أنواع الفيديوهات التي يدعمها الموقع؟',
    a: `يدعم ${APP} روابط YouTube، وبث HLS المباشر (روابط .m3u8)، وأي رابط فيديو مباشر. المنصة لا تستضيف الفيديوهات بذاتها.`,
  },
  {
    q: 'كم عدد الأشخاص الذين يمكنهم الانضمام لغرفة واحدة؟',
    a: `تدعم الغرفة الواحدة حتى 100 مستخدم في نفس الوقت.`,
  },
  {
    q: 'هل يمكنني إنشاء غرفة خاصة؟',
    a: `نعم، يمكنك إنشاء غرف خاصة بدعوة حصرية أو تأمينها بكلمة مرور. الغرف الخاصة لا تظهر في قائمة الغرف العامة.`,
  },
  {
    q: 'هل يمكنني التحدث مع المشاركين في الغرفة؟',
    a: `نعم، يدعم ${APP} الدردشة النصية الفورية داخل الغرفة، بالإضافة إلى المكالمات الصوتية المباشرة بين المستخدمين.`,
  },
  {
    q: 'ما اللغات التي يدعمها الموقع؟',
    a: `يدعم ${APP} ست لغات: العربية، الإنجليزية، الفرنسية، التركية، الإسبانية، والإندونيسية.`,
  },
  {
    q: 'هل يمكنني إضافة عدة فيديوهات في نفس الغرفة؟',
    a: `نعم، يمكنك إنشاء قائمة تشغيل داخل الغرفة وإضافة فيديوهات متعددة تُشغَّل بالترتيب.`,
  },
  {
    q: 'هل الموقع آمن؟',
    a: `${APP} يستخدم HTTPS لتشفير الاتصالات. المضيف يتحكم بالكامل في الغرفة ويمكنه طرد أي مستخدم أو إيقاف صوته. لا يتم تخزين الفيديوهات على خوادمنا.`,
  },
  {
    q: 'ماذا أفعل إذا أراد أحدهم الإبلاغ عن محتوى مخالف؟',
    a: `يمكن الإبلاغ عن أي محتوى مخالف أو انتهاك لحقوق الملكية الفكرية عبر البريد الإلكتروني: ${EMAIL}. سنتخذ الإجراء المناسب خلال 72 ساعة.`,
  },
  {
    q: 'هل يمكنني استخدام الموقع بدون حساب؟',
    a: `نعم، يمكنك الدخول كزائر والانضمام لغرف مشاهدة مباشرة بدون إنشاء حساب. لكن إنشاء حساب يمنحك مزايا إضافية مثل قائمة الأصدقاء والرسائل الخاصة والمجموعات.`,
  },
  {
    q: 'كيف أتواصل مع فريق LrmTV؟',
    a: `يمكنك التواصل معنا على البريد الإلكتروني: ${EMAIL}`,
  },
];

export default function FAQPage() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">الأسئلة الشائعة</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24" dir="rtl">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">الأسئلة الشائعة</h1>
          <p className="text-white/40 text-sm">إجابات على أكثر الأسئلة شيوعاً حول {APP}</p>
        </div>

        <div className="space-y-2">
          {FAQS.map((item, i) => (
            <div key={i} className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-white/85 text-sm font-medium">{item.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-white/40 flex-shrink-0 transition-transform duration-200 ${open === i ? 'rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <div className="px-5 pb-4 text-white/55 text-sm leading-relaxed border-t border-white/5 pt-3">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 p-5 rounded-2xl bg-primary/5 border border-primary/15 text-center">
          <p className="text-white/60 text-sm mb-1">لم تجد إجابة لسؤالك؟</p>
          <p className="text-primary text-sm font-mono">{EMAIL}</p>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-center text-white/20 text-xs">
          © 2026 {APP} · جميع الحقوق محفوظة
        </div>
      </div>
    </div>
  );
}
