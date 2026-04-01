import { Router } from "express";
import bcrypt from "bcryptjs";
import webpush from "web-push";
import {
  db, usersTable, roomsTable, playlistItemsTable, chatMessagesTable,
  pushSubscriptionsTable, siteSettingsTable,
  loginAttemptsTable,
} from "@workspace/db";
import { eq, desc, count, asc, sql, and, lt } from "drizzle-orm";
import { requireSiteAdmin, type AuthRequest } from "../middlewares/auth";
import {
  broadcastSystemMessage, getActiveRoomsDetailed, getTotalActiveUsers, kickRoom, freezeRoom,
  kickUserFromAllRooms, getUserActiveRooms, forceRoomVideoState, sendRoomAnnouncement,
  updateRoomCreator, siteMuteUser, refreshSettingsCache,
} from "../lib/socket";

const router = Router();

// ── Helper: read/write site settings ─────────────────────────────────────────
async function getSetting(key: string, fallback = ""): Promise<string> {
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key)).limit(1);
  return row?.value ?? fallback;
}
async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(siteSettingsTable).values({ key, value })
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value, updatedAt: new Date() } });
}

export { getSetting };

// ── Public: site announcement (no auth required) ──────────────────────────────
router.get("/public/site-info", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(siteSettingsTable);
    const map = new Map(rows.map(s => [s.key, s.value]));
    res.json({
      announcement: map.get("announcement") ?? "",
      maintenanceMode: map.get("maintenance_mode") === "true",
    });
  } catch { res.json({ announcement: "", maintenanceMode: false }); }
});

// ── Helper: send push notification ───────────────────────────────────────────
async function sendOnePush(sub: { id: number; endpoint: string; p256dh: string; auth: string }, payload: string) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    return true;
  } catch (err: any) {
    const status: number = err?.statusCode ?? 0;
    if (status === 404 || status === 410) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
    }
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/stats", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const [[{ totalUsers }], [{ totalRooms }], [{ bannedUsers }]] = await Promise.all([
      db.select({ totalUsers: count() }).from(usersTable),
      db.select({ totalRooms: count() }).from(roomsTable),
      db.select({ bannedUsers: count() }).from(usersTable).where(eq(usersTable.isBanned, true)),
    ]);
    const activeRooms = getActiveRoomsDetailed();
    const activeUsers = getTotalActiveUsers();
    res.json({ totalUsers, totalRooms, bannedUsers, activeRooms: activeRooms.length, activeUsers });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

router.get("/admin/stats/live", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const rooms = getActiveRoomsDetailed();
    const totalActiveUsers = getTotalActiveUsers();
    const topRooms = [...rooms].sort((a, b) => b.userCount - a.userCount).slice(0, 10);
    res.json({ totalActiveUsers, totalActiveRooms: rooms.length, topRooms });
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

router.get("/admin/stats/registrations", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT DATE(created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/users", requireSiteAdmin, async (req, res): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
    const offset = (page - 1) * limit;

    const [users, [{ total }]] = await Promise.all([
      db.select({
        id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
        email: usersTable.email, provider: usersTable.provider, isSiteAdmin: usersTable.isSiteAdmin,
        isBanned: usersTable.isBanned, isMuted: usersTable.isMuted, adminNote: usersTable.adminNote,
        lastSeenAt: usersTable.lastSeenAt, createdAt: usersTable.createdAt,
      }).from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(usersTable),
    ]);
    res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Internal error" }); }
});

// Edit user data
router.patch("/admin/users/:id", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  const { displayName, email, username } = req.body;
  const updates: Record<string, string> = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (email !== undefined) updates.email = email.trim().toLowerCase();
  if (username !== undefined) updates.username = username;
  try {
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, targetId)).returning();
    if (!updated) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || "خطأ داخلي" }); }
});

