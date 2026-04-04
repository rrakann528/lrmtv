# LrmTV — Social Streaming Platform

## المشروع / Overview

LrmTV منصة مشاهدة جماعية للفيديو بالوقت الفعلي (مثل Watch2Gether). يتشارك المستخدمون غرف لمشاهدة البث المباشر والمحتوى مع مزامنة تلقائية ودردشة ولوحة تحكم. الواجهة تدعم 6 لغات (عربي، إنجليزي، فرنسي، تركي، إسباني، إندونيسي).

---

## Deployment (مهم جداً)

- **Platform**: Railway
- **Domain**: `lrmtv.sbs` (Hostinger DNS → Cloudflare → Railway)
- **GitHub**: `rrakann528/LrmTV`
- **BASE_URL**: `https://lrmtv.sbs`
- **Admin panel**: `https://lrmtv.sbs/admin`
- **Admin email**: `rrakann528@gmail.com`
- **Dockerfile**: يبني الـ frontend بـ `BASE_PATH=/` ثم يشغّل `start.sh` اللي يشغّل `node migrate.cjs` ثم API server

---

## قاعدة رفع الكود — CRITICAL

> **لا ترفع أبداً تلقائياً** — انتظر دائماً حتى يقول المستخدم: **"ارفع التحديث"** أو **"ارفع"**

**طريقة الرفع (Git مع GitHub Connector):**
```javascript
// في code_execution sandbox:
const conns = await listConnections('github');
const token = conns[0].settings.access_token;
// ثم git add + commit + push --force origin main باستخدام الـ token
```

**ملاحظات الرفع:**
- يجب عمل `git add` + `git commit` أولاً (Replit لا يعمل auto-commit)
- استخدم `--force` دائماً عند الرفع
- ملف `IMG_0377` دائماً يفشل بخطأ 413 — تجاهله نهائياً

---

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 / **TypeScript**: 5.9 / **Package manager**: pnpm
- **API**: Express 5 + Socket.io (port 8080)
- **Frontend**: React + Vite + Tailwind CSS (port 5000)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4) + drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Video**: SmartPlayer — HLS.js, dash.js, react-player (YouTube/Twitch/Vimeo), HTML5, SponsorBlock auto-skip
- **Shared Browser (Kosmi-style)**: DJ opens Playwright browser → screencast frames broadcast to ALL room users via Socket.IO → everyone sees the same browser view. No URL extraction or HLS proxy needed.
- **Link Sniffer**: Puppeteer-core + system Chromium (network interception for video URLs)
- **Real-time**: Socket.io (sync, chat, WebRTC video relay)
- **State**: Zustand
- **i18n**: Custom React context — 6 لغات (ar, en, fr, tr, es, id) — مفتاح LS: `lrmtv_lang`

---

## SEO & Icons

- **Favicon**: `favicon.ico` (16+32px), `favicon-16.png`, `favicon-32.png` — proper PNG for Google indexing
- **PWA icons**: `icon-192.png`, `icon-512.png` (PNG) + SVG variants for maskable
- **Apple**: `apple-touch-icon.png` (180px)
- **OG image**: `opengraph.jpg` (1200×630) — branded for social sharing
- **Structured data**: WebApplication + WebSite + Organization + BreadcrumbList (JSON-LD)
- **Sitemap**: `sitemap.xml` with image namespace
- **Robots**: `robots.txt` allows all except `/api/` and `/room/`
- **All files in**: `artifacts/web/public/`

---

## Structure

