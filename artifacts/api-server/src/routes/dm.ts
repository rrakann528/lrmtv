import { Router, type IRouter } from "express";
import { eq, or, and, asc } from "drizzle-orm";
import webpush from "web-push";
import { db, directMessagesTable, usersTable, friendshipsTable, pushSubscriptionsTable, dmReadReceiptsTable, mutedFriendsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { z } from "zod";

const router: IRouter = Router();

function areFriends(uid: number, fid: number) {
  return db.select().from(friendshipsTable).where(
    and(
      eq(friendshipsTable.status, "accepted"),
      or(
        and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, fid)),
        and(eq(friendshipsTable.requesterId, fid), eq(friendshipsTable.addresseeId, uid)),
      )
    )
  ).limit(1);
}

// ── Get DM history ────────────────────────────────────────────────────────────
router.get("/dm/:friendId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const friendId = parseInt(req.params.friendId, 10);
  if (isNaN(friendId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const uid = req.userId!;
  const friends = await areFriends(uid, friendId);
  if (!friends.length) { res.status(403).json({ error: "لستم أصدقاء" }); return; }

  const msgs = await db.select({
    id: directMessagesTable.id,
    senderId: directMessagesTable.senderId,
    receiverId: directMessagesTable.receiverId,
    content: directMessagesTable.content,
    createdAt: directMessagesTable.createdAt,
  })
  .from(directMessagesTable)
  .where(or(
    and(eq(directMessagesTable.senderId, uid), eq(directMessagesTable.receiverId, friendId)),
    and(eq(directMessagesTable.senderId, friendId), eq(directMessagesTable.receiverId, uid)),
  ))
  .orderBy(asc(directMessagesTable.createdAt))
  .limit(100);

  res.json(msgs);
});

// ── Send DM ───────────────────────────────────────────────────────────────────
const SendBody = z.object({ content: z.string().min(1).max(1000) });

router.post("/dm/:friendId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const friendId = parseInt(req.params.friendId, 10);
  if (isNaN(friendId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "محتوى الرسالة مطلوب" }); return; }

  const uid = req.userId!;
  const friends = await areFriends(uid, friendId);
  if (!friends.length) { res.status(403).json({ error: "لستم أصدقاء" }); return; }

  const [msg] = await db.insert(directMessagesTable).values({
    senderId: uid,
    receiverId: friendId,
    content: parsed.data.content,
  }).returning();

  // ── Socket.IO real-time delivery ─────────────────────────────────────────────
  const { getIO } = await import("../lib/socket");
  const io = getIO();
  if (io) {
    io.to(`user:${friendId}`).emit("dm:receive", msg);
    io.to(`user:${uid}`).emit("dm:receive", msg);
  }

  // ── Push notification (fire & forget) ────────────────────────────────────────
  try {
    // Check if receiver has muted the sender
    const [muteRow] = await db
      .select()
      .from(mutedFriendsTable)
      .where(and(eq(mutedFriendsTable.userId, friendId), eq(mutedFriendsTable.friendId, uid)))
      .limit(1);

    if (muteRow) {
      console.log(`[DM Push] Skipped — userId=${friendId} muted sender=${uid}`);
      res.status(201).json(msg);
      return;
    }

    const [sender] = await db
      .select({ username: usersTable.username, displayName: usersTable.displayName })
      .from(usersTable).where(eq(usersTable.id, uid)).limit(1);

    const subs = await db.select().from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, friendId));

    const senderName = sender?.displayName || sender?.username || "مستخدم";
    const preview = parsed.data.content.length > 60
      ? parsed.data.content.slice(0, 57) + "..."
      : parsed.data.content;

    const payload = JSON.stringify({
      title: `رسالة من ${senderName}`,
      body: preview,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      url: `/home`,
      tag: `dm-${uid}`,
    });

    await Promise.allSettled(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        console.log(`[DM Push] Sent to userId=${sub.userId} endpoint=${sub.endpoint.slice(0, 50)}...`);
      } catch (err: any) {
        console.error(`[DM Push] Failed userId=${sub.userId} status=${err.statusCode} body=${err.body}`);
        if (err.statusCode === 410) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }));
  } catch (e) { console.error('[DM Push] outer error:', e); }

  res.status(201).json(msg);
});

// ── Mark conversation as read ─────────────────────────────────────────────────
router.post("/dm/:friendId/read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const friendId = parseInt(req.params.friendId, 10);
  if (isNaN(friendId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const uid = req.userId!;

  await db
    .insert(dmReadReceiptsTable)
    .values({ userId: uid, friendId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [dmReadReceiptsTable.userId, dmReadReceiptsTable.friendId],
      set: { lastReadAt: new Date() },
    });

  res.json({ ok: true });
});

export default router;
