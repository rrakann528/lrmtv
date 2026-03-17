import { Router } from "express";
import bcrypt from "bcryptjs";
import webpush from "web-push";
import {
  db, usersTable, roomsTable, playlistItemsTable,
  pushSubscriptionsTable, siteSettingsTable, bannedIpsTable,
  loginAttemptsTable,
} from "@workspace/db";
import { eq, desc, count, asc, sql, and, lt } from "drizzle-orm";
import { requireSiteAdmin, type AuthRequest } from "../middlewares/auth";
import {
  broadcastSystemMessage, getActiveRoomsDetailed, getTotalActiveUsers, kickRoom, freezeRoom,
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
    const [[{ totalUsers }], [{ totalRooms }], [{ bannedUsers }], [{ totalBannedIps }]] = await Promise.all([
      db.select({ totalUsers: count() }).from(usersTable),
      db.select({ totalRooms: count() }).from(roomsTable),
      db.select({ bannedUsers: count() }).from(usersTable).where(eq(usersTable.isBanned, true)),
      db.select({ totalBannedIps: count() }).from(bannedIpsTable),
    ]);
    const activeRooms = getActiveRoomsDetailed();
    const activeUsers = getTotalActiveUsers();
    res.json({ totalUsers, totalRooms, bannedUsers, totalBannedIps, activeRooms: activeRooms.length, activeUsers });
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

router.get("/admin/users", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const users = await db.select({
      id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
      email: usersTable.email, provider: usersTable.provider, isSiteAdmin: usersTable.isSiteAdmin,
      isBanned: usersTable.isBanned, createdAt: usersTable.createdAt,
    }).from(usersTable).orderBy(desc(usersTable.createdAt));
    res.json(users);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
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
  registration_enabled: "true",
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
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY — BANNED IPs
// ══════════════════════════════════════════════════════════════════════════════

router.get("/admin/banned-ips", requireSiteAdmin, async (_req, res): Promise<void> => {
  try {
    const ips = await db.select().from(bannedIpsTable).orderBy(desc(bannedIpsTable.createdAt));
    res.json(ips);
  } catch (err) { res.status(500).json({ error: "خطأ داخلي" }); }
});

router.post("/admin/banned-ips", requireSiteAdmin, async (req, res): Promise<void> => {
  const { ip, reason } = req.body;
  if (!ip?.trim()) { res.status(400).json({ error: "عنوان IP مطلوب" }); return; }
  try {
    const [row] = await db.insert(bannedIpsTable).values({ ip: ip.trim(), reason: reason || "" }).returning();
    res.json(row);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "هذا الـ IP محظور مسبقاً" }); return; }
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

router.delete("/admin/banned-ips/:id", requireSiteAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "معرف غير صالح" }); return; }
  try {
    await db.delete(bannedIpsTable).where(eq(bannedIpsTable.id, id));
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
    const [users, rooms, settings, bannedIps] = await Promise.all([
      db.select({
        id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
        email: usersTable.email, provider: usersTable.provider, isSiteAdmin: usersTable.isSiteAdmin,
        isBanned: usersTable.isBanned, createdAt: usersTable.createdAt,
      }).from(usersTable),
      db.select().from(roomsTable),
      db.select().from(siteSettingsTable),
      db.select().from(bannedIpsTable),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      users,
      rooms,
      settings,
      bannedIps,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="lrmtv-backup-${new Date().toISOString().split("T")[0]}.json"`);
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي" });
  }
});

export default router;