// Toggle site admin
router.patch("/admin/users/:id/admin", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  if (targetId === req.userId) { res.status(400).json({ error: "لا يمكنك تغيير صلاحيتك الخاصة" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    const [updated] = await db.update(usersTable).set({ isSiteAdmin: !user.isSiteAdmin }).where(eq(usersTable.id, targetId)).returning();
    res.json({ isSiteAdmin: updated.isSiteAdmin });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Ban / unban
router.patch("/admin/users/:id/ban", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  if (targetId === req.userId) { res.status(400).json({ error: "لا يمكنك حظر حسابك الخاص" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    const [updated] = await db.update(usersTable).set({ isBanned: !user.isBanned }).where(eq(usersTable.id, targetId)).returning();
    res.json({ isBanned: updated.isBanned });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Reset password
router.post("/admin/users/:id/reset-password", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) { res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }); return; }
  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, targetId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Delete user
router.delete("/admin/users/:id", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  if (targetId === req.userId) { res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" }); return; }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, targetId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Rooms created by user
router.get("/admin/users/:id/rooms", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    const rooms = await db.select().from(roomsTable).where(eq(roomsTable.creatorUserId, targetId)).orderBy(desc(roomsTable.createdAt));
    res.json(rooms);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Send push to specific user
router.post("/admin/push/user/:id", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  const { title, body } = req.body;
  if (!title || !body) { res.status(400).json({ error: "العنوان والنص مطلوبان" }); return; }
  try {
    const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, targetId));
    const payload = JSON.stringify({ title, body, icon: "/icons/icon-192.png" });
    let sent = 0;
    for (const sub of subs) { if (await sendOnePush(sub, payload)) sent++; }
    res.json({ ok: true, sent });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOM MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/rooms", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const rooms = await db.select({
      id: roomsTable.id, slug: roomsTable.slug, name: roomsTable.name,
      type: roomsTable.type, isFrozen: roomsTable.isFrozen,
      creatorUserId: roomsTable.creatorUserId, createdAt: roomsTable.createdAt,
    }).from(roomsTable).orderBy(desc(roomsTable.createdAt));
    const active = getActiveRoomsDetailed();
    const activeMap = new Map(active.map(r => [r.slug, r.userCount]));
    res.json(rooms.map(r => ({ ...r, activeUsers: activeMap.get(r.slug) ?? 0 })));
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Freeze / unfreeze room
router.patch("/admin/rooms/:slug/freeze", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    const newFrozen = !room.isFrozen;
    await db.update(roomsTable).set({ isFrozen: newFrozen }).where(eq(roomsTable.slug, slug));
    freezeRoom(slug, newFrozen); // update in-memory cache and kick users if freezing
    res.json({ isFrozen: newFrozen });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Toggle room type (public/private)
router.patch("/admin/rooms/:slug/type", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    const newType = room.type === "public" ? "private" : "public";
    await db.update(roomsTable).set({ type: newType }).where(eq(roomsTable.slug, slug));
    res.json({ type: newType });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// View room playlist
router.get("/admin/rooms/:slug/playlist", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    const items = await db.select().from(playlistItemsTable).where(eq(playlistItemsTable.roomId, room.id)).orderBy(asc(playlistItemsTable.position));
    res.json(items);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Delete room
router.delete("/admin/rooms/:slug", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    kickRoom(slug);
    await db.delete(roomsTable).where(eq(roomsTable.slug, slug));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS & BROADCAST
// ══════════════════════════════════════════════════════════════════════════════

// Push to all subscribers
router.post("/admin/push/all", requireSiteAdmin, async (req, res): Promise<void> => {
  const { title, body } = req.body;
  if (!title || !body) { res.status(400).json({ error: "العنوان والنص مطلوبان" }); return; }
  try {
    const subs = await db.select().from(pushSubscriptionsTable);
    const payload = JSON.stringify({ title, body, icon: "/icons/icon-192.png" });
    let sent = 0;
    for (const sub of subs) { if (await sendOnePush(sub, payload)) sent++; }
    res.json({ ok: true, sent, total: subs.length });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// System message to all active rooms
router.post("/admin/broadcast", requireSiteAdmin, async (req, res): Promise<void> => {
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "الرسالة مطلوبة" }); return; }
  try {
    broadcastSystemMessage(message.trim());
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SITE SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: Record<string, string> = {
  maintenance_mode: "false",

  announcement: "",
  welcome_message: "",
  max_rooms_per_user: "10",
  max_room_members: "100",
};

router.get("/admin/settings", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(siteSettingsTable);
    const map: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const r of rows) map[r.key] = r.value;
    res.json(map);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.put("/admin/settings", requireSiteAdmin, async (req, res): Promise<void> => {
  const updates: Record<string, string> = req.body;
  if (typeof updates !== "object") { res.status(400).json({ error: "البيانات غير صحيحة" }); return; }
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (key in DEFAULT_SETTINGS) await setSetting(key, String(value));
    }
    // Refresh in-memory cache immediately so changes take effect without waiting 60s
    await refreshSettingsCache();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY — LOGIN ATTEMPTS
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/login-attempts", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const attempts = await db.select().from(loginAttemptsTable)
      .where(eq(loginAttemptsTable.success, false))
      .orderBy(desc(loginAttemptsTable.createdAt))
      .limit(200);
    res.json(attempts);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// Clear old login attempts (keep last 7 days)
router.delete("/admin/login-attempts", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    await db.delete(loginAttemptsTable).where(
      lt(loginAttemptsTable.createdAt, sql`NOW() - INTERVAL '7 days'`)
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/backup", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const [users, rooms, settings] = await Promise.all([
      db.select({
        id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
        email: usersTable.email, provider: usersTable.provider, isSiteAdmin: usersTable.isSiteAdmin,
        isBanned: usersTable.isBanned, createdAt: usersTable.createdAt,
      }).from(usersTable),
      db.select().from(roomsTable),
      db.select().from(siteSettingsTable),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      users,
      rooms,
      settings,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="lrmtv-backup-${new Date().toISOString().split("T")[0]}.json"`);
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// USER — MUTE / NOTE / KICK / EXPORT
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/admin/users/:id/mute", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    const newMuted = !user.isMuted;
    const [updated] = await db.update(usersTable).set({ isMuted: newMuted }).where(eq(usersTable.id, targetId)).returning();
    // Apply mute/unmute immediately to all active rooms
    siteMuteUser(targetId, newMuted);
    res.json({ isMuted: updated.isMuted });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.put("/admin/users/:id/note", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  const { note } = req.body;
  try {
    await db.update(usersTable).set({ adminNote: String(note ?? "") }).where(eq(usersTable.id, targetId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.post("/admin/users/:id/kick", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  const rooms = getUserActiveRooms(targetId);
  kickUserFromAllRooms(targetId);
  res.json({ ok: true, rooms });
});

router.get("/admin/users/:id/rooms-active", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  res.json({ rooms: getUserActiveRooms(targetId) });
});

router.get("/admin/users/export", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const users = await db.select({
      id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
      email: usersTable.email, provider: usersTable.provider, isSiteAdmin: usersTable.isSiteAdmin,
      isBanned: usersTable.isBanned, isMuted: usersTable.isMuted, createdAt: usersTable.createdAt,
    }).from(usersTable).orderBy(desc(usersTable.createdAt));
    const header = "ID,Username,DisplayName,Email,Provider,IsAdmin,IsBanned,IsMuted,CreatedAt\n";
    const rows = users.map(u =>
      [u.id, u.username, `"${u.displayName ?? ''}"`, u.email ?? '', u.provider, u.isSiteAdmin, u.isBanned, u.isMuted, u.createdAt].join(',')
    ).join('\n');
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="users-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(header + rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOM — RENAME / CHAT / PLAYLIST / FORCE-VIDEO / EXPORT
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/admin/rooms/:slug/rename", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "الاسم مطلوب" }); return; }
  try {
    const [updated] = await db.update(roomsTable).set({ name: name.trim() }).where(eq(roomsTable.slug, slug)).returning();
    if (!updated) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    res.json({ ok: true, name: updated.name });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.get("/admin/rooms/:slug/chat", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    const msgs = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.roomId, room.id))
      .orderBy(desc(chatMessagesTable.createdAt)).limit(limit);
    res.json(msgs.reverse());
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.delete("/admin/rooms/:slug/chat", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.roomId, room.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.delete("/admin/rooms/:slug/playlist", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    await db.delete(playlistItemsTable).where(eq(playlistItemsTable.roomId, room.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.post("/admin/rooms/:slug/video", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const { action } = req.body;
  if (action !== 'play' && action !== 'pause') { res.status(400).json({ error: "action يجب أن يكون play أو pause" }); return; }
  forceRoomVideoState(slug, action);
  res.json({ ok: true });
});

router.get("/admin/rooms/export", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const rooms = await db.select({
      id: roomsTable.id, slug: roomsTable.slug, name: roomsTable.name,
      type: roomsTable.type, isFrozen: roomsTable.isFrozen,
      creatorUserId: roomsTable.creatorUserId, createdAt: roomsTable.createdAt,
    }).from(roomsTable).orderBy(desc(roomsTable.createdAt));
    const header = "ID,Slug,Name,Type,IsFrozen,CreatorUserId,CreatedAt\n";
    const rows = rooms.map(r =>
      [r.id, r.slug, `"${r.name}"`, r.type, r.isFrozen, r.creatorUserId ?? '', r.createdAt].join(',')
    ).join('\n');
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="rooms-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(header + rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RECENT CHAT (global)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/recent-chat", requireSiteAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
  try {
    const msgs = await db.execute(sql`
      SELECT cm.id, cm.username, cm.content, cm.type, cm.created_at,
             r.slug AS room_slug, r.name AS room_name
      FROM chat_messages cm
      JOIN rooms r ON r.id = cm.room_id
      ORDER BY cm.created_at DESC
      LIMIT ${limit}
    `);
    res.json(msgs.rows.reverse());
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.delete("/admin/chat/:id", requireSiteAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SYSTEM INFO
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/system", requireSiteAdmin, async (_req, res): Promise<void> => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const [[{ totalMessages }], [{ totalUsers }], [{ totalRooms }]] = await Promise.all([
    db.select({ totalMessages: count() }).from(chatMessagesTable),
    db.select({ totalUsers: count() }).from(usersTable),
    db.select({ totalRooms: count() }).from(roomsTable),
  ]);
  res.json({
    node: process.version,
    uptime: Math.floor(uptime),
    memRss: Math.round(mem.rss / 1024 / 1024),
    memHeap: Math.round(mem.heapUsed / 1024 / 1024),
    memHeapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    totalMessages,
    totalUsers,
    totalRooms,
    activeRooms: getActiveRoomsDetailed().length,
    activeUsers: getTotalActiveUsers(),
    platform: process.platform,
    env: process.env.NODE_ENV || 'unknown',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PUSH SUBSCRIBERS
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/push-subscribers", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const subs = await db.execute(sql`
      SELECT ps.id, ps.endpoint, ps.created_at, u.username, u.id AS user_id
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id
      ORDER BY ps.created_at DESC
    `);
    res.json(subs.rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.delete("/admin/push-subscribers/:id", requireSiteAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// WORD FILTER (stored in site_settings as JSON)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/word-filter", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const val = await getSetting("word_filter", "[]");
    res.json(JSON.parse(val));
  } catch { res.json([]); }
});

router.post("/admin/word-filter", requireSiteAdmin, async (req, res): Promise<void> => {
  const { word } = req.body;
  if (!word?.trim()) { res.status(400).json({ error: "الكلمة مطلوبة" }); return; }
  try {
    const val = await getSetting("word_filter", "[]");
    const list: string[] = JSON.parse(val);
    const w = word.trim().toLowerCase();
    if (!list.includes(w)) list.push(w);
    await setSetting("word_filter", JSON.stringify(list));
    await refreshSettingsCache();
    res.json(list);
  } catch { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.delete("/admin/word-filter/:word", requireSiteAdmin, async (req, res): Promise<void> => {
  try {
    const val = await getSetting("word_filter", "[]");
    const list: string[] = JSON.parse(val);
    const filtered = list.filter(w => w !== decodeURIComponent(req.params.word));
    await setSetting("word_filter", JSON.stringify(filtered));
    await refreshSettingsCache();
    res.json(filtered);
  } catch { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ENHANCED STATS
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/stats/enhanced", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const [[{ totalMessages }], providers] = await Promise.all([
      db.select({ totalMessages: count() }).from(chatMessagesTable),
      db.execute(sql`SELECT provider, COUNT(*)::int AS cnt FROM users GROUP BY provider ORDER BY cnt DESC`),
    ]);
    res.json({ totalMessages, providers: providers.rows });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1: رسم بياني إنشاء الغرف يومياً
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/stats/rooms-daily", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM rooms
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2: إيقاف جميع الغرف النشطة دفعة واحدة
// ══════════════════════════════════════════════════════════════════════════════

router.post("/admin/rooms/pause-all", requireSiteAdmin, async (_req, res): Promise<void> => {
  const active = getActiveRoomsDetailed();
  for (const r of active) { forceRoomVideoState(r.slug, 'pause'); }
  res.json({ ok: true, paused: active.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// نقل ملكية الغرفة
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/admin/rooms/:slug/transfer-owner", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const { newOwnerUsername } = req.body;
  if (!newOwnerUsername?.trim()) { res.status(400).json({ error: "اسم المستخدم مطلوب" }); return; }
  try {
    const [newOwner] = await db.select().from(usersTable).where(eq(usersTable.username, newOwnerUsername.trim())).limit(1);
    if (!newOwner) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    await db.update(roomsTable).set({ creatorUserId: newOwner.id }).where(eq(roomsTable.slug, slug));
    // Update in-memory room state immediately so live rooms reflect the change
    updateRoomCreator(slug, newOwner.id);
    res.json({ ok: true, newOwnerId: newOwner.id, newOwnerUsername: newOwner.username });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 5: تصدير محادثة الغرفة CSV
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/rooms/:slug/chat/export", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.slug, slug)).limit(1);
    if (!room) { res.status(404).json({ error: "الغرفة غير موجودة" }); return; }
    const msgs = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.roomId, room.id))
      .orderBy(asc(chatMessagesTable.createdAt));
    const header = "ID,Username,Type,Content,CreatedAt\n";
    const rows = msgs.map(m =>
      [m.id, m.username, m.type, `"${m.content.replace(/"/g, '""')}"`, m.createdAt].join(',')
    ).join('\n');
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="chat-${slug}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\uFEFF' + header + rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6: عدد رسائل كل مستخدم
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/users/message-counts", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      SELECT username, COUNT(*)::int AS msg_count
      FROM chat_messages
      WHERE type = 'message'
      GROUP BY username
      ORDER BY msg_count DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 7: حذف جميع غرف مستخدم
// ══════════════════════════════════════════════════════════════════════════════

router.delete("/admin/users/:id/rooms", requireSiteAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    const userRooms = await db.select({ slug: roomsTable.slug }).from(roomsTable).where(eq(roomsTable.creatorUserId, targetId));
    for (const r of userRooms) { kickRoom(r.slug); }
    const deleted = await db.delete(roomsTable).where(eq(roomsTable.creatorUserId, targetId)).returning({ slug: roomsTable.slug });
    res.json({ ok: true, deleted: deleted.length });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 8: بحث عالمي (مستخدمون + غرف)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/global-search", requireSiteAdmin, async (req, res): Promise<void> => {
  const q = String(req.query.q ?? '').trim();
  if (!q || q.length < 2) { res.json({ users: [], rooms: [] }); return; }
  try {
    const [users, rooms] = await Promise.all([
      db.execute(sql`
        SELECT id, username, display_name, email, is_banned, is_site_admin, created_at
        FROM users
        WHERE username ILIKE ${'%' + q + '%'} OR display_name ILIKE ${'%' + q + '%'} OR email ILIKE ${'%' + q + '%'}
        LIMIT 10
      `),
      db.execute(sql`
        SELECT id, slug, name, type, is_frozen, created_at
        FROM rooms
        WHERE name ILIKE ${'%' + q + '%'} OR slug ILIKE ${'%' + q + '%'}
        LIMIT 10
      `),
    ]);
    res.json({ users: users.rows, rooms: rooms.rows });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 9: سجل نشاط الأدمن (بسيط - يخزن في site_settings)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/activity-log", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const val = await getSetting("admin_activity_log", "[]");
    res.json(JSON.parse(val));
  } catch { res.json([]); }
});

router.post("/admin/activity-log", requireSiteAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { action } = req.body;
  if (!action) { res.status(400).json({ error: "action مطلوب" }); return; }
  try {
    const val = await getSetting("admin_activity_log", "[]");
    const log: any[] = JSON.parse(val);
    log.unshift({ action, by: req.user?.username ?? 'admin', at: new Date().toISOString() });
    if (log.length > 100) log.splice(100);
    await setSetting("admin_activity_log", JSON.stringify(log));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 10: تثبيت/إلغاء تثبيت رسالة إعلان الغرفة
// ══════════════════════════════════════════════════════════════════════════════

router.post("/admin/rooms/:slug/announce", requireSiteAdmin, async (req, res): Promise<void> => {
  const { slug } = req.params;
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "الرسالة مطلوبة" }); return; }
  sendRoomAnnouncement(slug, message.trim());
  res.json({ ok: true });
});

export default router;
