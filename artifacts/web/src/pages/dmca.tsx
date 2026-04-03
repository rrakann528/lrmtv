import { useLocation } from 'wouter';
import { ArrowRight, FileWarning, Mail } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const APP_NAME = 'LrmTV';
const DOMAIN = 'lrmtv.sbs';
const DMCA_EMAIL = 'dmca@lrmtv.sbs';
const LAST_UPDATED = 'April 3, 2026';

export default function DmcaPage() {
  const [, setLocation] = useLocation();
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white"
          >
            <ArrowRight className="w-4 h-4" style={{ transform: isAr ? 'none' : 'rotate(180deg)' }} />
          </button>
          <div className="flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-sm">DMCA</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8" dir={dir}>

        {isAr ? (
          <>
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-1">سياسة حقوق النشر — DMCA</h1>
              <p className="text-sm text-muted-foreground">آخر تحديث: {LAST_UPDATED}</p>
            </div>

            <Section title="احترام حقوق الملكية الفكرية">
              <p>{APP_NAME} يحترم حقوق الملكية الفكرية ويلتزم بأحكام قانون الألفية الرقمية لحقوق المؤلف (DMCA). إذا كنت تعتقد أن محتوى ما على منصتنا ينتهك حقوق نشرك، يرجى إرسال إشعار إليغ وفق الخطوات أدناه.</p>
            </Section>

            <Section title="ما هو LrmTV؟">
              <p>{APP_NAME} هي منصة مشاهدة مشتركة تتيح للمستخدمين مزامنة مشاهدة الفيديوهات من منصات خارجية (يوتيوب، تويتش، فيميو...). نحن <strong className="text-foreground">لا نستضيف</strong> أي محتوى فيديو على خوادمنا. المحتوى يُبَث مباشرةً من المنصات الأصلية.</p>
            </Section>

            <Section title="كيفية تقديم إشعار DMCA">
              <p className="mb-3">لتقديم إشعار انتهاك حقوق النشر، أرسل بريداً إلكترونياً إلى:</p>
              <a href={`mailto:${DMCA_EMAIL}`} className="inline-flex items-center gap-2 px-4 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 font-medium text-sm mb-4">
                <Mail className="w-4 h-4" />
                {DMCA_EMAIL}
              </a>
              <p className="mb-2">يجب أن يتضمن إشعارك:</p>
              <ol className="space-y-2 list-decimal list-inside text-white/70 text-sm">
                <li>توقيعك الإلكتروني أو الفيزيائي بصفتك صاحب الحق أو مفوضاً عنه</li>
                <li>وصف دقيق للعمل المحمي بحقوق النشر الذي تدّعي انتهاكه</li>
                <li>رابط الصفحة التي تحتوي على المحتوى المنتهِك</li>
                <li>معلومات الاتصال بك (البريد الإلكتروني أو العنوان أو رقم الهاتف)</li>
                <li>بيان بأن استخدام المحتوى غير مرخص من قِبل صاحب الحق أو القانون</li>
                <li>بيان بأن المعلومات الواردة في إشعارك دقيقة تحت طائلة الحلف بالقسم</li>
              </ol>
            </Section>

            <Section title="الإجراء بعد الإشعار">
              <p>عند استلام إشعار صحيح ومستوفٍ للشروط، سنتخذ الإجراء المناسب في أسرع وقت ممكن، بما في ذلك إزالة الرابط أو إيقاف الغرفة المعنية.</p>
            </Section>

            <Section title="إشعار مضاد — Counter Notice">
              <p>إذا كنت تعتقد أن المحتوى أُزيل عن طريق الخطأ، يمكنك تقديم إشعار مضاد يتضمن بياناتك ووصف سبب اعتقادك بأن الإزالة كانت خاطئة، مع موافقتك على الاختصاص القضائي المناسب.</p>
            </Section>

            <Section title="تكرار الانتهاكات">
              <p>{APP_NAME} تلتزم بإنهاء حسابات المستخدمين الذين يثبت انتهاكهم المتكرر لحقوق النشر.</p>
            </Section>

            <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-2xl text-sm text-white/60">
              <p><strong className="text-orange-400">ملاحظة:</strong> {APP_NAME} لا تستضيف المحتوى — المنصات الخارجية (يوتيوب، تويتش...) هي المسؤولة عن محتواها. للإبلاغ عن انتهاك على تلك المنصات، تواصل معها مباشرةً.</p>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-1">DMCA — Copyright Policy</h1>
              <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>

            <Section title="Respect for Intellectual Property">
              <p>{APP_NAME} respects intellectual property rights and complies with the Digital Millennium Copyright Act (DMCA). If you believe that content on our platform infringes your copyright, please submit a takedown notice following the steps below.</p>
            </Section>

            <Section title="What is LrmTV?">
              <p>{APP_NAME} is a synchronized watch-party platform that allows users to co-watch videos from third-party platforms (YouTube, Twitch, Vimeo, etc.). We <strong className="text-foreground">do not host</strong> any video content on our servers. Content is streamed directly from the original platforms.</p>
            </Section>

            <Section title="How to Submit a DMCA Takedown Notice">
              <p className="mb-3">To report a copyright infringement, please send an email to:</p>
              <a href={`mailto:${DMCA_EMAIL}`} className="inline-flex items-center gap-2 px-4 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 font-medium text-sm mb-4">
                <Mail className="w-4 h-4" />
                {DMCA_EMAIL}
              </a>
              <p className="mb-2">Your notice must include:</p>
              <ol className="space-y-2 list-decimal list-inside text-white/70 text-sm">
                <li>Your physical or electronic signature as the copyright owner or authorized agent</li>
                <li>A description of the copyrighted work you claim has been infringed</li>
                <li>The URL of the page where the allegedly infringing content appears</li>
                <li>Your contact information (email address, postal address, or phone number)</li>
                <li>A statement that you have a good faith belief the use is not authorized by the copyright owner, its agent, or the law</li>
                <li>A statement that the information in your notice is accurate, under penalty of perjury</li>
              </ol>
            </Section>

            <Section title="Action After Notice">
              <p>Upon receipt of a valid and complete DMCA notice, we will act expeditiously, including removing the relevant link or disabling the concerned room.</p>
            </Section>

            <Section title="Counter Notice">
              <p>If you believe content was removed in error, you may submit a counter notice that includes your contact information, a description of why you believe the removal was a mistake, and your consent to the appropriate jurisdiction.</p>
            </Section>

            <Section title="Repeat Infringers">
              <p>{APP_NAME} is committed to terminating accounts of users who are found to be repeat infringers of copyright.</p>
            </Section>

            <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-2xl text-sm text-white/60">
              <p><strong className="text-orange-400">Note:</strong> {APP_NAME} does not host content — third-party platforms (YouTube, Twitch, etc.) are responsible for their own content. To report infringement on those platforms, contact them directly.</p>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
          <Mail className="w-4 h-4" />
          <span>Contact: <a href={`mailto:${DMCA_EMAIL}`} className="text-primary">{DMCA_EMAIL}</a></span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground border-b border-white/10 pb-2">{title}</h2>
      <div className="text-sm text-white/70 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
