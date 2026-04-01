import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { db, chatMessagesTable, roomsTable, playlistItemsTable, roomInvitesTable, usersTable, siteSettingsTable } from "@workspace/db";
import { eq, and, notInArray, inArray } from "drizzle-orm";
import { makeSocketThrottle } from "../middlewares/security";

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

// ── Default word-filter seed (runs once at startup) ──────────────────────────
const DEFAULT_WORD_FILTER = [
  // English
  "fuck","fucking","fucker","fucked","motherfucker",
  "shit","bullshit",
  "bitch","bitches",
  "asshole","ass",
  "bastard",
  "dick","cock","pussy","cunt",
  "nigger","nigga",
  "faggot","fag",
  "whore","slut",
  "retard","idiot","stupid",
  // Arabic
  "كس","كسمك","كسم",
  "زب","أير","اير",
  "طيز",
  "خرا","خره",
  "عرص","عرصة",
  "شرموط","شرموطة","شراميط",
  "نيك","ينيك","ينيكك",
  "قحبة","قحاب",
  "منيوك","مكنوك",
  "يلعن","العن",
];

async function seedDefaultWordFilter(): Promise<void> {
  try {
    const [row] = await db.select().from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, "word_filter")).limit(1);
    const existing: string[] = row ? JSON.parse(row.value || "[]") : [];
    if (existing.length === 0) {
      await db.insert(siteSettingsTable)
        .values({ key: "word_filter", value: JSON.stringify(DEFAULT_WORD_FILTER) })
        .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: JSON.stringify(DEFAULT_WORD_FILTER) } });
    }
  } catch { /* DB not ready yet — will be seeded on next server start */ }
}

async function bootInit(): Promise<void> {
  await refreshSettingsCache();
  await seedDefaultWordFilter();
  await refreshSettingsCache();
}