```
artifacts-monorepo/
├── artifacts/
│   ├── api-server/
│   │   └── src/
│   │       ├── lib/socket.ts          ← Socket.io events (sync, chat, heartbeat 1.5s)
│   │       ├── routes/admin.ts        ← 26 admin API endpoints
│   │       ├── routes/rooms.ts        ← Room CRUD
│   │       ├── routes/stream-proxy.ts  ← HLS/DASH proxy with m3u8 rewrite (relative URLs)
│   │       ├── routes/hls-proxy.ts    ← detect + check فقط (البروكسي انتقل لـ CF Worker)
│   │       └── middlewares/security.ts ← rate limiter (proxy paths exempt)
│   └── web/
│       └── src/
│           ├── pages/room.tsx         ← Room page + sync logic + "Press to Watch" overlay
│           ├── components/player/
│           │   ├── hls-player.tsx     ← HLS 7-stage fallback + HLS_CONFIG
│           │   ├── smart-player.tsx   ← Player switcher (YouTube/HLS/HTML5) — no autoplay
│           │   └── player-controls.tsx
│           ├── hooks/
│           │   ├── use-socket.ts      ← Socket state + heartbeat handler
│           │   └── use-background-alive.ts ← PWA keep-alive (Web Audio + Wake Lock + Media Session)
│           └── lib/
│               └── i18n.tsx           ← 6 languages, 200+ keys
├── lib/
│   ├── api-spec/          ← OpenAPI spec + Orval codegen
│   ├── api-client-react/  ← Generated React Query hooks
│   ├── api-zod/           ← Generated Zod schemas
│   └── db/
│       └── src/schema/    ← rooms, users, playlist_items, chat_messages, groups, group_members, group_invitations
├── lib/db/migrate.cjs     ← DB migration (runs on start)
└── scripts/
```

---

## HLS Fallback Chain (6 مراحل — CF Worker)

```
S1 HLS.js direct
  → S2 Native HTML5 <video>
    → S3 CF manifest proxy (CF Worker → manifest فقط)
      → S4 CF full proxy (كل شيء عبر CF Worker)
        → S5 CF full + segment rewrite
          → S6 Native video final (20s timeout — last resort for IP-locked streams)
            → Error (فشل تحميل البث)
```

## Page Browser (استخراج فيديو من صفحات)

ميزة تسمح بلصق رابط صفحة فيلم (مثل إيجي بست، فاصل هد، إلخ) واستخراج رابط الفيديو المباشر تلقائياً ثم تشغيله في الغرفة مع التزامن.

### كيف يعمل — وضع مزدوج بالتوازي

عند لصق رابط صفحة، **طريقتان تعملان في نفس الوقت**، أيهما تكشف الفيديو أول تفوز:

**المسار الأول — المتصفح الافتراضي (خلفية السيرفر):**
- **Headless Chromium** (Playwright) يفتح الصفحة كمتصفح حقيقي على السيرفر
- Anti-detection: يخفي `navigator.webdriver`، يضيف plugins وهمية، يحاكي Chrome حقيقي
- **Network Interception**: يعترض كل الطلبات الشبكية على مستوى الشبكة (context.route) — يكشف الفيديو حتى بدون امتداد `.m3u8`
- يفحص Content-Type headers لكشف streams (`application/vnd.apple.mpegurl`, `video/*`, إلخ)
- يكشف HLS/DASH حتى بدون امتداد: `/hls/`, `/dash/`, `master.m3u8`, `type=m3u8`, إلخ
- يغلق نوافذ الكوكيز والإعلانات تلقائياً
- يضغط أزرار التشغيل (20+ selector بما فيها مواقع عربية)
- يفحص `<video>` elements + iframes المتداخلة بشكل دوري
- إذا فشل Playwright → يجرب استخراج HTML ثابت (يتبع iframes حتى 3 مستويات)
- **المتصفح يبقى خامل 60 ثانية** ثم ينطفي (توفير موارد)
- **حد 3 استخراجات متزامنة** + rate limit: 5 طلبات/دقيقة/IP
- **حماية SSRF**: يحظر كل الطلبات لعناوين خاصة عبر `context.route()`

**المسار الثاني — Iframe تفاعلي (أمام المستخدم):**
- الصفحة تظهر فوراً في iframe — المستخدم يشوف الصفحة ويقدر يتفاعل معها
- Bridge script مُحقَن في الصفحة يراقب تلقائياً:
  - `fetch()` hooks — يفحص URL + response body + Content-Type
  - `XMLHttpRequest.open()` + `send()` + response scanning
  - `HTMLMediaElement.src` setter + `play()` hook
  - `window.open()` hook (بعض المشغلات تفتح الفيديو في تبويب جديد)
  - MutationObserver على `<video>`/`<source>`/`data-src`/`data-hls` elements
  - Polling كل 1.5 ثانية على `video.currentSrc`
  - يكشف HLS hints بدون امتداد (`/hls/`, `master.m3u8`, `type=m3u8`, إلخ)
- Bridge يرسل `postMessage` للـ parent عند كشف أي رابط فيديو
- Nested iframes يتم تمريرها عبر `/api/proxy/page` تلقائياً

