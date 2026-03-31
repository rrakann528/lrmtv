import { useLocation } from 'wouter';
import { ArrowRight, Tv2, MessageCircle, Users, Lock, Globe, Zap, Shield, Mail } from 'lucide-react';

const APP = 'LrmTV';
const DOMAIN = 'lrmtv.sbs';
const EMAIL = 'support@lrmtv.sbs';

export default function AboutPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="absolute inset-0 overflow-y-auto bg-background text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setLocation('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white">
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Tv2 className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">عن {APP}</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 pb-24" dir="rtl">

        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-3">عن {APP}</h1>
          <p className="text-white/50 text-sm leading-relaxed">
            {APP} منصة مشاهدة جماعية مجانية تتيح لك ولأصدقائك مشاهدة الفيديوهات والبث المباشر
            معاً في الوقت الحقيقي، مع دردشة فورية وتزامن تلقائي مثالي — من أي مكان في العالم.
          </p>
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed text-sm">

          <Section title="ما هو LrmTV؟">
            <p>
              {APP} هو موقع إلكتروني مجاني يتيح لمجموعة من الأصدقاء أو العائلة مشاهدة الفيديوهات
              معاً في نفس اللحظة عبر الإنترنت — بغض النظر عن المسافة بينهم. يكفي أن تنشئ غرفة
              مشاهدة، تضيف رابط الفيديو، وتشارك الرابط مع من تريد.
            </p>
            <p className="mt-3">
              المنصة لا تستضيف أي محتوى بذاتها — المستخدمون هم من يختارون الروابط التي
              يريدون مشاهدتها مع بعضهم.
            </p>
          </Section>

          <Section title="كيف يعمل الموقع؟">
            <ol className="list-decimal list-inside space-y-2 pr-2">
              <li>أنشئ حساباً مجانياً أو ادخل كزائر.</li>
              <li>اضغط على "إنشاء غرفة" واختر اسماً لها.</li>
              <li>أضف رابط الفيديو (YouTube، HLS، أو أي رابط مباشر).</li>
              <li>شارك رابط الغرفة مع أصدقائك.</li>
              <li>شاهدوا معاً بتزامن تلقائي مع دردشة حية.</li>
            </ol>
          </Section>

          <Section title="مميزات المنصة">
            <div className="grid grid-cols-1 gap-4 mt-2">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex gap-3 items-start">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-white/90 mb-0.5">{title}</p>
                    <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="من هم المستخدمون المستهدفون؟">
            <p>
              {APP} مصمم لكل من يريد مشاركة لحظات المشاهدة مع الآخرين عن بُعد:
            </p>
            <ul className="list-disc list-inside space-y-1.5 pr-2 mt-3">
              <li>الأصدقاء المتفرقون في بلدان مختلفة.</li>
              <li>العائلات التي تريد مشاهدة محتوى مشترك.</li>
              <li>مجتمعات الإنترنت والمجموعات الاجتماعية.</li>
              <li>الطلاب الذين يريدون مشاهدة محاضرات أو دروس معاً.</li>
            </ul>
          </Section>

          <Section title="الدعم والأمان">
            <div className="flex gap-3 items-start">
              <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <p>
                نأخذ أمان المستخدمين على محمل الجد. الغرف يمكن تأمينها بكلمة مرور،
                وتحتوي المنصة على نظام إدارة متكامل يمكّن المضيف من التحكم في الغرفة
                وإدارة المستخدمين وطرد المخالفين.
              </p>
            </div>
          </Section>

          <Section title="اللغات المدعومة">
            <p>
              {APP} متاح بـ <strong className="text-white">6 لغات</strong>: العربية، الإنجليزية،
              الفرنسية، التركية، الإسبانية، والإندونيسية — مع واجهة كاملة ومترجمة لكل لغة.
            </p>
          </Section>

          <Section title="هل المنصة مجانية؟">
            <p>
              نعم، {APP} مجاني بالكامل. يمكنك إنشاء غرف، دعوة أصدقاء، والدردشة معهم
              دون أي اشتراك أو دفع. المنصة تعمل مباشرة من المتصفح دون الحاجة لتنزيل
              أي تطبيق.
            </p>
          </Section>

          <Section title="تواصل معنا">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              <p>
                لأي استفسار أو اقتراح أو بلاغ:
                <span className="font-mono text-primary mr-2">{EMAIL}</span>
              </p>
            </div>
            <p className="mt-2 text-white/40 text-xs">الموقع الإلكتروني: {DOMAIN}</p>
          </Section>

        </div>

        <div className="mt-12 pt-6 border-t border-white/10 text-center text-white/20 text-xs">
          © 2026 {APP} · جميع الحقوق محفوظة
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Tv2,            title: 'مشاهدة جماعية متزامنة',    desc: 'تزامن تلقائي لحظي بين جميع المشاركين في الغرفة — YouTube وبث HLS المباشر.' },
  { icon: MessageCircle, title: 'دردشة فورية',               desc: 'تحدث مع المشاركين أثناء المشاهدة عبر دردشة نصية حية داخل الغرفة.' },
  { icon: Users,         title: 'مكالمات صوتية',             desc: 'تواصل صوتي مباشر بين مستخدمي الغرفة مع التحكم الكامل بالميكروفون.' },
  { icon: Lock,          title: 'غرف خاصة ومحمية',           desc: 'أنشئ غرفاً خاصة بدعوة حصرية أو محمية بكلمة مرور لضمان الخصوصية.' },
  { icon: Globe,         title: 'دعم 6 لغات',                desc: 'واجهة مترجمة كاملاً للعربية والإنجليزية والفرنسية والتركية والإسبانية والإندونيسية.' },
  { icon: Zap,           title: 'سريع وبدون تنزيل',          desc: 'يعمل مباشرة من المتصفح على الجوال والكمبيوتر — لا يحتاج أي تطبيق.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-white font-bold text-base mb-3 border-r-2 border-primary pr-3">{title}</h2>
      <div>{children}</div>
    </div>
  );
}
