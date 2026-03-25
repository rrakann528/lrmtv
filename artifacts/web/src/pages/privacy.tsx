import { useLocation } from 'wouter';
import { ArrowRight, Lock } from 'lucide-react';

const LAST_UPDATED = '٢٥ مارس ٢٠٢٦';
const APP_NAME = 'LrmTV';
const CONTACT_EMAIL = 'support@lrmtv.sbs';

export default function PrivacyPage() {
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
            <Lock className="w-4 h-4 text-violet-400" />
            <span className="font-semibold text-sm">سياسة الخصوصية</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24">
        {/* Title */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">سياسة الخصوصية</h1>
          <p className="text-white/40 text-sm">آخر تحديث: {LAST_UPDATED}</p>
        </div>

        <div className="space-y-8 text-white/75 leading-relaxed text-sm" dir="rtl">

          <Section title="١. مقدمة">
            <p>
              تُوضّح هذه السياسة كيفية جمع {APP_NAME} للمعلومات واستخدامها وحمايتها. خصوصيتك مهمة لنا ونلتزم بحمايتها.
            </p>
          </Section>

          <Section title="٢. المعلومات التي نجمعها">
            <p className="mb-3">نجمع المعلومات التالية عند تسجيلك أو استخدامك للمنصة:</p>

            <div className="space-y-3">
              <InfoCard title="معلومات الحساب" color="cyan">
                اسم المستخدم، الاسم المعروض، البريد الإلكتروني (اختياري)، وكلمة المرور (مشفرة ولا يمكن الاطلاع عليها).
              </InfoCard>
              <InfoCard title="بيانات الاستخدام" color="violet">
                الغرف التي تنضم إليها، الرسائل في الدردشة، وسجل الأنشطة داخل المنصة.
              </InfoCard>
              <InfoCard title="البيانات التقنية" color="blue">
                عنوان IP، نوع المتصفح والجهاز، ونظام التشغيل — لأغراض الأمان وتحسين الخدمة.
              </InfoCard>
              <InfoCard title="المايكروفون" color="yellow">
                يُستخدم فقط داخل غرف المشاهدة عند موافقتك الصريحة للمحادثات الصوتية. لا يُسجَّل أو يُخزَّن أي بث صوتي على خوادمنا.
              </InfoCard>
            </div>
          </Section>

          <Section title="٣. كيف نستخدم معلوماتك">
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>تشغيل المنصة وتقديم الخدمات الأساسية.</li>
              <li>التحقق من هوية المستخدمين وحماية الحسابات.</li>
              <li>تحسين أداء المنصة ومعالجة المشكلات التقنية.</li>
              <li>الاستجابة لطلبات الدعم الفني والبلاغات.</li>
              <li><strong className="text-white">لا نبيع بياناتك لأي طرف ثالث، ولا نستخدمها للإعلانات المستهدفة.</strong></li>
            </ul>
          </Section>

          <Section title="٤. مشاركة البيانات مع أطراف ثالثة">
            <p className="mb-3">لا نشارك بياناتك الشخصية إلا في الحالات التالية:</p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li><strong className="text-white">الالتزام القانوني:</strong> إذا طلبت جهة قانونية ذلك وفق أحكام القانون المعمول به.</li>
              <li><strong className="text-white">الأمن والحماية:</strong> لمنع الاحتيال أو التهديدات الأمنية الخطيرة.</li>
              <li><strong className="text-white">موفرو الخدمات:</strong> أطراف تقنية تساعدنا في تشغيل المنصة (مثل استضافة الخوادم) وهم ملتزمون بالسرية.</li>
            </ul>
          </Section>

          <Section title="٥. الاحتفاظ بالبيانات وحذفها">
            <p>
              نحتفظ ببياناتك طالما حسابك نشط. يمكنك في أي وقت طلب حذف حسابك وجميع بياناتك المرتبطة به بشكل كامل ونهائي عبر التواصل معنا على بريدنا الإلكتروني. سيتم تنفيذ الطلب خلال <strong className="text-white">١٤ يوم عمل</strong>.
            </p>
          </Section>

          <Section title="٦. الكوكيز (Cookies)">
            <p>
              نستخدم كوكي واحدة آمنة (<code className="text-primary text-xs bg-white/5 px-1 py-0.5 rounded">token</code>) لحفظ جلسة تسجيل الدخول. لا نستخدم كوكيز التتبع أو الإعلانات.
            </p>
          </Section>

          <Section title="٧. أمان البيانات">
            <p>
              نتخذ إجراءات أمنية معقولة لحماية بياناتك، تشمل: تشفير كلمات المرور (bcrypt)، واتصالات HTTPS المشفرة. مع ذلك، لا يوجد نظام آمن بشكل مطلق وننصحك باستخدام كلمة مرور قوية وعدم مشاركتها.
            </p>
          </Section>

          <Section title="٨. خصوصية القاصرين">
            <p>
              {APP_NAME} موجّه للمستخدمين الذين يبلغون ١٣ عاماً فأكثر. إذا علمنا أن قاصراً دون ١٣ عاماً قد سجّل حساباً، سنحذف الحساب فوراً.
            </p>
          </Section>

          <Section title="٩. حقوقك">
            <p className="mb-2">لديك الحق في:</p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>الاطلاع على البيانات التي نحتفظ بها عنك.</li>
              <li>تصحيح أي معلومات غير دقيقة.</li>
              <li>طلب حذف بياناتك بالكامل.</li>
              <li>الاعتراض على معالجة بياناتك.</li>
            </ul>
            <p className="mt-3">لممارسة أي من هذه الحقوق، تواصل معنا على: <span className="font-mono text-primary text-xs">{CONTACT_EMAIL}</span></p>
          </Section>

          <Section title="١٠. تغييرات على هذه السياسة">
            <p>
              قد نُحدّث هذه السياسة من وقت لآخر. سنُعلمك بأي تغييرات جوهرية عبر إشعار داخل التطبيق أو البريد الإلكتروني المسجّل (إن وُجد). استمرارك في استخدام المنصة يعني قبولك للسياسة المحدّثة.
            </p>
          </Section>

          <Section title="١١. التواصل معنا">
            <p>لأي استفسار يخص خصوصيتك:</p>
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

function InfoCard({ title, color, children }: { title: string; color: 'cyan' | 'violet' | 'blue' | 'yellow'; children: React.ReactNode }) {
  const colors = {
    cyan:   'border-cyan-500/20 bg-cyan-500/5 text-cyan-300',
    violet: 'border-violet-500/20 bg-violet-500/5 text-violet-300',
    blue:   'border-blue-500/20 bg-blue-500/5 text-blue-300',
    yellow: 'border-yellow-500/20 bg-yellow-500/5 text-yellow-300',
  };
  return (
    <div className={`rounded-xl border p-3 ${colors[color]}`}>
      <p className="font-semibold text-xs mb-1">{title}</p>
      <p className="text-white/60 text-xs">{children}</p>
    </div>
  );
}