**UI الجديد (page-browser.tsx):**
- يجمع كل الروابط المكتشفة (HLS + MP4 + إلخ) في قائمة قابلة للاختيار
- يشغّل أفضل رابط تلقائياً (HLS يُفضَّل على MP4)
- زر "إعادة المحاولة" عند عدم الكشف
- يدعم التشغيل اليدوي من قائمة الروابط

### Dockerfile
- Base: `node:20-alpine`
- يثبت: `chromium nss freetype harfbuzz ca-certificates ttf-freefont`
- Chromium path: `/usr/bin/chromium-browser` (auto-detect fallback لـ `/usr/bin/chromium`)
- يشتغل كـ non-root user (`appuser`) — `user-data-dir=/tmp/chromium-user-data`

### الملفات
- `artifacts/api-server/src/lib/browser-extract.ts` — Virtual browser extraction
- `artifacts/api-server/src/routes/page-proxy.ts` — `/api/proxy/extract` + `/api/proxy/page`
- `artifacts/web/src/components/player/page-browser.tsx` — Dual-mode UI

- **HTTP على HTTPS**: يتخطى مباشرة إلى S5 (mixed content)
- **iOS Safari بدون MSE بعد فشل S2**: يذهب لـ S5
- **CF Worker URL**: `VITE_CF_PROXY_URL` (**مطلوب** لتفعيل المراحل S3-S5)
- بدون CF Worker، المشغل يحاول S1+S2 فقط ثم يظهر خطأ

## CF Worker (cf-worker/)

كود Worker كامل في `cf-worker/worker.js` + `wrangler.toml`:
- **mode=manifest**: بروكسي المانيفست مع إعادة كتابة الروابط
- **mode=full**: كشف تلقائي (manifest → rewrite, segments → stream)
- **mode=segment**: بروكسي السيجمنتات مع Referer
- **mode=video**: بروكسي فيديو مباشر (MP4/WebM) مع Range

`rewriteManifest()` تُعيد كتابة segments + `#EXT-X-KEY` + `#EXT-X-MAP` + `#EXT-X-MEDIA` عبر الـ Worker.

**نشر الـ Worker:**
```bash
cd cf-worker && npx wrangler deploy
```
ثم حط الرابط في `VITE_CF_PROXY_URL` (مثلاً `https://lrmtv-proxy.username.workers.dev`)

## API Server Proxy (hls-proxy.ts)

- `GET /api/proxy/detect?url=...` — كشف نوع الفيديو (hls/dash/mp4/webm)
- `GET /api/proxy/check?url=...` — فحص وصول السيرفر للرابط (كشف IP-lock)
- تم حذف manifest/segment/video من السيرفر — الآن كلها عبر CF Worker
- **Rate limiter**: مسارات `/proxy/*` و`/auth/me` مُعفاة من حد 300 req/15min

---

## Sync & Playback (التزامن والتشغيل)

### Server (socket.ts)
- Heartbeat: كل **1.5 ثانية** (يبث `computedTime` + `serverTs`)
- `computedTime`: `currentTime + (Date.now() - lastSyncTimestamp) / 1000`

### Client (room.tsx)
| المصدر | حد الانحراف للتصحيح |
|--------|---------------------|
| action (play/pause/seek) | **0.8 ثانية** |
| heartbeat | **2 ثوانٍ** |
| أول 5 ثوانٍ بعد الانضمام | لا يصحح (grace period) |

- قفل seek بعد المزامنة: **400ms**
- تعويض التأخر: `syncState.time + latencyS`

### "Press to Watch" (اضغط للمشاهدة)
- **كل مستخدم** (بما في ذلك DJ/Admin) يرى زر "اضغط للمشاهدة" عند:
  - دخول غرفة فيها فيديو يعمل
  - تغيير الفيديو الحالي
- عند الضغط: يبدأ التشغيل + يقفز للوقت الحالي (sync)
- يحل مشكلة التشغيل التلقائي على الجوال (يعطي user gesture)
- **لا يوجد تشغيل تلقائي** — التشغيل دائماً يحتاج ضغطة من المستخدم

---

## HLS_CONFIG (hls-player.tsx)

