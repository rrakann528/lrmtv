import { Router, type IRouter } from "express";
import { eq, and, or, ne, gt, desc } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import {
  db,
  pushSubscriptionsTable,
  friendshipsTable,
  usersTable,
  roomInvitesTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getIO } from "../lib/socket";

const router: IRouter = Router();

// ─── VAPID ────────────────────────────────────────────────────────────────────
webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

/** Send a push notification and delete stale subscription on 404/410 */
async function sendPush(sub: { id: number; endpoint: string; p256dh: string; auth: string }, payload: string) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    console.log(`[Push] OK  → endpoint=${sub.endpoint.slice(0, 50)}…`);
    return true;
  } catch (err: any) {
    const status: number = err?.statusCode ?? 0;
    console.error(`[Push] ERR status=${status} body=${err?.body} endpoint=${sub.endpoint.slice(0, 50)}…`);
    if (status === 404 || status === 410) {
      // Subscription expired — remove from DB
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
      console.log(`[Push] Deleted stale subscription id=${sub.id}`);
    }
    return false;
  }
}

// ─── Public VAPID key ─────────────────────────────────────────────────────────
router.get("/push/vapid-public-key", (_req, res): void => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// ─── Save / update subscription ───────────────────────────────────────────────
router.post("/push/subscribe", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: "Invalid subscription" }); return; }

  const { endpoint, keys } = parsed.data;
  const userId = req.userId!;

  // Step 1: Delete any row with this exact endpoint (even if it belongs to another user)
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  // Step 2: Delete old subscriptions for this user (different endpoints)
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  // Step 3: Insert fresh — no conflicts possible
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth });

  console.log(`[Push] Subscribed userId=${userId} endpoint=${endpoint.slice(0, 50)}…`);
  res.json({ ok: true });
});

// ─── Test push (send to yourself) ─────────────────────────────────────────────
router.post("/push/test", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  if (subs.length === 0) {
    res.status(404).json({ error: "لا يوجد اشتراك مسجّل" });
    return;
  }

  const payload = JSON.stringify({
    title: "اختبار الإشعارات ✓",
    body: "الإشعارات تعمل بشكل صحيح!",
    url: "/",
    tag: "push-test",
  });

  let sent = 0;
  await Promise.allSettled(subs.map(async sub => {
    const ok = await sendPush(sub, payload);
    if (ok) sent++;
  }));

  res.json({ ok: sent > 0, sent });
});

// ─── Pending room invites ─────────────────────────────────────────────────────
router.get("/invites/pending", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const now = new Date();
  const pending = await db
    .select({
      id: roomInvitesTable.id,
      roomSlug: roomInvitesTable.roomSlug,
      roomName: roomInvitesTable.roomName,
      senderUsername: usersTable.username,
      createdAt: roomInvitesTable.createdAt,
    })
    .from(roomInvitesTable)
    .innerJoin(usersTable, eq(usersTable.id, roomInvitesTable.senderId))
    .where(and(
      eq(roomInvitesTable.receiverId, req.userId!),
      eq(roomInvitesTable.status, "pending"),
      gt(roomInvitesTable.expiresAt, now),
    ))
    .orderBy(desc(roomInvitesTable.createdAt))
    .limit(5);

  res.json(pending);
});

// ─── Accept / decline invite ──────────────────────────────────────────────────
router.patch("/invites/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = z.object({ status: z.enum(["accepted", "declined"]) }).parse(req.body);

  await db
    .update(roomInvitesTable)
    .set({ status })
    .where(and(
      eq(roomInvitesTable.id, id),
      eq(roomInvitesTable.receiverId, req.userId!),
    ));

  res.json({ ok: true });
});

// ─── Invite friend to room ────────────────────────────────────────────────────
router.post("/push/invite", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = z.object({
    friendId: z.number().int().positive(),
    roomSlug: z.string().min(1),
    roomName: z.string().min(1),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const { friendId, roomSlug, roomName } = parsed.data;
  const uid = req.userId!;

  // Confirm friendship
  const [friendship] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(and(
      eq(friendshipsTable.status, "accepted"),
      or(
        and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, friendId)),
        and(eq(friendshipsTable.requesterId, friendId), eq(friendshipsTable.addresseeId, uid)),
      ),
    ))
    .limit(1);

  if (!friendship) { res.status(403).json({ error: "ليس صديقاً" }); return; }

  // Sender info
  const [sender] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, uid))
    .limit(1);

  const senderName = sender?.displayName || sender?.username || "صديق";
  const expiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // 1️⃣  Persist invite to DB (catch-all if app was closed)
  await db
    .update(roomInvitesTable)
    .set({ status: "expired" })
    .where(and(
      eq(roomInvitesTable.senderId, uid),
      eq(roomInvitesTable.receiverId, friendId),
      eq(roomInvitesTable.roomSlug, roomSlug),
      eq(roomInvitesTable.status, "pending"),
    ));

  await db.insert(roomInvitesTable).values({
    senderId: uid,
    receiverId: friendId,
    roomSlug,
    roomName,
    status: "pending",
    expiresAt,
  });

  // 2️⃣  Socket.io (instant when app is open)
  getIO()?.to(`user:${friendId}`).emit("room-invite", { from: senderName, roomSlug, roomName });

  // 3️⃣  Push notification (when app is backgrounded / closed)
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, friendId));

  console.log(`[Push] Sending invite to userId=${friendId}, subscriptions found: ${subs.length}`);

  let sent = 0;
  if (subs.length > 0) {
    const payload = JSON.stringify({
      title: `دعوة من ${senderName} 🎬`,
      body: `يدعوك للانضمام إلى غرفة "${roomName}"`,
      url: `/room/${roomSlug}`,
      tag: `invite-${uid}`,
    });

    await Promise.allSettled(subs.map(async sub => {
      const ok = await sendPush(sub, payload);
      if (ok) sent++;
    }));
  }

  res.json({ ok: true, sent });
});

export default router;
