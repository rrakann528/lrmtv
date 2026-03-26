import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { db, chatMessagesTable, roomsTable, playlistItemsTable, roomInvitesTable, usersTable, siteSettingsTable } from "@workspace/db";
import { eq, and, notInArray, inArray } from "drizzle-orm";

// ── In-memory settings cache (shared across the process) ─────────────────────
let _settingsMap = new Map<string, string>();

export async function refreshSettingsCache(): Promise<void> {
  try {
    const rows = await db.select().from(siteSettingsTable);
    _settingsMap = new Map(rows.map(s => [s.key, s.value]));
  } catch { /* DB not ready yet */ }
}

export function getCachedSetting(key: string, fallback = ""): string {
  return _settingsMap.get(key) ?? fallback;
}

refreshSettingsCache();
setInterval(refreshSettingsCache, 60_000);

interface RoomUser {
  socketId: string;
  userId?: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  isDJ: boolean;
  isMuted: boolean;
  /** True when a site-admin has globally muted this user — blocks chat */
  isSiteMuted: boolean;
}

interface SubtitleSync {
  type: 'url' | 'content' | 'clear';
  url?: string;
  content?: string;
  label?: string;
  from: string;
}

interface RoomState {
  slug: string;
  roomId: number;
  roomName: string;
  users: Map<string, RoomUser>;
  bannedUserIds: Set<number>;
  bannedUsernames: Set<string>;
  currentVideo: string | null;
  isPlaying: boolean;
  currentTime: number;
  isLocked: boolean;
  allowGuestControl: boolean;
  background: string;
  lastSyncTimestamp: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  deleteTimer?: ReturnType<typeof setTimeout>;
  isPrivate: boolean;
  chatDisabled: boolean;
  micDisabled: boolean;
  sponsorSkipEnabled: boolean;
  /** True when the current video is a live stream (no time-based sync for guests) */
  isLive: boolean;
  /** Current subtitle state broadcast to late joiners */
  subtitle: SubtitleSync | null;
  /** When false, unregistered guests (no userId) are blocked from joining */
  allowGuestEntry: boolean;
  /** Permanent admin — the user who created/first-joined the room. Restored on rejoin. */
  creatorUserId?: number;
  /** Track last pause so we can detect accidental browser-close pauses */
  lastPauseBy?: string;
  lastPauseAt?: number;
  /** DJ signalled they are backgrounding/closing — ignore their next pause */
  djBackgrounding?: { socketId: string; at: number };
  /** Cached frozen state — avoids a DB round-trip on every join */
  isFrozen: boolean;
}

const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function deleteRoomFromDb(slug: string) {
  try {
    const [room] = await db.select({ id: roomsTable.id }).from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) return;
    await db.delete(playlistItemsTable).where(eq(playlistItemsTable.roomId, room.id));
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.roomId, room.id));
    // Expire all pending invites for this room
    await db
      .update(roomInvitesTable)
      .set({ status: "expired" })
      .where(eq(roomInvitesTable.roomSlug, slug));
    await db.delete(roomsTable).where(eq(roomsTable.id, room.id));
    console.log(`[Room] Auto-deleted empty room: ${slug}`);
  } catch (err) {
    console.error(`[Room] Failed to delete room ${slug}:`, err);
  }
}

async function cleanupOrphanedRooms() {
  try {
    const activeSlugs = Array.from(rooms.keys());
    const dbRooms = activeSlugs.length > 0
      ? await db.select({ id: roomsTable.id, slug: roomsTable.slug })
          .from(roomsTable)
          .where(notInArray(roomsTable.slug, activeSlugs))
      : await db.select({ id: roomsTable.id, slug: roomsTable.slug }).from(roomsTable);

    if (dbRooms.length === 0) return;
    const ids = dbRooms.map(r => r.id);
    await db.delete(playlistItemsTable).where(inArray(playlistItemsTable.roomId, ids));
    await db.delete(chatMessagesTable).where(inArray(chatMessagesTable.roomId, ids));
    await db.delete(roomsTable).where(inArray(roomsTable.id, ids));
    console.log(`[Room] Cleanup deleted ${dbRooms.length} orphaned room(s):`, dbRooms.map(r => r.slug).join(', '));
  } catch (err) {
    console.error('[Room] Cleanup failed:', err);
  }
}

