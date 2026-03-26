'use strict';
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.log('[migrate] No DATABASE_URL, skipping.'); process.exit(0); }

const pool = new Pool({ connectionString: url });

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT,
  provider VARCHAR(20) NOT NULL DEFAULT 'local',
  provider_id TEXT,
  display_name VARCHAR(40),
  bio VARCHAR(160),
  avatar_color VARCHAR(7) NOT NULL DEFAULT '#06B6D4',
  avatar_url TEXT,
  email VARCHAR(255) UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'public',
  background TEXT DEFAULT 'default',
  admin_socket_id TEXT,
  creator_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'message',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  source_type VARCHAR(20) NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_by TEXT
);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id)
);

DO $$ BEGIN
  CREATE TYPE invite_status AS ENUM ('pending','accepted','declined','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS room_invites (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_slug VARCHAR(255) NOT NULL,
  room_name VARCHAR(255) NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- muted_friends: correct schema uses (user_id, friend_id) composite PK
CREATE TABLE IF NOT EXISTS muted_friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id)
);

-- dm_read_receipts: correct schema uses (user_id, friend_id) composite PK
CREATE TABLE IF NOT EXISTS dm_read_receipts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);

-- ── Fix column name mismatches from old migration (idempotent) ──────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='muted_friends' AND column_name='muted_user_id') THEN
    ALTER TABLE muted_friends RENAME COLUMN muted_user_id TO friend_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dm_read_receipts' AND column_name='other_user_id') THEN
    ALTER TABLE dm_read_receipts RENAME COLUMN other_user_id TO friend_id;
  END IF;
END $$;

-- ── Admin columns (idempotent ALTER) ─────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_site_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Admin tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banned_ips (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  ip VARCHAR(45) NOT NULL DEFAULT '',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Missing user columns (idempotent) ────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT;

-- ── Reply columns for chat_messages / direct_messages (idempotent) ───────────
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_username TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;

ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to_sender_name TEXT;

-- ── Groups tables (idempotent) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(200),
  avatar_color VARCHAR(7) NOT NULL DEFAULT '#8B5CF6',
  avatar_url TEXT,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  allow_member_invite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL DEFAULT 'member',
  mute_notifs BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to_id INTEGER,
  reply_to_content TEXT,
  reply_to_sender_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_invitations (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Groups extra columns (idempotent, for tables created before these columns existed) ──
ALTER TABLE groups ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allow_member_invite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS mute_notifs BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_sender_name TEXT;

-- ── group_invitations unique constraint (idempotent) ────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_invitations_group_id_invitee_id_key'
  ) THEN
    ALTER TABLE group_invitations ADD CONSTRAINT group_invitations_group_id_invitee_id_key UNIQUE (group_id, invitee_id);
  END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_room ON playlist_items(room_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at);
`;

pool.query(SQL)
  .then(() => { console.log('[migrate] All tables created/verified.'); pool.end(); })
  .catch(err => { console.error('[migrate] Error:', err.message); pool.end(); process.exit(1); });
