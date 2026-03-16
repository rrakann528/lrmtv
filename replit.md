# LrmTV — Social Streaming Platform

## المشروع / Overview

LrmTV منصة مشاهدة جماعية للفيديو بالوقت الفعلي (مثل Watch2Gether). يتشارك المستخدمون غرف لمشاهدة البث المباشر والمحتوى مع مزامنة تلقائية ودردشة ولوحة تحكم. الواجهة ثنائية اللغة عربي/إنجليزي.

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

**طريقة الرفع:** سكريبت Node.js يستخدم Replit GitHub Connector (لا يحتاج GITHUB_TOKEN):
```bash
node scripts/push-to-github.mjs "رسالة التعديل"
```

السكريبت يرفع تلقائياً كل الملفات المعدّلة مقارنةً بـ `origin/main` عبر GitHub API.

---

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 / **TypeScript**: 5.9 / **Package manager**: pnpm
- **API**: Express 5 + Socket.io
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4) + drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS
- **Video**: SmartPlayer — HLS.js, dash.js, react-player (YouTube/Twitch/Vimeo), HTML5
- **Real-time**: Socket.io (sync, chat, relay)
- **State**: Zustand
- **i18n**: Custom React context (Arabic RTL / English LTR)

---

## Structure

```
artifacts-monorepo/
├── artifacts/
│   ├── api-server/
│   │   └── src/
│   │       ├── lib/socket.ts          ← Socket.io events (relay, sync, chat)
│   │       ├── routes/admin.ts        ← 26 admin API endpoints
│   │       └── routes/rooms.ts        ← Room CRUD
│   └── web/
│       └── src/
│           ├── pages/room.tsx         ← Room page + hooks
│           ├── components/player/
│           │   ├── hls-player.tsx     ← HLS fallback chain + HLS_CONFIG
│           │   ├── smart-player.tsx   ← Player switcher
│           │   └── player-controls.tsx
│           ├── hooks/
│           │   ├── use-relay-host.ts  ← Host-side Socket.IO relay (KEEP)
│           │   └── use-socket.ts
│           └── lib/
│               └── relay-loader.ts   ← HLS.js custom loader → goes direct to relay
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

## HLS Fallback Chain (بدون P2P — تم إزالته)

```
S1 HLS.js direct
  → S2 Native HTML5 <video>
    → S3 CF manifest proxy (Cloudflare Worker → manifest فقط)
      → S4 CF full proxy (كل شيء عبر CF Worker)
        → S5 API proxy (/api/proxy/manifest + /api/proxy/segment)
          → S-Relay (Socket.IO relay عبر متصفح DJ)
            → Error (ip-locked بعد 45 ثانية timeout)
```

**CF Worker URL**: `https://lrmtv-proxy.rrakann528.workers.dev`
(يُضبط عبر `VITE_CF_PROXY_URL` في .env)

---

## relay-loader.ts — كيف يعمل

- عند استدعاء `load()`: يتحقق من `socket.connected`
- لو متصل: يرسل `relay:fetch` للسيرفر → السيرفر يوجهه لـ DJ → DJ يجيب الـ segment → يرجع للمشاهد
- لو مو متصل: يستدعي `super.load()` مباشرة
- ArrayBuffer يُحوّل لـ string بـ TextDecoder للـ manifests

---

## socket.ts — Relay System

```
RoomState.pendingRelays: Map<requestId, requesterSocketId>
```
- `relay:fetch` → يأخذ host socket ID من roomState.users → يرسل الطلب له
- `relay:response` / `relay:error` → يحوّل الجواب للمشاهد الصح عبر pendingRelays

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

---

## Database Schema (الجداول الرئيسية)

- **rooms**: id, slug, name, type (public/private), background, dj_socket_id
- **users**: id, email, username, role (admin/user), google_id, password_hash
- **playlist_items**: id, room_id, url, source_type, title, position, added_by
- **chat_messages**: id, room_id, username, content, type, created_at
- **room_members**: room_id, user_id, role (dj/viewer)

---

## Socket.io Events الرئيسية

| Event | وصف |
|---|---|
| `join-room` | دخول غرفة |
| `video-sync` | مزامنة الفيديو (play/pause/seek/time) |
| `chat-message` | رسالة دردشة |
| `playlist-update` | تحديث قائمة التشغيل |
| `relay:fetch` | طلب segment عبر الريلاي |
| `relay:response` | جواب الريلاي |
| `relay:error` | خطأ الريلاي |
| `dj-backgrounding` | DJ أخفى الـ PWA |
| `subtitle-sync` | مزامنة الترجمة |
| `toggle-lock` | قفل/فتح التحكم |
| `grant-dj` | منح صلاحية DJ |

---

## HLS_CONFIG المحسّن (hls-player.tsx)

```javascript
{
  enableWorker: true,
  lowLatencyMode: false,
  startFragPrefetch: true,
  liveSyncDurationCount: 3,       // 3 segments behind live
  liveMaxLatencyDurationCount: 8,
  maxLiveSyncPlaybackRate: 1.1,
  backBufferLength: 60,           // buffer كبير
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  manifestLoadingMaxRetry: 3,
  manifestLoadingTimeOut: 10_000,
  levelLoadingMaxRetry: 4,
  levelLoadingTimeOut: 15_000,
  fragLoadingMaxRetry: 6,
  fragLoadingTimeOut: 20_000,     // مهم للـ relay
  fragLoadingRetryDelay: 500,
  startLevel: 0,               // start at lowest quality for faster initial load
  abrEwmaDefaultEstimate: 1_000_000,  // 1 Mbps default (conservative, upgrades fast)
  abrBandWidthFactor: 0.8,
  abrBandWidthUpFactor: 0.5,
  testBandwidth: false,
  progressive: true,
  nudgeMaxRetry: 10,
  nudgeOffset: 0.1,
}
```

---

## Root Scripts

- `pnpm run build` — typecheck ثم build لكل الـ packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly`

---

## Email (Resend)

`artifacts/api-server/src/lib/email.ts`
- `RESEND_API_KEY` env var أو Replit connector
- `FROM_EMAIL` اختياري

---

## Video Link Extractor

`/api/extract` — Playwright + stealth لاستخراج روابط الفيديو المباشرة
- env vars اختيارية: `PROXY_SERVER`, `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`

---

## ملاحظات مهمة

1. **P2P تم إزاله بالكامل** — لا `use-p2p-host.ts` ولا `use-p2p-viewer.ts` ولا `p2p-loader.ts`
2. **الريلاي يعمل عبر Socket.IO فقط** — عبر `use-relay-host.ts` و `relay-loader.ts`
3. **timeout الـ error**: 45 ثانية loading → يظهر خطأ `ip-locked`
4. **الـ stall watchdog** يفحص كل 1 ثانية ويتدخل بعد 2 ثانية توقف
5. **CF Worker** يحل CORS فقط — لا يحل IP blocking الحقيقي
6. **TypeScript composite projects** — دائماً `typecheck` من الـ root
