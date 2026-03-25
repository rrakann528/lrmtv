import { useLocation } from 'wouter';
import { ArrowRight, Shield } from 'lucide-react';

const LAST_UPDATED = '٢٥ مارس ٢٠٢٦';
const APP_NAME = 'LrmTV';
const CONTACT_EMAIL = 'support@lrmtv.sbs';

export default function TermsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">شروط الاستخدام</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24">
        {/* Title */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">شروط الاستخدام</h1>
          <p className="text-white/40 text-sm">آخر تحديث: {LAST_UPDATED}</p>
        </div>

        <div className="space-y-8 text-white/75 leading-relaxed text-sm" dir="rtl">

          <Section title="١. القبول والموافقة">
            <p>
              باستخدامك لمنصة {APP_NAME}، فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق على أي بند من هذه الشروط، يرجى التوقف عن استخدام المنصة فوراً.
            </p>
          </Section>

          <Section title="٢. وصف الخدمة">
            <p>
              {APP_NAME} منصة اجتماعية تتيح للمستخدمين مشاهدة المحتوى الإعلامي بشكل جماعي في الوقت الفعلي عبر غرف مشاهدة مشتركة مع إمكانية الدردشة والمحادثات الصوتية. المنصة لا تستضيف أي محتوى بذاتها، بل تُمكّن المستخدمين من مشاركة روابط خارجية.
            </p>
          </Section>

          <Section title="٣. حقوق الملكية الفكرية والمحتوى المحمي">
            <p className="mb-3">
              أنت المسؤول الوحيد والكامل عن أي محتوى تشاركه داخل المنصة. بقبولك لهذه الشروط، تُقرّ وتضمن أنك:
            </p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>لن تشارك أي محتوى تبثّه قنوات أو جهات مرخصة دون إذن صريح منها (مباريات، أفلام، مسلسلات، إلخ).</li>
              <li>لن تستخدم المنصة لانتهاك حقوق النشر أو حقوق البث الحصري.</li>
              <li>ستتحمل أنت وحدك أي تبعات قانونية أو مالية ناجمة عن انتهاك حقوق الملكية الفكرية.</li>
              <li>تُعفي {APP_NAME} وإدارتها من أي مسؤولية تجاه المحتوى الذي تنشره.</li>
            </ul>
            <p className="mt-3 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300/80 text-xs">
              تنبيه: بث المباريات الرياضية والأفلام والمسلسلات المرخصة دون إذن يُعدّ انتهاكاً صريحاً لحقوق الملكية الفكرية وقد يعرّضك للمساءلة القانونية في بلدك.
            </p>
          </Section>

          <Section title="٤. سياسة الإزالة (DMCA / Takedown)">
            <p>
              تحترم {APP_NAME} حقوق الملكية الفكرية وتستجيب لطلبات الإزالة القانونية. إذا كنت صاحب حق وتعتقد أن محتوى على المنصة ينتهك ملكيتك الفكرية، يُرجى التواصل معنا على:
            </p>
            <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
            <p className="mt-3">سنبادر إلى مراجعة البلاغ واتخاذ الإجراء المناسب خلال <strong className="text-white">٧٢ ساعة</strong>.</p>
          </Section>

          <Section title="٥. السلوك المقبول">
            <p className="mb-2">يُحظر على المستخدمين:</p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>نشر أي محتوى مسيء أو عنصري أو إباحي.</li>
              <li>التحرش بالمستخدمين الآخرين أو إساءة استخدام ميزات التواصل.</li>
              <li>استخدام المنصة لأغراض غير مشروعة.</li>
              <li>محاولة اختراق المنصة أو الإضرار بأمنها أو أمن مستخدميها.</li>
              <li>إنشاء حسابات متعددة بهدف التحايل على قرارات الحظر.</li>
            </ul>
          </Section>

          <Section title="٦. التعليق والإنهاء">
            <p>
              تحتفظ {APP_NAME} بالحق الكامل في تعليق أو إنهاء حساب أي مستخدم يخالف هذه الشروط، دون إشعار مسبق وبدون أي التزام بالتعويض.
            </p>
          </Section>

          <Section title="٧. إخلاء المسؤولية">
            <p>
              تُقدَّم خدمة {APP_NAME} "كما هي" دون أي ضمانات صريحة أو ضمنية. لا تتحمل المنصة مسؤولية أي ضرر مباشر أو غير مباشر ناتج عن استخدامك للخدمة أو من المحتوى الذي يشاركه المستخدمون.
            </p>
          </Section>

          <Section title="٨. تعديل الشروط">
            <p>
              يحق لنا تعديل هذه الشروط في أي وقت. سيتم إشعارك بالتغييرات الجوهرية عبر إشعار داخل التطبيق. استمرارك في استخدام المنصة بعد التعديل يُعدّ قبولاً للشروط الجديدة.
            </p>
          </Section>

          <Section title="٩. التواصل معنا">
            <p>
              لأي استفسارات بخصوص هذه الشروط أو للإبلاغ عن مخالفة:
            </p>
            <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
          </Section>

        </div>

        <div className="mt-12 pt-6 border-t border-white/10 text-center text-white/20 text-xs">
          © 2026 {APP_NAME} · جميع الحقوق محفوظة
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-white font-bold text-base mb-3">{title}</h2>
      <div>{children}</div>
    </div>
  );
}