```javascript
{
  enableWorker: true,
  lowLatencyMode: false,
  startFragPrefetch: true,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 4,
  maxLiveSyncPlaybackRate: 1.2,
  backBufferLength: 20,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  manifestLoadingMaxRetry: 1,
  manifestLoadingTimeOut: 6_000,
  manifestLoadingRetryDelay: 500,
  levelLoadingMaxRetry: 3,
  levelLoadingTimeOut: 10_000,
  fragLoadingMaxRetry: 5,
  fragLoadingTimeOut: 12_000,
  fragLoadingRetryDelay: 300,
  startLevel: -1,              // auto-detect best quality
  abrEwmaDefaultEstimate: 2_000_000,  // 2 Mbps
  abrBandWidthFactor: 0.9,
  abrBandWidthUpFactor: 0.7,
  testBandwidth: true,
  progressive: true,
  nudgeMaxRetry: 10,
  nudgeOffset: 0.1,
}
```

---

## Environment Variables (Railway)

| Variable | Value/Source |
|---|---|
| `DATABASE_URL` | PostgreSQL على Railway |
| `JWT_SECRET` | Secret قوي |
| `ADMIN_EMAIL` | `rrakann528@gmail.com` |
| `BASE_URL` | `https://lrmtv.sbs` |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_CALLBACK_URL` | `https://lrmtv.sbs/api/auth/google/callback` |
| `SMTP_PASSWORD` | لإرسال OTP بالبريد |

---

## Database Schema (الجداول الرئيسية)

- **rooms**: id, slug, name, type (public/private), background, dj_socket_id
- **users**: id, email, username, role (admin/user), google_id, password_hash, is_muted, admin_note, last_seen_at, last_ip
- **playlist_items**: id, room_id, url, source_type, title, position, added_by
- **chat_messages**: id, room_id, username, content, type, reply_to_id, reply_to_username, reply_to_content, created_at
- **direct_messages**: id, sender_id, receiver_id, content, reply_to_id, reply_to_content, reply_to_sender_name, is_edited, edited_at, created_at
- **group_messages**: id, group_id, sender_id, content, reply_to_id, reply_to_content, reply_to_sender_name, is_edited, edited_at, created_at
- **message_reactions**: id, message_type (dm/group), message_id, user_id, emoji, created_at — UNIQUE(message_type, message_id, user_id, emoji)
- **dm_read_receipts**: user_id, friend_id, last_read_at
- **room_members**: room_id, user_id, role (dj/viewer)
- **site_settings**: `key` (PRIMARY KEY — لا يوجد عمود `id`)

---

## Socket.io Events الرئيسية

| Event | وصف |
|---|---|
| `join-room` | دخول غرفة |
| `video-sync` | مزامنة الفيديو (play/pause/seek/change-video) + serverTs |
| `heartbeat` | نبض كل 1.5 ثانية (currentTime + serverTs) |
| `chat-message` | رسالة دردشة (يدعم replyTo) |
| `delete-message` | حذف رسالة (غرفة) |
| `message-deleted` | إشعار حذف رسالة (غرفة) |
| `dm:deleted` | إشعار حذف رسالة خاصة |
| `group:message-deleted` | إشعار حذف رسالة مجموعة |
| `playlist-update` | تحديث قائمة التشغيل |
| `dj-backgrounding` | DJ أخفى الـ PWA (يمنع إرسال pause وهمي) |
| `subtitle-sync` | مزامنة الترجمة |
| `toggle-lock` | قفل/فتح التحكم |
| `grant-dj` | منح صلاحية DJ |
| `request-sync` | المستخدم يطلب إعادة المزامنة |
| `relay-mode` | DJ يبث الفيديو عبر WebRTC (active: bool) |
| `link-sniff` | POST — استخراج روابط فيديو من صفحة بث |

---

## i18n (6 لغات)

- `useI18n()` → `{ lang, setLang, t, dir }`
- مفتاح LocalStorage: `lrmtv_lang`
- الاتجاه (RTL/LTR) يتغير ديناميكياً عند تبديل اللغة (عبر `document.documentElement.dir`)
- `I18nProvider` يغلف كل شيء في `App.tsx`
- `I18nProvider` يزامن `document.documentElement.lang` و `.dir` عند تغيير اللغة
- جميع الملفات مكتملة 100% — لا توجد نصوص عربية hardcoded
- `formatLastTime` في friends-tab يدعم 6 لغات

---

## لوحة الأدمن — Admin Panel

تبويبات: الرئيسية / المستخدمون / الغرف / المحادثات / الإشعارات / الإعدادات / الأمان / النظام

