# LrmTV — Social Streaming Platform

## Overview

LrmTV is a real-time collaborative video watching platform (like Watch2Gether, SyncTube). Users can create rooms, watch videos in perfect sync, chat, and interact — all with a bilingual Arabic/English interface.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS
- **Video**: SmartPlayer (react-player v2 handles all sources: YouTube/Vimeo/Twitch embeds, HLS/M3U8, DASH/MPD, MP4/WebM)
- **Real-time**: Socket.io (video sync, chat, user presence)
- **State**: Zustand (client-side)
- **i18n**: Custom React context (Arabic RTL / English LTR)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API + Socket.io server
│   │   └── src/
│   │       ├── lib/socket.ts    # Socket.io event handlers
│   │       └── routes/rooms.ts  # Room CRUD endpoints
│   └── web/                # React + Vite frontend (LrmTV UI)
│       └── src/
│           ├── pages/landing.tsx  # Landing page
│           ├── pages/room.tsx     # Room page with video player
│           ├── pages/room/        # Chat, playlist, users panels
│           ├── lib/i18n.tsx       # Bilingual i18n context
│           ├── components/player/  # SmartPlayer (HLS, DASH, HTML5, embed switcher)
│           ├── lib/detect-video-type.ts # URL → player type detector
│           └── hooks/use-socket.ts # Socket.io client hook
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── rooms.ts
│           ├── playlist-items.ts
│           └── chat-messages.ts
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── tsconfig.json
```

## Database Schema

- **rooms**: id, slug, name, type (public/private), background, admin_socket_id, created_at
- **playlist_items**: id, room_id, url, source_type, title, position, added_by
- **chat_messages**: id, room_id, username, content, type (message/system/emoji), created_at

## Key Features

- Room system with unique URLs
- Video sync (play/pause/seek) via Socket.io with <300ms drift tolerance
- Multi-source video support (YouTube, Vimeo, Twitch, MP4, M3U8)
- Live chat with emoji picker and system notifications
- Admin controls (lock player, grant DJ permissions)
- Playlist management (add/remove/reorder)
- WebRTC peer-to-peer video/audio calls (RTCPeerConnection, ICE, offer/answer signaling via Socket.io)
- Bilingual UI (Arabic RTL / English LTR) with language toggle
- Dark theme with glassmorphism UI
- Customizable room lounge backgrounds

## Socket.io Events

- `join-room`, `video-sync`, `chat-message`, `playlist-update`
- `toggle-lock`, `grant-dj`, `change-background`
- `webrtc-signal`, `toggle-media`
- `user-joined`, `user-left`, `users-updated`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server + Socket.io. Routes in `src/routes/`, socket handler in `src/lib/socket.ts`.

### `artifacts/web` (`@workspace/web`)

React + Vite frontend. Landing page at `/`, room page at `/room/:slug`.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Tables: rooms, playlist_items, chat_messages.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

## Email Configuration (Resend)

Email is used for account verification codes and password reset. The email service is in `artifacts/api-server/src/lib/email.ts`.

**Required env vars:**
| Variable | Description |
|---|---|
| `RESEND_API_KEY` | API key from resend.com (free tier: 3000 emails/month) |
| `FROM_EMAIL` | Sender address, e.g. `LrmTV <noreply@yourdomain.com>` (optional, has default) |

**Note:** Resend is connected via Replit integration (connector: `resend`). Falls back to `RESEND_API_KEY` env var if connector not available. Without either, codes are printed to server logs only.

## Video Link Extractor — Proxy & Anti-Bot Config

The extractor (`/api/extract`) uses Playwright + stealth to scrape direct video URLs.
To bypass IP bans (e.g. Webshare / ScrapingBee residential proxy), set these env vars:

| Variable         | Example                              | Description                     |
|------------------|--------------------------------------|---------------------------------|
| `PROXY_SERVER`   | `http://proxy.webshare.io:80`        | Full proxy URL (overrides HOST) |
| `PROXY_HOST`     | `proxy.webshare.io`                  | Used if PROXY_SERVER not set    |
| `PROXY_PORT`     | `80`                                 | Port (default 80)               |
| `PROXY_USERNAME` | `user123`                            | Proxy auth username             |
| `PROXY_PASSWORD` | `pass456`                            | Proxy auth password             |

**Anti-bot features active by default (no env vars needed):**
- `slowMo: 100` — every browser action runs 100ms slower to avoid speed detection
- Rotating User-Agent from a pool of 8 realistic Chrome/Firefox/Safari UAs
- Extra headers: `Accept-Language`, `Sec-Ch-Ua-Platform: "Windows"`, `DNT: 1`
- `locale: en-US`, `timezoneId: America/New_York` to mimic US browser
- `playwright-extra` + stealth plugin (disables `navigator.webdriver`, canvas fingerprint, etc.)
- `simulateHuman()` — 8 random mouse moves + scroll on Cloudflare challenge pages
