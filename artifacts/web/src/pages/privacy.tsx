import { useLocation } from 'wouter';
import { ArrowRight, Lock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const LAST_UPDATED_AR = '٢٥ مارس ٢٠٢٦';
const LAST_UPDATED_EN = 'March 25, 2026';
const APP_NAME = 'LrmTV';
const CONTACT_EMAIL = 'support@lrmtv.sbs';

export default function PrivacyPage() {
  const [, setLocation] = useLocation();
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
            <ArrowRight className="w-4 h-4" style={{ transform: isAr ? 'none' : 'rotate(180deg)' }} />
          </button>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-violet-400" />
            <span className="font-semibold text-sm">{isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24" dir={dir}>
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">{isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}</h1>
          <p className="text-white/40 text-sm">{isAr ? `آخر تحديث: ${LAST_UPDATED_AR}` : `Last updated: ${LAST_UPDATED_EN}`}</p>
        </div>

        <div className="space-y-8 text-white/75 leading-relaxed text-sm">
          {isAr ? (
            <>
              <Section title="١. مقدمة">
                <p>تُوضّح هذه السياسة كيفية جمع {APP_NAME} للمعلومات واستخدامها وحمايتها. خصوصيتك مهمة لنا ونلتزم بحمايتها.</p>
              </Section>
              <Section title="٢. المعلومات التي نجمعها">
                <p className="mb-3">نجمع المعلومات التالية عند تسجيلك أو استخدامك للمنصة:</p>
                <div className="space-y-3">
                  <InfoCard title="معلومات الحساب" color="cyan">اسم المستخدم، الاسم المعروض، البريد الإلكتروني (اختياري)، وكلمة المرور (مشفرة ولا يمكن الاطلاع عليها).</InfoCard>
                  <InfoCard title="بيانات الاستخدام" color="violet">الغرف التي تنضم إليها، الرسائل في الدردشة، وسجل الأنشطة داخل المنصة.</InfoCard>
                  <InfoCard title="البيانات التقنية" color="blue">عنوان IP، نوع المتصفح والجهاز، ونظام التشغيل — لأغراض الأمان وتحسين الخدمة.</InfoCard>
                  <InfoCard title="المايكروفون" color="yellow">يُستخدم فقط داخل غرف المشاهدة عند موافقتك الصريحة للمحادثات الصوتية. لا يُسجَّل أو يُخزَّن أي بث صوتي على خوادمنا.</InfoCard>
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
                <p>نحتفظ ببياناتك طالما حسابك نشط. يمكنك في أي وقت طلب حذف حسابك وجميع بياناتك المرتبطة به بشكل كامل ونهائي عبر التواصل معنا على بريدنا الإلكتروني. سيتم تنفيذ الطلب خلال <strong className="text-white">١٤ يوم عمل</strong>.</p>
              </Section>
              <Section title="٦. الكوكيز (Cookies)">
                <p>نستخدم كوكي واحدة آمنة (<code className="text-primary text-xs bg-white/5 px-1 py-0.5 rounded">token</code>) لحفظ جلسة تسجيل الدخول. لا نستخدم كوكيز التتبع أو الإعلانات.</p>
              </Section>
              <Section title="٧. أمان البيانات">
                <p>نتخذ إجراءات أمنية معقولة لحماية بياناتك، تشمل: تشفير كلمات المرور (bcrypt)، واتصالات HTTPS المشفرة. مع ذلك، لا يوجد نظام آمن بشكل مطلق وننصحك باستخدام كلمة مرور قوية وعدم مشاركتها.</p>
              </Section>
              <Section title="٨. خصوصية القاصرين">
                <p>{APP_NAME} موجّه للمستخدمين الذين يبلغون ١٣ عاماً فأكثر. إذا علمنا أن قاصراً دون ١٣ عاماً قد سجّل حساباً، سنحذف الحساب فوراً.</p>
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
                <p>قد نُحدّث هذه السياسة من وقت لآخر. سنُعلمك بأي تغييرات جوهرية عبر إشعار داخل التطبيق أو البريد الإلكتروني المسجّل (إن وُجد). استمرارك في استخدام المنصة يعني قبولك للسياسة المحدّثة.</p>
              </Section>
              <Section title="١١. التواصل معنا">
                <p>لأي استفسار يخص خصوصيتك:</p>
                <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
              </Section>
            </>
          ) : (
            <>
              <Section title="1. Introduction">
                <p>{APP_NAME} explains in this policy how we collect, use, and protect your information. Your privacy is important to us and we are committed to protecting it.</p>
              </Section>
              <Section title="2. Information We Collect">
                <p className="mb-3">We collect the following information when you register or use the platform:</p>
                <div className="space-y-3">
                  <InfoCard title="Account Information" color="cyan">Username, display name, email address (optional), and password (encrypted and not readable by us).</InfoCard>
                  <InfoCard title="Usage Data" color="violet">Rooms you join, chat messages, and activity logs within the platform.</InfoCard>
                  <InfoCard title="Technical Data" color="blue">IP address, browser type and device, and operating system — for security and service improvement purposes.</InfoCard>
                  <InfoCard title="Microphone" color="yellow">Used only inside watch rooms when you explicitly consent to voice conversations. No audio is recorded or stored on our servers.</InfoCard>
                </div>
              </Section>
              <Section title="3. How We Use Your Information">
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li>Operating the platform and providing core services.</li>
                  <li>Verifying user identity and protecting accounts.</li>
                  <li>Improving platform performance and resolving technical issues.</li>
                  <li>Responding to support requests and reports.</li>
                  <li><strong className="text-white">We do not sell your data to any third party, nor use it for targeted advertising.</strong></li>
                </ul>
              </Section>
              <Section title="4. Sharing Data with Third Parties">
                <p className="mb-3">We do not share your personal data except in the following cases:</p>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li><strong className="text-white">Legal Obligation:</strong> If required by a legal authority under applicable law.</li>
                  <li><strong className="text-white">Security:</strong> To prevent fraud or serious security threats.</li>
                  <li><strong className="text-white">Service Providers:</strong> Technical parties that help us operate the platform (e.g. server hosting) who are bound by confidentiality.</li>
                </ul>
              </Section>
              <Section title="5. Data Retention and Deletion">
                <p>We retain your data as long as your account is active. You may at any time request deletion of your account and all associated data by contacting us via email. Requests will be fulfilled within <strong className="text-white">14 business days</strong>.</p>
              </Section>
              <Section title="6. Cookies">
                <p>We use a single secure cookie (<code className="text-primary text-xs bg-white/5 px-1 py-0.5 rounded">token</code>) to maintain your login session. We do not use tracking or advertising cookies.</p>
              </Section>
              <Section title="7. Data Security">
                <p>We take reasonable security measures to protect your data, including password encryption (bcrypt) and encrypted HTTPS connections. However, no system is completely secure and we recommend using a strong password and not sharing it.</p>
              </Section>
              <Section title="8. Minor's Privacy">
                <p>{APP_NAME} is intended for users aged 13 and older. If we become aware that a minor under 13 has registered an account, we will delete it immediately.</p>
              </Section>
              <Section title="9. Your Rights">
                <p className="mb-2">You have the right to:</p>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li>Access the data we hold about you.</li>
                  <li>Correct any inaccurate information.</li>
                  <li>Request complete deletion of your data.</li>
                  <li>Object to the processing of your data.</li>
                </ul>
                <p className="mt-3">To exercise any of these rights, contact us at: <span className="font-mono text-primary text-xs">{CONTACT_EMAIL}</span></p>
              </Section>
              <Section title="10. Changes to This Policy">
                <p>We may update this policy from time to time. We will notify you of any significant changes via an in-app notification or registered email (if provided). Continued use of the platform after updates constitutes acceptance of the revised policy.</p>
              </Section>
              <Section title="11. Contact Us">
                <p>For any privacy-related inquiries:</p>
                <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
              </Section>
            </>
          )}
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 text-center text-white/20 text-xs">
          © 2026 {APP_NAME} · {isAr ? 'جميع الحقوق محفوظة' : 'All rights reserved'}
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