**ميزات المستخدمين:** حظر/رفع — كتم الدردشة — ملاحظة أدمن — تعديل اسم/بريد — إعادة تعيين كلمة مرور — طرد من كل الغرف — تصدير CSV — Paginated (limit=100, max=500)

**ميزات الغرف:** تجميد/رفع — تغيير نوع — إعادة تسمية — عرض/مسح محادثة — مسح قائمة التشغيل — تشغيل/إيقاف إجباري — حذف — تصدير CSV

**الإعدادات:** وضع الصيانة — تفعيل/إيقاف التسجيل — إعلان الموقع — حد الغرف — فلتر الكلمات المحظورة

**الأمان:** IP محظورة — سجل محاولات الدخول الفاشلة

**النظام:** معلومات الخادم — مشتركو push — نسخ احتياطي

---

## Chat Features — ميزات الدردشة

**مشتركة بين الثلاثة (غرفة، خاصة، مجموعة):**
- **الرد على الرسائل**: اضغط مطوّل → "رد" → يظهر اقتباس فوق الإدخال، والرسالة المرسلة تحتوي على QuotedMessage
- **قائمة خيارات (ضغط مطوّل/كلك يمين)**: رد، نسخ، حذف (رسائلك فقط + الأدمن)
- **روابط قابلة للضغط**: أي URL في الرسالة يتحول لرابط clickable (LinkifiedText)
- **حذف الرسائل**: المرسل يحذف رسالته، الأدمن يحذف أي رسالة (real-time عبر socket)

**المكونات المشتركة:**
- `artifacts/web/src/components/chat/message-context-menu.tsx` — قائمة خيارات
- `artifacts/web/src/components/chat/reply-preview.tsx` — شريط الرد فوق الإدخال
- `artifacts/web/src/components/chat/quoted-message.tsx` — الاقتباس داخل فقاعة الرسالة
- `artifacts/web/src/components/chat/linkified-text.tsx` — تحويل URLs لروابط
- `artifacts/web/src/lib/linkify.ts` — utility لكشف الروابط

**DB columns added:**
- `chat_messages`: `reply_to_id`, `reply_to_username`, `reply_to_content`
- `direct_messages`: `reply_to_id`, `reply_to_content`, `reply_to_sender_name`
- `group_messages`: `reply_to_id`, `reply_to_content`, `reply_to_sender_name`

---

## الميزات الجديدة (مارس 2026)

1. **Groups (المجموعات)**: مستخدمون يمكنهم إنشاء مجموعات خاصة، إضافة أعضاء، ودعوة المجموعة بأكملها لغرفة واحدة. جداول: `groups`, `group_members`. Routes: `/api/groups/*`. UI: تبويب "المجموعات" في الصفحة الرئيسية.
2. **Profile Photo Upload**: المستخدمون يرفعون صور الملف الشخصي عبر `/api/auth/avatar-upload` (multer, max 5MB). الصور تُقدَّم من `/api/uploads/`. الـ preset avatars أُزيلت.
3. **Room Header Improvements**: عرض عنوان الفيديو الحالي (YouTube/Twitch/etc) واسم الأدمن في header الغرفة.
4. **DM Chat Improvements**: فواصل تواريخ، timestamps بلغة المستخدم، رسائل optimistic، UI محسّن.
5. **Password Change**: المستخدمون يغيرون كلمة المرور من صفحة الملف الشخصي.
6. **Room Username Fix**: المستخدمون المسجلون يدخلون الغرف تلقائياً بأسماء حساباتهم (لا prompt).
7. **"Press to Watch" button**: زر اضغط للمشاهدة يظهر لكل مستخدم عند كل فيديو جديد — يحل مشكلة autoplay ويحسن التزامن.
8. **Ads removed**: كود الإعلانات (ad-banner, pre-roll-ad, vast-proxy) أُزيل بالكامل.
9. **Telegram-like Chat Features (مكتملة)**:
   - **Typing indicator**: `dm:typing` + `group:typing` socket events — يظهر "يكتب..." في header الدردشة
   - **Read receipts ✓✓**: علامة واحدة (✓ مُرسلة) + علامتين (✓✓ مقروءة) في الرسائل الخاصة — جدول `dm_read_receipts`
   - **Unread count badges**: عدّاد الرسائل غير المقروءة في تبويبات الأصدقاء والمجموعات
   - **Emoji reactions**: ردود فعل على الرسائل — جدول `message_reactions` — `dm:reaction` + `group:reaction` events
   - **Edit messages**: تعديل الرسائل — أعمدة `is_edited` + `edited_at` — `dm:edited` + `group:message-edited` events
   - **@mention notifications**: تمييز `@username` بلون سماوي + نافذة اقتراحات + إشعار banner للمنشن
