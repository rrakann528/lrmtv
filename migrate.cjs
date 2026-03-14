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

CREATE TABLE IF NOT EXISTS dm_read_receipts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, other_user_id)
);

CREATE TABLE IF NOT EXISTS muted_friends (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, muted_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_room ON playlist_items(room_id);
`;

pool.query(SQL)
  .then(() => { console.log('[migrate] All tables created/verified.'); pool.end(); })
  .catch(err => { console.error('[migrate] Error:', err.message); pool.end(); process.exit(1); });
