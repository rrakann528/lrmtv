import { useLocation } from 'wouter';
import { ArrowRight, Shield } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const LAST_UPDATED_AR = '٢٥ مارس ٢٠٢٦';
const LAST_UPDATED_EN = 'March 25, 2026';
const APP_NAME = 'LrmTV';
const CONTACT_EMAIL = 'support@lrmtv.sbs';

export default function TermsPage() {
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
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">{isAr ? 'شروط الاستخدام' : 'Terms of Use'}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24" dir={dir}>
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">{isAr ? 'شروط الاستخدام' : 'Terms of Use'}</h1>
          <p className="text-white/40 text-sm">{isAr ? `آخر تحديث: ${LAST_UPDATED_AR}` : `Last updated: ${LAST_UPDATED_EN}`}</p>
        </div>

        <div className="space-y-8 text-white/75 leading-relaxed text-sm">
          {isAr ? (
            <>
              <Section title="١. القبول والموافقة">
                <p>باستخدامك لمنصة {APP_NAME}، فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق على أي بند من هذه الشروط، يرجى التوقف عن استخدام المنصة فوراً.</p>
              </Section>
              <Section title="٢. وصف الخدمة">
                <p>{APP_NAME} منصة اجتماعية تتيح للمستخدمين مشاهدة المحتوى الإعلامي بشكل جماعي في الوقت الفعلي عبر غرف مشاهدة مشتركة مع إمكانية الدردشة والمحادثات الصوتية. المنصة لا تستضيف أي محتوى بذاتها، بل تُمكّن المستخدمين من مشاركة روابط خارجية.</p>
              </Section>
              <Section title="٣. حقوق الملكية الفكرية والمحتوى المحمي">
                <p className="mb-3">أنت المسؤول الوحيد والكامل عن أي محتوى تشاركه داخل المنصة. بقبولك لهذه الشروط، تُقرّ وتضمن أنك:</p>
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
                <p>تحترم {APP_NAME} حقوق الملكية الفكرية وتستجيب لطلبات الإزالة القانونية. إذا كنت صاحب حق وتعتقد أن محتوى على المنصة ينتهك ملكيتك الفكرية، يُرجى التواصل معنا على:</p>
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
                <p>تحتفظ {APP_NAME} بالحق الكامل في تعليق أو إنهاء حساب أي مستخدم يخالف هذه الشروط، دون إشعار مسبق وبدون أي التزام بالتعويض.</p>
              </Section>
              <Section title="٧. إخلاء المسؤولية">
                <p>تُقدَّم خدمة {APP_NAME} "كما هي" دون أي ضمانات صريحة أو ضمنية. لا تتحمل المنصة مسؤولية أي ضرر مباشر أو غير مباشر ناتج عن استخدامك للخدمة أو من المحتوى الذي يشاركه المستخدمون.</p>
              </Section>
              <Section title="٨. تعديل الشروط">
                <p>يحق لنا تعديل هذه الشروط في أي وقت. سيتم إشعارك بالتغييرات الجوهرية عبر إشعار داخل التطبيق. استمرارك في استخدام المنصة بعد التعديل يُعدّ قبولاً للشروط الجديدة.</p>
              </Section>
              <Section title="٩. التواصل معنا">
                <p>لأي استفسارات بخصوص هذه الشروط أو للإبلاغ عن مخالفة:</p>
                <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
              </Section>
            </>
          ) : (
            <>
              <Section title="1. Acceptance">
                <p>By using {APP_NAME}, you agree to be bound by these Terms. If you do not agree with any part of these Terms, please stop using the platform immediately.</p>
              </Section>
              <Section title="2. Service Description">
                <p>{APP_NAME} is a social platform that allows users to watch media content together in real time through shared watch rooms with chat and voice conversation capabilities. The platform does not host any content itself, but enables users to share external links.</p>
              </Section>
              <Section title="3. Intellectual Property and Protected Content">
                <p className="mb-3">You are solely responsible for any content you share on the platform. By accepting these Terms, you represent and warrant that you will:</p>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li>Not share any content broadcast by licensed channels or entities without their explicit permission (matches, movies, TV shows, etc.).</li>
                  <li>Not use the platform to infringe copyrights or exclusive broadcast rights.</li>
                  <li>Bear sole responsibility for any legal or financial consequences arising from intellectual property violations.</li>
                  <li>Release {APP_NAME} and its management from any liability regarding content you publish.</li>
                </ul>
                <p className="mt-3 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300/80 text-xs">
                  Warning: Broadcasting licensed sports, movies, or TV shows without permission constitutes a clear violation of intellectual property rights and may expose you to legal liability in your country.
                </p>
              </Section>
              <Section title="4. DMCA / Takedown Policy">
                <p>{APP_NAME} respects intellectual property rights and responds to legal takedown requests. If you are a rights holder and believe content on the platform infringes your intellectual property, please contact us at:</p>
                <p className="mt-2 font-mono text-primary text-xs p-2 bg-white/5 rounded-lg inline-block">{CONTACT_EMAIL}</p>
                <p className="mt-3">We will review the report and take appropriate action within <strong className="text-white">72 hours</strong>.</p>
              </Section>
              <Section title="5. Acceptable Conduct">
                <p className="mb-2">Users are prohibited from:</p>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li>Posting offensive, racist, or pornographic content.</li>
                  <li>Harassing other users or abusing communication features.</li>
                  <li>Using the platform for illegal purposes.</li>
                  <li>Attempting to hack the platform or harm its security or that of its users.</li>
                  <li>Creating multiple accounts to circumvent ban decisions.</li>
                </ul>
              </Section>
              <Section title="6. Suspension and Termination">
                <p>{APP_NAME} reserves the full right to suspend or terminate the account of any user who violates these Terms, without prior notice and without any obligation to compensate.</p>
              </Section>
              <Section title="7. Disclaimer">
                <p>The {APP_NAME} service is provided "as is" without any express or implied warranties. The platform is not responsible for any direct or indirect damage resulting from your use of the service or from content shared by users.</p>
              </Section>
              <Section title="8. Modification of Terms">
                <p>We reserve the right to modify these Terms at any time. You will be notified of significant changes via an in-app notification. Continued use of the platform after modification constitutes acceptance of the new Terms.</p>
              </Section>
              <Section title="9. Contact Us">
                <p>For any inquiries about these Terms or to report a violation:</p>
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