10. **iOS Safari HLS Fix**: كشف iOS Safari (`!Hls.isSupported()`) → تشغيل native `<video>` مباشرة مع timeout 25 ثانية + `webkit-playsinline` + `preload="auto"`
11. **PWA Background Keep-Alive**: hook `use-background-alive.ts` — مذبذب Web Audio صامت (يمنع iOS من تعليق التطبيق) + Wake Lock API (يمنع نوم الشاشة) + Media Session API (أزرار التحكم في شاشة القفل)
12. **Guest Black Screen Fix**: جميع أخطاء `play()` الآن تعرض "اضغط للتشغيل" بدل شاشة سوداء صامتة — يشمل أخطاء native fallback
13. **Proxy Relative URLs**: `buildProxyBase` في `stream-proxy.ts` يستخدم مسار نسبي `/api/proxy/stream` بدل رابط مطلق يعتمد على headers (أكثر أماناً مع Railway)
14. **Fullscreen Chat Overflow Fix**: `break-all` + `whitespace-pre-wrap` + `overflow-hidden` على فقاعات الرسائل — النصوص الطويلة تنكسر داخل الفقاعة

---

## ملاحظات مهمة

1. **WebRTC Video Relay**: DJ يقدر يبث الفيديو مباشرة للمشاهدين عبر WebRTC (زر "بث" في الهيدر) — مفيد للبث المحلي أو المحتوى المقفل جغرافياً
2. **Link Sniffer (استخراج)**: Puppeteer يفتح صفحة بث ويستخرج روابط الفيديو تلقائياً — مدعوم: EgyBest, Shahid4u, FaselHD, MyCima, Akwam, ArabSeed, يلا شوت وغيرها — ملفات: `link-sniffer.ts`, `link-sniff.ts`, `link-sniffer.tsx`
2. **Ads removed**: لا يوجد أي كود إعلانات في المشروع
3. **DB Indexes**: `idx_chat_room_created` (chat_messages), `idx_rooms_creator` (rooms), `idx_dm_sender/receiver/pair` (direct_messages), `idx_friendships_addressee`
4. **N+1 fix**: `/friends/conversations` uses `DISTINCT ON` + single unread COUNT query instead of per-friend loops
5. **الـ stall watchdog** يفحص كل 1 ثانية ويتدخل بعد 2 ثانية توقف
6. **البروكسي انتقل لـ CF Worker** — لا يستهلك موارد السيرفر، لا يمرر IP العميل
7. **TypeScript composite projects** — دائماً `typecheck` من الـ root
8. **رسالة خطأ الفيديو**: "فشل تحميل البث" (لا تذكر IP أو شبكة) — تظهر فقط عند فشل حقيقي
9. **siteSettingsTable**: يستخدم `key` كـ PRIMARY KEY (لا يوجد عمود `id`)

---

## Groups & Invitations (المجموعات والدعوات)

- **Schema**: `groups`, `group_members`, `group_invitations` tables
- **group_invitations**: UNIQUE(group_id, invitee_id), status: pending/accepted/rejected
- **Invite flow**: Admin sends invite → recipient gets push + socket `group:invite` event → accepts/rejects from pending invites section
- **API routes**: POST `/groups/:id/invite`, GET `/group-invitations`, POST `/group-invitations/:id/accept`, POST `/group-invitations/:id/reject`
- **Group settings (admin)**: Edit name/description, change avatar color (8 preset colors), toggle private/public
- **Push**: Group messages + invites trigger push notifications via `sendGroupPush()` in groups.ts
- **JWT Secret**: Both `auth.ts` and `socket.ts` use `process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env'`
- **PWA**: Service worker v8 with offline page, manifest with categories/screenshots/shortcuts
- **Avatar storage**: Base64 data URL in DB (not disk files). Frontend compresses to 256px JPEG before upload (max 500KB). Survives container restarts.
- **Keyboard handling**: `useKeyboardOpen()` hook uses `visualViewport` API + active element check to hide nav bar when keyboard opens on mobile.
- **Viewport**: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-visual` (no viewport-fit=cover to respect safe areas)