bootInit();
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
export function applyWordFilter(content: string): string {
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

// ── Active DM view tracking ───────────────────────────────────────────────────
// Each socket that opens a DM chat emits "dm:viewing { friendId, active }".
// We store which friendIds each socket is currently viewing so the push
// notification code can skip delivery when the recipient is already looking.
// Keyed by socketId so cleanup on disconnect is trivial.
interface DmViewEntry { userId: number; friendIds: Set<number>; }
const socketDmViews = new Map<string, DmViewEntry>();

/**
 * Returns true when the given user has AT LEAST ONE connected socket that
 * is currently viewing the DM conversation with `withFriendId` AND the
 * document is not hidden on that device.
 */
export function isUserViewingDm(userId: number, withFriendId: number): boolean {
  for (const entry of socketDmViews.values()) {
    if (entry.userId === userId && entry.friendIds.has(withFriendId)) return true;
  }
  return false;
}

// ── Grace-period leave tracking ───────────────────────────────────────────────
// When a socket disconnects we start a 30-second timer before broadcasting
// "user left". If the user reconnects within that window (e.g. PWA background)
// we silently restore them without showing any leave/rejoin messages.
const LEAVE_GRACE_MS = 8_000;

interface PendingLeave {
  timer: ReturnType<typeof setTimeout>;
  user: RoomUser;
  oldSocketId: string;
  roomSlug: string;
}
const pendingLeaves = new Map<string, PendingLeave>();

function pendingLeaveKey(roomSlug: string, userId?: number, username?: string): string {
  return userId != null ? `${roomSlug}:u:${userId}` : `${roomSlug}:g:${username ?? ''}`;
}

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

export function getActiveRoomsWithUsers(): Array<{
  slug: string;
  userCount: number;
  isPlaying: boolean;
  url: string | null;
  users: Array<{ username: string }>;
}> {
  return Array.from(rooms.entries()).map(([slug, s]) => ({
    slug,
    userCount: s.users.size,
    isPlaying: s.isPlaying,
    url: s.currentVideo,
    users: Array.from(s.users.values()).slice(0, 8).map(u => ({ username: u.username })),
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

// ── Per-socket event throttles ────────────────────────────────────────────────
const chatThrottle    = makeSocketThrottle(5,  3_000);   // 5 chat messages per 3 s
const syncThrottle    = makeSocketThrottle(20, 10_000);  // 20 video-sync events per 10 s
const joinThrottle    = makeSocketThrottle(5,  30_000);  // 5 join-room per 30 s per socket

// ── Per-IP concurrent connection limit ────────────────────────────────────────
const connectionsByIp = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 15;

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Reuse the same allowed-origins logic as Express CORS
        if (!origin) { cb(null, true); return; }
        const allowed = [
          // Production domains (hardcoded — work even without CORS_ORIGIN env var)
          "https://lrmtv.sbs",
          "https://www.lrmtv.sbs",
          process.env.CORS_ORIGIN,
          process.env.CORS_ORIGIN ? `https://www.${(process.env.CORS_ORIGIN || "").replace(/^https?:\/\//, "")}` : null,
          process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null,
          "http://localhost:5000",
          "http://localhost:22333",
          "http://localhost:5173",
        ].filter(Boolean) as string[];
        if (allowed.some(o => origin === o || origin.startsWith(o))) {
          cb(null, true);
        } else {
          cb(new Error("Socket CORS: origin not allowed"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socket.io",
    // Protect against large single-event payloads
    maxHttpBufferSize: 64 * 1024, // 64 KB per event
  });
  _io = io;

  // Delete DB rooms that have no active users (orphaned since last restart)
  setTimeout(cleanupOrphanedRooms, 5000);
  // Periodic cleanup every 10 minutes for rooms that appear in DB but have no active users
  setInterval(cleanupOrphanedRooms, EMPTY_ROOM_TTL_MS);

  io.on("connection", (socket: Socket) => {
    // ── Per-IP connection limit ──────────────────────────────────────────────
    const clientIp = socket.handshake.address || "unknown";
    const connCount = (connectionsByIp.get(clientIp) || 0) + 1;
    if (connCount > MAX_CONNECTIONS_PER_IP) {
      socket.emit("error", { message: "too_many_connections" });
      socket.disconnect(true);
      return;
    }
    connectionsByIp.set(clientIp, connCount);

    let currentRoomSlug: string | null = null;
    let socketUserId: number | null = null;

    socket.on("join-user-room", (data: { userId?: number }) => {
      if (!data?.userId) return;
      const token = (socket.handshake.auth as any)?.token || '';
      const secret = process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env';
      try {
        const decoded = jwt.verify(token, secret) as any;
        if (decoded?.userId === data.userId) {
          socket.join(`user:${data.userId}`);
          socketUserId = data.userId;
        }
      } catch {}
    });

    socket.on("dm:typing", (data: { toUserId: number; isTyping: boolean }) => {
      if (!socketUserId || !data?.toUserId) return;
      io.to(`user:${data.toUserId}`).emit("dm:typing", {
        fromUserId: socketUserId,
        isTyping: !!data.isTyping,
      });
    });

    // ── DM view tracking ──────────────────────────────────────────────────────
    // Client emits this when it opens/closes a DM chat window (and when the
    // document visibility changes). We use it to suppress push notifications
    // while the user is actively looking at the conversation.
    socket.on("dm:viewing", (data: { friendId: number; active: boolean }) => {
      if (!socketUserId || typeof data?.friendId !== "number") return;
      if (data.active) {
        let entry = socketDmViews.get(socket.id);
        if (!entry) {
          entry = { userId: socketUserId, friendIds: new Set() };
          socketDmViews.set(socket.id, entry);
        }
        entry.friendIds.add(data.friendId);
      } else {
        socketDmViews.get(socket.id)?.friendIds.delete(data.friendId);
      }
    });

    socket.on("join-group-typing", (data: { groupId: number }) => {
      if (!socketUserId || !data?.groupId) return;
      socket.join(`group-typing:${data.groupId}`);
    });

    socket.on("leave-group-typing", (data: { groupId: number }) => {
      if (!data?.groupId) return;
      socket.leave(`group-typing:${data.groupId}`);
    });

    socket.on("group:typing", (data: { groupId: number; isTyping: boolean; displayName?: string }) => {
      if (!socketUserId || !data?.groupId) return;
      socket.to(`group-typing:${data.groupId}`).emit("group:typing", {
        fromUserId: socketUserId,
        groupId: data.groupId,
        isTyping: !!data.isTyping,
        displayName: data.displayName || '',
      });
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
      if (!joinThrottle.allow(socket.id)) {
        socket.emit("error", { message: "too_many_join_attempts" });
        return;
      }
      const { slug, username, displayName: rawDisplayName } = data;
      const displayName = rawDisplayName || username;
      // If client didn't send userId, try to get it from the socket auth token
      let userId = data.userId;
      if (!userId) {
        try {
          const tok = (socket.handshake.auth as any)?.token || '';
          const secret = process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env';
          const decoded = jwt.verify(tok, secret) as any;
          if (decoded?.userId) userId = decoded.userId as number;
        } catch {}
      }

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

      // ── Silent reconnect: user returning within grace-period ─────────────
      const reconnectKey = pendingLeaveKey(slug, userId, username);
      const pending = pendingLeaves.get(reconnectKey);
      if (pending && pending.roomSlug === slug) {
        clearTimeout(pending.timer);
        pendingLeaves.delete(reconnectKey);

        // Remove the stale socketId entry and re-register with new socketId
        roomState.users.delete(pending.oldSocketId);
        const restoredUser: RoomUser = {
          ...pending.user,
          socketId: socket.id,
          userId: userId ?? pending.user.userId,
        };
        roomState.users.set(socket.id, restoredUser);
        currentRoomSlug = slug;
        socket.join(slug);

        if (restoredUser.isAdmin) {
          db.update(roomsTable)
            .set({ adminSocketId: socket.id })
            .where(eq(roomsTable.slug, slug))
            .then(() => {});
        }

        // Send full room state to the reconnected user only
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
          you: restoredUser,
          isPrivate: roomState.isPrivate,
          chatDisabled: roomState.chatDisabled,
          micDisabled: roomState.micDisabled,
          sponsorSkipEnabled: roomState.sponsorSkipEnabled,
          isLive: roomState.isLive,
          subtitle: roomState.subtitle,
          serverTs: Date.now(),
        });

        // Broadcast updated user list (no join/leave messages)
        io.to(slug).emit("users-updated", { users: Array.from(roomState.users.values()) });
        return;
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

      // Join/leave notifications are real-time only — not persisted to DB
      // to prevent accumulation from reconnections flooding the chat history.

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
      if (!syncThrottle.allow(socket.id)) return; // silently drop — too fast
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
          // Use the server's stored time instead of the client-reported time.
          // The stored time is set reliably during pause/seek actions and is not
          // affected by the DJ's local buffer state or network jitter.
          // Only accept the client time if it differs significantly (> 3s) from
          // the stored value — which means the DJ intentionally moved position
          // without emitting a seek first (edge case).
          if (Math.abs(data.currentTime - roomState.currentTime) > 3) {
            roomState.currentTime = data.currentTime;
          }
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
      if (!chatThrottle.allow(socket.id)) {
        socket.emit("chat-blocked", { reason: "rate_limited" });
        return;
      }
      if (!currentRoomSlug) return;
      const roomState = getRoomState(currentRoomSlug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user) return;

      if (roomState.chatDisabled && !user.isAdmin) return;
      if (!user.userId) {
        // Try to recover userId from the socket auth token
        try {
          const tok = (socket.handshake.auth as any)?.token || '';
          const secret = process.env.JWT_SECRET || 'lrmtv_jwt_fallback_secret_2025_please_set_in_env';
          const decoded = jwt.verify(tok, secret) as any;
          if (decoded?.userId) user.userId = decoded.userId as number;
        } catch {}
      }
      if (!user.userId) {
        socket.emit("chat-blocked", { reason: "not_identified" });
        return;
      }
      if (user.isSiteMuted && !user.isAdmin) {
        socket.emit("chat-blocked", { reason: "muted" });
        return;
      }

      const rawContent = String(data.content || "").trim();
      const filteredContent = roomState.isPrivate ? rawContent : applyWordFilter(rawContent);
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

      try {
        const [saved] = await db.insert(chatMessagesTable).values(msg).returning();
        io.to(currentRoomSlug).emit("chat-message", {
          id: saved.id,
          ...msg,
          createdAt: saved.createdAt,
        });
      } catch (err) {
        console.error("[chat] DB insert error:", err);
        socket.emit("chat-blocked", { reason: "error" });
      }
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
    const handleLeaveRoom = (immediate = false) => {
      if (!currentRoomSlug) return;
      const slug = currentRoomSlug;
      currentRoomSlug = '';

      const roomState = getRoomState(slug);
      if (!roomState) return;

      const user = roomState.users.get(socket.id);
      if (!user) return;

      socket.leave(slug);

      // ── Immediately restore video for remaining viewers ───────────────────
      // This must happen before the grace-period delay so other watchers
      // don't sit on a paused video for 30 seconds.
      const isAdminOrDj = user.isAdmin || user.isDJ;
      const wasDjBackgrounding = roomState.djBackgrounding?.socketId === socket.id;
      // Use a 15-second window — matches djBackgrounding's 15s window and gives
      // more margin for slow mobile connections.
      const AUTO_PAUSE_WINDOW = 15_000;
      const wasAutoPaused =
        !roomState.isPlaying &&
        roomState.lastPauseBy === socket.id &&
        roomState.lastPauseAt != null &&
        (Date.now() - roomState.lastPauseAt) < AUTO_PAUSE_WINDOW;

      // roomState.users still contains the leaving user at this point
      // (they're removed after grace period), so we check size > 1.
      const shouldRestorePlay =
        roomState.users.size > 1 &&
        roomState.currentVideo &&
        isAdminOrDj &&
        (wasDjBackgrounding || wasAutoPaused);

      if (shouldRestorePlay && !roomState.isPlaying) {
        roomState.isPlaying = true;
        roomState.lastSyncTimestamp = Date.now();
        roomState.djBackgrounding = undefined;
        startHeartbeat(io, roomState);
        io.to(slug).emit("video-sync", {
          action: "play",
          currentTime: computedTime(roomState),
          url: roomState.currentVideo,
          isPlaying: true,
          isLive: roomState.isLive,
          from: "server",
          serverTs: Date.now(),
        });
      }

      // ── Broadcast user-left (immediately or after grace period) ─────────────
      const leaveKey = pendingLeaveKey(slug, user.userId, user.username);

      // Cancel any existing pending leave for this user (e.g. double-disconnect)
      const existing = pendingLeaves.get(leaveKey);
      if (existing) {
        clearTimeout(existing.timer);
        pendingLeaves.delete(leaveKey);
      }

      const broadcastLeave = () => {
        const state = rooms.get(slug);
        if (!state) return;

        // Actually remove the user from the room
        state.users.delete(socket.id);

        const systemMsg = {
          username: "system",
          content: `${user.username} left the room / ${user.username} غادر الغرفة`,
          type: "system" as const,
          roomId: state.roomId,
        };
        // Leave notifications are real-time only — not persisted to DB
        io.to(slug).emit("user-left", {
          socketId: socket.id,
          username: user.username,
          users: Array.from(state.users.values()),
          systemMessage: systemMsg,
        });

        if (state.users.size === 0) {
          stopHeartbeat(state);
          scheduleRoomDeletion(slug);
        } else if (user.isAdmin && !state.creatorUserId) {
          const firstUser = state.users.values().next().value;
          if (firstUser) {
            firstUser.isAdmin = true;
            firstUser.isDJ = true;
            db.update(roomsTable).set({ adminSocketId: firstUser.socketId }).where(eq(roomsTable.id, state.roomId)).then(() => {});
            io.to(slug).emit("users-updated", { users: Array.from(state.users.values()) });
          }
        } else if (user.isAdmin && state.creatorUserId) {
          io.to(slug).emit("users-updated", { users: Array.from(state.users.values()) });
        }
      };

      if (immediate) {
        // Explicit leave-room event: broadcast right away, no grace period
        broadcastLeave();
      } else {
        // Socket disconnect: wait LEAVE_GRACE_MS in case the user reconnects
        const timer = setTimeout(() => {
          pendingLeaves.delete(leaveKey);
          broadcastLeave();
        }, LEAVE_GRACE_MS);
        pendingLeaves.set(leaveKey, {
          timer,
          user,
          oldSocketId: socket.id,
          roomSlug: slug,
        });
      }
    };

    socket.on("leave-room", () => handleLeaveRoom(true));
    socket.on("disconnect", () => {
      // ── Clean up per-socket throttle state ──────────────────────────────
      chatThrottle.cleanup(socket.id);
      syncThrottle.cleanup(socket.id);
      joinThrottle.cleanup(socket.id);

      // ── Clean up DM view tracking ────────────────────────────────────────
      socketDmViews.delete(socket.id);

      // ── Decrement per-IP connection counter ─────────────────────────────
      const c = connectionsByIp.get(clientIp) || 0;
      if (c <= 1) connectionsByIp.delete(clientIp);
      else connectionsByIp.set(clientIp, c - 1);

      handleLeaveRoom();
    });
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