function scheduleRoomDeletion(slug: string) {
  const roomState = rooms.get(slug);
  if (!roomState) return;
  if (roomState.deleteTimer) clearTimeout(roomState.deleteTimer);
  roomState.deleteTimer = setTimeout(async () => {
    const state = rooms.get(slug);
    if (!state || state.users.size > 0) return;
    rooms.delete(slug);
    await deleteRoomFromDb(slug);
  }, EMPTY_ROOM_TTL_MS);
}

function cancelRoomDeletion(roomState: RoomState) {
  if (roomState.deleteTimer) {
    clearTimeout(roomState.deleteTimer);
    roomState.deleteTimer = undefined;
  }
}

/** Apply word filter to chat content — replaces banned words with *** */
function applyWordFilter(content: string): string {
  try {
    const raw = getCachedSetting("word_filter", "[]");
    const words: string[] = JSON.parse(raw);
    if (!words.length) return content;
    let result = content;
    for (const w of words) {
      if (!w) continue;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "gi"), "***");
    }
    return result;
  } catch {
    return content;
  }
}

const rooms = new Map<string, RoomState>();

let _io: Server | null = null;
export function getIO(): Server | null { return _io; }
export function getRoomCount(slug: string): number {
  return rooms.get(slug)?.users.size ?? 0;
}
export function getActiveRooms(): { slug: string; userCount: number }[] {
  return Array.from(rooms.entries()).map(([slug, s]) => ({ slug, userCount: s.users.size }));
}

export function kickRoom(slug: string): void {
  if (!_io) return;
  _io.to(slug).emit('room-deleted');
  rooms.delete(slug);
}

export function getTotalActiveUsers(): number {
  let total = 0;
  for (const room of rooms.values()) total += room.users.size;
  return total;
}

export function getActiveRoomsDetailed(): { slug: string; userCount: number; isPlaying: boolean; url: string | null }[] {
  return Array.from(rooms.entries()).map(([slug, s]) => ({
    slug,
    userCount: s.users.size,
    isPlaying: s.isPlaying,
    url: s.currentVideo,
  }));
}

export function broadcastSystemMessage(message: string): void {
  if (!_io) return;
  const now = new Date().toISOString();
  for (const [slug, roomState] of rooms.entries()) {
    _io.to(slug).emit('chat-message', {
      id: Date.now(),
      roomId: roomState.roomId,
      content: message,
      username: 'النظام',
      type: 'system',
      createdAt: now,
    });
  }
}

export function sendRoomAnnouncement(slug: string, message: string): void {
  if (!_io) return;
  const roomState = rooms.get(slug);
  _io.to(slug).emit('chat-message', {
    id: Date.now(),
    roomId: roomState?.roomId,
    username: 'النظام',
    content: message,
    type: 'system',
    createdAt: new Date().toISOString(),
  });
}

export function kickUserFromAllRooms(userId: number): void {
  if (!_io) return;
  for (const [, state] of rooms) {
    for (const [socketId, user] of state.users) {
      if (user.userId === userId) {
        // Add to room ban list so they cannot rejoin
        state.bannedUserIds.add(userId);
        _io.to(socketId).emit('kicked');
      }
    }
  }
}

export function getUserActiveRooms(userId: number): string[] {
  const result: string[] = [];
  for (const [slug, state] of rooms) {
    for (const [, user] of state.users) {
      if (user.userId === userId) { result.push(slug); break; }
    }
  }
  return result;
}

export function forceRoomVideoState(slug: string, action: 'play' | 'pause'): void {
  if (!_io) return;
  const state = rooms.get(slug);
  if (!state) return;
  state.isPlaying = action === 'play';
  state.lastSyncTimestamp = Date.now();
  _io.to(slug).emit('video-sync', {
    action,
    currentTime: computedTime(state),
    url: state.currentVideo,
    isPlaying: state.isPlaying,
    isLive: state.isLive,
    from: 'server',
    serverTs: Date.now(),
  });
}

export function freezeRoom(slug: string, frozen: boolean): void {
  if (!_io) return;
  // Update in-memory cache so join-room guard reflects the new state immediately
  const roomState = rooms.get(slug);
  if (roomState) roomState.isFrozen = frozen;
  if (frozen) {
    // Kick everyone currently in the room
    _io.to(slug).emit('room-frozen');
  }
}

