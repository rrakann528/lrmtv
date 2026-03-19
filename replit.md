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
- **Video**: SmartPlayer — HLS.js, dash.js, react-player (YouTube/Twitch/Vimeo), HTML5
- **Real-time**: Socket.io (sync, chat, WebRTC)
- **State**: Zustand
- **i18n**: Custom React context — 6 لغات (ar, en, fr, tr, es, id) — مفتاح LS: `lrmtv_lang`

---

## Structure

```
artifacts-monorepo/
├── artifacts/
│   ├── api-server/
│   │   └── src/
│   │       ├── lib/socket.ts          ← Socket.io events (sync, chat, heartbeat 2s)
│   │       ├── routes/admin.ts        ← 26 admin API endpoints
│   │       ├── routes/rooms.ts        ← Room CRUD
│   │       ├── routes/hls-proxy.ts    ← manifest/segment/video proxy مع KEY/MAP rewrite
│   │       └── middlewares/security.ts ← rate limiter (proxy paths exempt)
│   └── web/
│       └── src/
│           ├── pages/room.tsx         ← Room page + sync logic
│           ├── components/player/
│           │   ├── hls-player.tsx     ← HLS 7-stage fallback + HLS_CONFIG
│           │   ├── smart-player.tsx   ← Player switcher (YouTube/HLS/HTML5)
│           │   └── player-controls.tsx
│           ├── hooks/
│           │   └── use-socket.ts      ← Socket state + heartbeat handler
│           └── lib/
│               └── i18n.tsx           ← 6 languages, 200+ keys
├── lib/
│   ├── api-spec/          ← OpenAPI spec + Orval codegen
│   ├── api-client-react/  ← Generated React Query hooks
│   ├── api-zod/           ← Generated Zod schemas
│   └── db/
│       └── src/schema/    ← rooms, users, playlist_items, chat_messages
├── lib/db/migrate.cjs     ← DB migration (runs on start)
└── scripts/
```

---

## HLS Fallback Chain (7 مراحل)

```
S1 HLS.js direct
  → S2 Native HTML5 <video>
    → S3 CF manifest proxy (CF Worker → manifest فقط)
      → S4 CF full proxy (كل شيء عبر CF Worker)
        → S5 CF full + segment rewrite
          → S6 API proxy + HLS.js (/api/proxy/manifest + /api/proxy/segment)
            → S7 API proxy + native (iOS Safari — manifest + segments كلها عبر السيرفر)
              → Error (فشل تحميل البث)
```

- **HTTP على HTTPS**: يتخطى مباشرة إلى S6 (mixed content)
- **iOS Safari بدون MSE**: يذهب مباشرة إلى S7
- **CF Worker URL**: `VITE_CF_PROXY_URL` (اختياري)

---

## API Proxy (hls-proxy.ts) — مهم جداً

`rewriteManifest()` تُعيد كتابة **جميع** الموارد في المانيفست عبر بروكسي السيرفر:
- **Segment lines** (غير تعليق) → `/api/proxy/segment?url=...`
- **`#EXT-X-KEY URI="..."`** → مفاتيح تشفير AES-128 عبر البروكسي
- **`#EXT-X-MAP URI="..."`** → fMP4 init segments عبر البروكسي
- **`#EXT-X-MEDIA URI="..."`** → renditions بديلة عبر البروكسي

بدون هذا، البث المشفر يُظهر شاشة سوداء مع المدة الصحيحة (المانيفست يتحمّل لكن المفتاح لا).

**Rate limiter**: مسارات `/proxy/*` و`/auth/me` مُعفاة من حد 300 req/15min.

---

## Sync & Playback (التزامن والتشغيل)

### Server (socket.ts)
- Heartbeat: كل **2 ثانية** (يبث `computedTime` + `serverTs`)
- `computedTime`: `currentTime + (Date.now() - lastSyncTimestamp) / 1000`

### Client (room.tsx)
| المصدر | حد الانحراف للتصحيح |
|--------|---------------------|
| action (play/pause/seek) | **1.0 ثانية** |
| heartbeat | **3 ثوانٍ** |
| أول 8 ثوانٍ بعد الانضمام | لا يصحح (grace period) |

- قفل seek بعد المزامنة: **600ms**
- تعويض التأخر: `syncState.time + latencyS`

### Autoplay
- **DJ**: يشتغل تلقائياً دائماً (لا يرى overlay أبداً)
- **المستخدم**: يرى "اضغط للتشغيل" **مرة واحدة فقط** عند دخول الغرفة — بعدها كل الفيديوهات تشتغل تلقائياً
- **حظر التشغيل التلقائي**: يُحاول تشغيل بصمت (muted) → يعرض زر "اضغط لرفع الصوت" (لا يحجب الفيديو)

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
- **chat_messages**: id, room_id, username, content, type, created_at
- **room_members**: room_id, user_id, role (dj/viewer)
- **site_settings**: `key` (PRIMARY KEY — لا يوجد عمود `id`)

---

## Socket.io Events الرئيسية

| Event | وصف |
|---|---|
| `join-room` | دخول غرفة |
| `video-sync` | مزامنة الفيديو (play/pause/seek/change-video) |
| `heartbeat` | نبض كل 2 ثانية (currentTime + serverTs) |
| `chat-message` | رسالة دردشة |
| `playlist-update` | تحديث قائمة التشغيل |
| `dj-backgrounding` | DJ أخفى الـ PWA (يمنع إرسال pause وهمي) |
| `subtitle-sync` | مزامنة الترجمة |
| `toggle-lock` | قفل/فتح التحكم |
| `grant-dj` | منح صلاحية DJ |
| `request-sync` | المستخدم يطلب إعادة المزامنة |

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

## ملاحظات مهمة

1. **P2P والـ Relay تم إزالتهم بالكامل** — المشغل يعتمد على سلسلة fallback مباشرة فقط
8. **DB Indexes**: `idx_chat_room_created` (chat_messages), `idx_rooms_creator` (rooms), `idx_dm_sender/receiver/pair` (direct_messages), `idx_friendships_addressee`
9. **N+1 fix**: `/friends/conversations` uses `DISTINCT ON` + single unread COUNT query instead of per-friend loops
2. **الـ stall watchdog** يفحص كل 1 ثانية ويتدخل بعد 2 ثانية توقف
3. **CF Worker** يحل CORS فقط — لا يحل IP blocking الحقيقي
4. **TypeScript composite projects** — دائماً `typecheck` من الـ root
5. **رسالة خطأ الفيديو**: "فشل تحميل البث" (لا تذكر IP أو شبكة) — تظهر فقط عند فشل حقيقي
6. **Adcash AutoTag zone**: `gk0vdquftk` في `index.html`
7. **siteSettingsTable**: يستخدم `key` كـ PRIMARY KEY (لا يوجد عمود `id`)