/** Update in-memory creatorUserId after admin transfer-owner action */
export function updateRoomCreator(slug: string, newCreatorUserId: number): void {
  const roomState = rooms.get(slug);
  if (!roomState) return;
  // Demote old creator sockets
  for (const user of roomState.users.values()) {
    if (user.userId === roomState.creatorUserId && user.userId !== newCreatorUserId) {
      user.isAdmin = false;
      user.isDJ = false;
    }
    if (user.userId === newCreatorUserId) {
      user.isAdmin = true;
      user.isDJ = true;
    }
  }
  roomState.creatorUserId = newCreatorUserId;
  if (_io) {
    _io.to(slug).emit('users-updated', { users: Array.from(roomState.users.values()) });
  }
}

/** Update site-mute status for a user across all active rooms */
export function siteMuteUser(userId: number, muted: boolean): void {
  if (!_io) return;
  for (const [, state] of rooms) {
    for (const [socketId, user] of state.users) {
      if (user.userId === userId) {
        user.isSiteMuted = muted;
        _io.to(socketId).emit('site-muted', { muted });
      }
    }
  }
}

function getRoomState(slug: string): RoomState | undefined {
  return rooms.get(slug);
}

function computedTime(state: RoomState): number {
  if (state.isPlaying && state.lastSyncTimestamp > 0) {
    return state.currentTime + (Date.now() - state.lastSyncTimestamp) / 1000;
  }
  return state.currentTime;
}

function createRoomState(slug: string, roomId: number, roomName: string): RoomState {
  const state: RoomState = {
    slug,
    roomId,
    roomName,
    users: new Map(),
    bannedUserIds: new Set<number>(),
    bannedUsernames: new Set<string>(),
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    isLocked: false,
    allowGuestControl: false,
    background: "default",
    lastSyncTimestamp: 0,
    isPrivate: false,
    chatDisabled: false,
    micDisabled: false,
    sponsorSkipEnabled: true,
    isLive: false,
    subtitle: null,
    allowGuestEntry: true,
    isFrozen: false,
  };
  rooms.set(slug, state);
  return state;
}

function canControl(user: RoomUser, roomState: RoomState): boolean {
  if (user.isAdmin || user.isDJ) return true;
  if (roomState.allowGuestControl) return true;
  return false;
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });
  _io = io;

  // Delete DB rooms that have no active users (orphaned since last restart)
  setTimeout(cleanupOrphanedRooms, 5000);
  // Periodic cleanup every 10 minutes for rooms that appear in DB but have no active users
  setInterval(cleanupOrphanedRooms, EMPTY_ROOM_TTL_MS);

  io.on("connection", (socket: Socket) => {
    let currentRoomSlug: string | null = null;

    socket.on("join-user-room", (data: { userId?: number }) => {
      if (!data?.userId) return;
      const token = (socket.handshake.auth as any)?.token || '';
      const secret = process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env';
      try {
        const decoded = jwt.verify(token, secret) as any;
        if (decoded?.userId === data.userId) {
          socket.join(`user:${data.userId}`);
        }
      } catch {}
    });

    // Late identification — sent when authUser loads after connect
    socket.on("identify", (data: { userId: number }) => {
      if (!data?.userId || !currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (user && !user.userId) {
        user.userId = data.userId;
        io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
      }
    });

    socket.on("join-room", async (data: { slug: string; username: string; displayName?: string; userId?: number }) => {
      const { slug, username, displayName: rawDisplayName, userId } = data;
      const displayName = rawDisplayName || username;

      let roomState = getRoomState(slug);
      if (!roomState) {
        const [room] = await db
          .select()
          .from(roomsTable)
          .where(eq(roomsTable.slug, slug));
        if (!room) {
          socket.emit("error", { message: "Room not found" });
          return;
        }
        roomState = createRoomState(slug, room.id, room.name);
        roomState.background = room.background || "default";
        roomState.isPrivate = room.type === "private";
        roomState.isFrozen = room.isFrozen || false;
        // Restore permanent admin from DB
        if (room.creatorUserId) roomState.creatorUserId = room.creatorUserId;
      }

      // Cancel pending auto-delete if someone is joining an empty room
      cancelRoomDeletion(roomState);

      // Block if room is frozen — use cached state (updated by admin actions)
      if (roomState.isFrozen) {
        socket.emit("room-frozen");
        return;
      }

      // Block banned users
      if (userId && roomState.bannedUserIds.has(userId)) {
        socket.emit("kicked");
        return;
      }
      if (!userId && roomState.bannedUsernames.has(username.toLowerCase())) {
        socket.emit("kicked");
        return;
      }

      // Block unregistered guests if the room has guest entry disabled
      if (!userId && !roomState.allowGuestEntry) {
        socket.emit("guests-not-allowed");
        return;
      }

      // ── Enforce max room members ──────────────────────────────────────────
      const maxMembers = parseInt(getCachedSetting("max_room_members", "100"), 10);
      if (roomState.users.size >= maxMembers) {
        socket.emit("room-full", { max: maxMembers });
        return;
      }

      // A user is the admin if they are the stored creator, OR if the room has no creator yet
      const isCreator = userId != null && userId === roomState.creatorUserId;
      const isFirstJoiner = roomState.users.size === 0 && !roomState.creatorUserId;
      const isAdmin = isCreator || isFirstJoiner;

      // ── Check if user is site-muted ──────────────────────────────────────
      let isSiteMuted = false;
      if (userId) {
        try {
          const [dbUser] = await db.select({ isMuted: usersTable.isMuted })
            .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
          isSiteMuted = dbUser?.isMuted ?? false;
        } catch {}
      }

      const user: RoomUser = {
        socketId: socket.id,
        userId,
        username,
        displayName,
        isAdmin,
        isDJ: isAdmin,
        isMuted: true,
        isSiteMuted,
      };

      roomState.users.set(socket.id, user);
      currentRoomSlug = slug;
      socket.join(slug);

      if (user.isAdmin) {
        if (!roomState.creatorUserId && userId) {
          // First time: persist creator
          roomState.creatorUserId = userId;
          db.update(roomsTable)
            .set({ adminSocketId: socket.id, creatorUserId: userId })
            .where(eq(roomsTable.slug, slug))
            .then(() => {});
        } else {
          db.update(roomsTable)
            .set({ adminSocketId: socket.id })
            .where(eq(roomsTable.slug, slug))
            .then(() => {});
        }
      }

      socket.emit("room-state", {
        currentVideo: roomState.currentVideo,
        isPlaying: roomState.isPlaying,
        currentTime: computedTime(roomState),
        isLocked: roomState.isLocked,
        allowGuestControl: roomState.allowGuestControl,
        allowGuestEntry: roomState.allowGuestEntry,
        background: roomState.background,
        roomName: roomState.roomName,
        users: Array.from(roomState.users.values()),
        you: user,
        isPrivate: roomState.isPrivate,
        chatDisabled: roomState.chatDisabled,
        micDisabled: roomState.micDisabled,
        sponsorSkipEnabled: roomState.sponsorSkipEnabled,
        isLive: roomState.isLive,
        subtitle: roomState.subtitle,
        serverTs: Date.now(),
      });

      const systemMsg = {
        username: "system",
        content: `${username} joined the room / ${username} انضم للغرفة`,
        type: "system" as const,
        roomId: roomState.roomId,
      };

      // Fire-and-forget — don't block the socket response on a DB write
      db.insert(chatMessagesTable).values(systemMsg).catch(() => {});

      io.to(slug).emit("user-joined", {
        user,
        users: Array.from(roomState.users.values()),
        systemMessage: systemMsg,
      });

      // ── Send welcome message to the joining user ─────────────────────────
      const welcomeMsg = getCachedSetting("welcome_message", "").trim();
      if (welcomeMsg && userId) {
        socket.emit("chat-message", {
          id: `welcome-${Date.now()}`,
          username: "🔔 النظام",
          content: welcomeMsg,
          type: "system",
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }
    });

    // ── Video sync (play / pause / seek / change-video) ─────────────────────
    socket.on("video-sync", (data: { action: string; currentTime: number; url?: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user) return;

      if (!canControl(user, roomState)) {
        socket.emit("sync-rejected", { reason: "not_allowed" });
        return;
      }

      switch (data.action) {
        case "play":
          roomState.isPlaying = true;
          roomState.currentTime = data.currentTime;
          roomState.lastSyncTimestamp = Date.now();
          startHeartbeat(io, roomState);
          break;
        case "pause": {
          // If this DJ signalled they are closing/backgrounding, keep room playing
          const bg = roomState.djBackgrounding;
          if (bg && bg.socketId === socket.id && Date.now() - bg.at < 15_000) {
            // Swallow the browser-auto-pause — do NOT propagate it
            return;
          }
          // Use max(client-reported, server-computed) to guard against browsers
          // sending currentTime=0 when the page is closing mid-stream.
          const safeTime = Math.max(data.currentTime, computedTime(roomState));
          roomState.isPlaying = false;
          roomState.currentTime = safeTime;
          roomState.lastSyncTimestamp = 0;
          roomState.lastPauseBy = socket.id;
          roomState.lastPauseAt = Date.now();
          stopHeartbeat(roomState);
          break;
        }
        case "seek":
          // For live streams: ignore seek to 0 or very small values — this usually
          // means the player failed to seek and fell back to the start.
          if (roomState.isLive && data.currentTime < 1) return;
          roomState.currentTime = data.currentTime;
          roomState.lastSyncTimestamp = Date.now();
          // Restart heartbeat after seek so drift-correction fires from the new position
          if (roomState.isPlaying) startHeartbeat(io, roomState);
          break;
        case "change-video":
          roomState.currentVideo = data.url || null;
          roomState.currentTime = 0;
          roomState.isPlaying = false;
          roomState.isLive = false; // reset — player will re-detect after manifest load
          roomState.lastSyncTimestamp = 0;
          stopHeartbeat(roomState);
          break;
      }

      io.to(currentRoomSlug).emit("video-sync", {
        action: data.action,
        currentTime: roomState.currentTime,
        url: roomState.currentVideo,
        isPlaying: roomState.isPlaying,
        isLive: roomState.isLive,
        from: user.username,
        serverTs: Date.now(),
      });
    });

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on("chat-message", async (data: { content: string; type?: string; replyTo?: { id: number; username: string; content: string } }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user) return;

      if (roomState.chatDisabled && !user.isAdmin) return;
      if (!user.userId) return;
      if (user.isSiteMuted && !user.isAdmin) {
        socket.emit("chat-blocked", { reason: "muted" });
        return;
      }

      const filteredContent = applyWordFilter(String(data.content || "").trim());
      if (!filteredContent) return;

      const msg: Record<string, any> = {
        username: user.username,
        content: filteredContent,
        type: (data.type || "message") as string,
        roomId: roomState.roomId,
      };

      if (data.replyTo) {
        msg.replyToId = data.replyTo.id;
        msg.replyToUsername = data.replyTo.username;
        msg.replyToContent = String(data.replyTo.content || "").slice(0, 200);
      }

      const [saved] = await db.insert(chatMessagesTable).values(msg).returning();

      io.to(currentRoomSlug).emit("chat-message", {
        id: saved.id,
        ...msg,
        createdAt: saved.createdAt,
      });
    });

    socket.on("delete-message", async (data: { messageId: number }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (!user || !user.userId) return;

      const [msg] = await db.select().from(chatMessagesTable)
        .where(and(eq(chatMessagesTable.id, data.messageId), eq(chatMessagesTable.roomId, roomState.roomId)))
        .limit(1);
      if (!msg) return;
      if (msg.username !== user.username && !user.isAdmin) return;

      await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, data.messageId));
      io.to(currentRoomSlug).emit("message-deleted", { messageId: data.messageId });
    });

    // ── Private message (friend-to-friend in the same room) ──────────────────
    // Client emits: { targetSocketId, content }
    // Server forwards only to the target socket — no room broadcast, no DB save.
    socket.on("private-message", (data: { targetSocketId: string; content: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const sender = roomState.users.get(socket.id);
      if (!sender) return;
      const target = roomState.users.get(data.targetSocketId);
      if (!target) return; // target left the room
      const content = String(data.content || '').trim().slice(0, 1000);
      if (!content) return;
      io.to(data.targetSocketId).emit("private-message", {
        from: sender.username,
        fromId: sender.userId,
        content,
      });
    });

    // ── Playlist ──────────────────────────────────────────────────────────────
    socket.on("playlist-update", (data: { action: string; item?: unknown; items?: unknown[] }) => {
      if (!currentRoomSlug) return;
      io.to(currentRoomSlug).emit("playlist-update", data);
    });

    // ── Lock (legacy alias for !allowGuestControl) ────────────────────────────
    socket.on("toggle-lock", async () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      roomState.isLocked = !roomState.isLocked;
      roomState.allowGuestControl = !roomState.isLocked;

      const msg = roomState.allowGuestControl
        ? "All users can now control playback / يمكن للجميع التحكم الآن"
        : "Host-only control / التحكم للمضيف فقط";
      const sysMsg = { username: "system", content: msg, type: "system" as const, roomId: roomState.roomId };
      const [saved] = await db.insert(chatMessagesTable).values(sysMsg).returning();
      io.to(currentRoomSlug).emit("chat-message", { id: saved.id, ...sysMsg, createdAt: saved.createdAt });
      io.to(currentRoomSlug).emit("lock-changed", { isLocked: roomState.isLocked, allowGuestControl: roomState.allowGuestControl });
    });

    // ── Allow guest control toggle ─────────────────────────────────────────
    socket.on("toggle-allow-guests", async () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      roomState.allowGuestControl = !roomState.allowGuestControl;
      roomState.isLocked = !roomState.allowGuestControl;

      const msg = roomState.allowGuestControl
        ? "All users can now control playback / يمكن للجميع التحكم الآن"
        : "Host-only control / التحكم للمضيف فقط";
      const sysMsg = { username: "system", content: msg, type: "system" as const, roomId: roomState.roomId };
      const [saved] = await db.insert(chatMessagesTable).values(sysMsg).returning();
      io.to(currentRoomSlug).emit("chat-message", { id: saved.id, ...sysMsg, createdAt: saved.createdAt });
      io.to(currentRoomSlug).emit("allow-guests-changed", { allowGuestControl: roomState.allowGuestControl });
    });

    // ── Toggle guest entry ────────────────────────────────────────────────────
    socket.on("toggle-guest-entry", async () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      roomState.allowGuestEntry = !roomState.allowGuestEntry;

      const msg = roomState.allowGuestEntry
        ? "Guests can now join / يمكن للزوار الدخول الآن"
        : "Guests are now blocked / الزوار ممنوعون من الدخول";
      const sysMsg = { username: "system", content: msg, type: "system" as const, roomId: roomState.roomId };
      const [saved] = await db.insert(chatMessagesTable).values(sysMsg).returning();
      io.to(currentRoomSlug).emit("chat-message", { id: saved.id, ...sysMsg, createdAt: saved.createdAt });
      io.to(currentRoomSlug).emit("guest-entry-changed", { allowGuestEntry: roomState.allowGuestEntry });
    });

    // ── Grant DJ ─────────────────────────────────────────────────────────────
    socket.on("grant-dj", async (data: { targetSocketId: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      const target = roomState.users.get(data.targetSocketId);
      if (target) {
        target.isDJ = !target.isDJ;

        const djMsg = target.isDJ
          ? `${target.username} is now a DJ / ${target.username} أصبح الآن DJ`
          : `${target.username} is no longer a DJ / ${target.username} فقد صلاحية DJ`;
        const djSystemMsg = { username: "system", content: djMsg, type: "system" as const, roomId: roomState.roomId };
        const [savedDJ] = await db.insert(chatMessagesTable).values(djSystemMsg).returning();
        io.to(currentRoomSlug).emit("chat-message", { id: savedDJ.id, ...djSystemMsg, createdAt: savedDJ.createdAt });
        io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
      }
    });

    // ── Room settings toggles ─────────────────────────────────────────────────
    const emitRoomSettings = (slug: string, roomState: RoomState) => {
      io.to(slug).emit("room-settings-updated", {
        isPrivate: roomState.isPrivate,
        chatDisabled: roomState.chatDisabled,
        micDisabled: roomState.micDisabled,
        sponsorSkipEnabled: roomState.sponsorSkipEnabled,
      });
    };

    socket.on("toggle-privacy", async () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      if (!roomState.users.get(socket.id)?.isAdmin) return;
      roomState.isPrivate = !roomState.isPrivate;
      await db.update(roomsTable).set({ type: roomState.isPrivate ? "private" : "public" }).where(eq(roomsTable.slug, currentRoomSlug));
      emitRoomSettings(currentRoomSlug, roomState);
    });

    socket.on("toggle-chat", () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      if (!roomState.users.get(socket.id)?.isAdmin) return;
      roomState.chatDisabled = !roomState.chatDisabled;
      emitRoomSettings(currentRoomSlug, roomState);
    });

    socket.on("toggle-mic", () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      if (!roomState.users.get(socket.id)?.isAdmin) return;
      roomState.micDisabled = !roomState.micDisabled;
      if (roomState.micDisabled) {
        for (const u of roomState.users.values()) u.isMuted = true;
        io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
      }
      emitRoomSettings(currentRoomSlug, roomState);
    });

    socket.on("toggle-sponsor-skip", () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      if (!roomState.users.get(socket.id)?.isAdmin) return;
      roomState.sponsorSkipEnabled = !roomState.sponsorSkipEnabled;
      emitRoomSettings(currentRoomSlug, roomState);
    });

    // ── Kick user ─────────────────────────────────────────────────────────────
    socket.on("kick-user", async (data: { targetSocketId: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;
      const target = roomState.users.get(data.targetSocketId);
      if (!target || target.isAdmin) return;

      io.to(data.targetSocketId).emit("kicked");

      // Add to ban list so they cannot rejoin
      if (target.userId) {
        roomState.bannedUserIds.add(target.userId);
      } else {
        roomState.bannedUsernames.add(target.username.toLowerCase());
      }

      roomState.users.delete(data.targetSocketId);
      const kickMsg = { username: "system", content: `${target.username} was kicked / ${target.username} تم طرده`, type: "system" as const, roomId: roomState.roomId };
      try { await db.insert(chatMessagesTable).values(kickMsg); } catch {}
      io.to(currentRoomSlug).emit("user-left", { socketId: data.targetSocketId, username: target.username, users: Array.from(roomState.users.values()), systemMessage: kickMsg });
    });

    // ── Transfer admin ────────────────────────────────────────────────────────
    socket.on("transfer-admin", async (data: { targetSocketId: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;
      const target = roomState.users.get(data.targetSocketId);
      if (!target) return;

      user.isAdmin = false;
      user.isDJ = false;
      target.isAdmin = true;
      target.isDJ = true;

      await db.update(roomsTable).set({ adminSocketId: target.socketId }).where(eq(roomsTable.id, roomState.roomId));
      const msg = { username: "system", content: `${target.username} is now the host / ${target.username} أصبح المضيف`, type: "system" as const, roomId: roomState.roomId };
      const [saved] = await db.insert(chatMessagesTable).values(msg).returning();
      io.to(currentRoomSlug).emit("chat-message", { id: saved.id, ...msg, createdAt: saved.createdAt });
      io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
    });

    // ── Change background ─────────────────────────────────────────────────────
    socket.on("change-background", async (data: { background: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      roomState.background = data.background;
      await db.update(roomsTable).set({ background: data.background }).where(eq(roomsTable.slug, currentRoomSlug));
      io.to(currentRoomSlug).emit("background-changed", { background: data.background });
    });

    // ── Rename room ───────────────────────────────────────────────────────────
    socket.on("rename-room", async (data: { name: string }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin) return;

      const newName = (data.name || "").trim().slice(0, 60);
      if (!newName) return;

      roomState.roomName = newName;
      await db.update(roomsTable).set({ name: newName }).where(eq(roomsTable.slug, currentRoomSlug));
      io.to(currentRoomSlug).emit("room-renamed", { name: newName });
    });

    // ── Stream type (live vs VOD) — emitted by any player after manifest load ─
    // Lets late-joiners know to start at live edge instead of a specific time.
    socket.on("stream-type", (data: { isLive: boolean }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      roomState.isLive = data.isLive === true;
    });

    // ── WebRTC ────────────────────────────────────────────────────────────────
    socket.on("webrtc-signal", (data: { targetSocketId: string; signal: any; type: string; fresh?: boolean }) => {
      io.to(data.targetSocketId).emit("webrtc-signal", {
        fromSocketId: socket.id,
        signal: data.signal,
        type: data.type,
        fresh: data.fresh,
      });
    });

    // ── DJ backgrounding / closing — keep room playing ───────────────────────
    socket.on("dj-backgrounding", () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (!user?.isAdmin && !user?.isDJ) return;
      roomState.djBackgrounding = { socketId: socket.id, at: Date.now() };
    });

    // ── Media toggle ─────────────────────────────────────────────────────────
    socket.on("toggle-media", (data: { isMuted?: boolean }) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user) return;

      if (data.isMuted !== undefined) user.isMuted = data.isMuted;
      io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
    });

    // ── Request sync (guest asks host to re-broadcast current state) ─────────
    socket.on("request-sync", () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      socket.emit("video-sync", {
        action: roomState.isPlaying ? "play" : "pause",
        currentTime: computedTime(roomState),
        url: roomState.currentVideo,
        isPlaying: roomState.isPlaying,
        isLive: roomState.isLive,
        from: "server",
        serverTs: Date.now(),
      });
    });

    socket.on("subtitle-sync", (data: SubtitleSync) => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;
      const user = roomState.users.get(socket.id);
      if (!user) return;
      const payload: SubtitleSync = { ...data, from: user.username };
      // Store so late joiners get it; clear on 'clear' type
      roomState.subtitle = data.type === 'clear' ? null : payload;
      // Broadcast to everyone else in the room
      socket.to(currentRoomSlug).emit("subtitle-sync", payload);
    });

    // ── Disconnect / leave ────────────────────────────────────────────────────
    const handleLeaveRoom = async () => {
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      roomState.users.delete(socket.id);
      socket.leave(currentRoomSlug);

      if (user) {
        const systemMsg = {
          username: "system",
          content: `${user.username} left the room / ${user.username} غادر الغرفة`,
          type: "system" as const,
          roomId: roomState.roomId,
        };
        // Fire-and-forget — emit immediately without waiting for DB
        db.insert(chatMessagesTable).values(systemMsg).catch(() => {});
        io.to(currentRoomSlug).emit("user-left", {
          socketId: socket.id,
          username: user.username,
          users: Array.from(roomState.users.values()),
          systemMessage: systemMsg,
        });
      }

      if (roomState.users.size === 0) {
        stopHeartbeat(roomState);
        scheduleRoomDeletion(currentRoomSlug);
      } else if (user?.isAdmin && !roomState.creatorUserId) {
        // Only auto-promote when there's no permanent creator tracked
        const firstUser = roomState.users.values().next().value;
        if (firstUser) {
          firstUser.isAdmin = true;
          firstUser.isDJ = true;
          db.update(roomsTable).set({ adminSocketId: firstUser.socketId }).where(eq(roomsTable.id, roomState.roomId)).then(() => {});
          io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
        }
      } else if (user?.isAdmin && roomState.creatorUserId) {
        // Creator left — keep the room running but no active admin until they return
        io.to(currentRoomSlug).emit("users-updated", { users: Array.from(roomState.users.values()) });
      }

      // Keep the room playing when a DJ/admin disconnects.
      const wasDjBackgrounding = roomState.djBackgrounding?.socketId === socket.id;
      const isAdminOrDj = user?.isAdmin || user?.isDJ;

      // Give the browser 8 s to send its auto-pause before disconnect arrives.
      // Only admins/DJs can trigger a play-restore — prevents guests from
      // accidentally resetting the video when they leave.
      const AUTO_PAUSE_WINDOW = 8_000;
      const wasAutoPaused =
        !roomState.isPlaying &&
        roomState.lastPauseBy === socket.id &&
        roomState.lastPauseAt != null &&
        (Date.now() - roomState.lastPauseAt) < AUTO_PAUSE_WINDOW;

      const shouldRestorePlay =
        roomState.users.size > 0 &&
        roomState.currentVideo &&
        isAdminOrDj &&
        (wasDjBackgrounding || wasAutoPaused);

      if (shouldRestorePlay && !roomState.isPlaying) {
        roomState.isPlaying = true;
        roomState.lastSyncTimestamp = Date.now();
        roomState.djBackgrounding = undefined;
        startHeartbeat(io, roomState);
        io.to(currentRoomSlug).emit("video-sync", {
          action: "play",
          currentTime: computedTime(roomState),
          url: roomState.currentVideo,
          isPlaying: true,
          isLive: roomState.isLive,
          from: "server",
          serverTs: Date.now(),
        });
      }

      currentRoomSlug = '';
    };

    socket.on("leave-room", handleLeaveRoom);
    socket.on("disconnect", handleLeaveRoom);
  });

  return io;
}

// ── Heartbeat: re-broadcast currentTime every 5s while playing ──────────────
function startHeartbeat(io: Server, state: RoomState) {
  stopHeartbeat(state);
  state.heartbeatTimer = setInterval(() => {
    if (!state.isPlaying || state.users.size === 0) { stopHeartbeat(state); return; }
    io.to(state.slug).emit("heartbeat", {
      currentTime: computedTime(state),
      isPlaying: true,
      isLive: state.isLive,
      serverTs: Date.now(),
    });
  }, 1500);
}

function stopHeartbeat(state: RoomState) {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = undefined; }
}
