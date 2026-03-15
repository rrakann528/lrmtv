import { Router, type IRouter } from "express";
import { eq, or, and, ne, ilike, desc, gt, sql } from "drizzle-orm";
import webpush from "web-push";
import {
  db,
  usersTable,
  friendshipsTable,
  directMessagesTable,
  dmReadReceiptsTable,
  mutedFriendsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getIO } from "../lib/socket";
import { z } from "zod";

const router: IRouter = Router();

// ── Public user profile ───────────────────────────────────────────────────────
router.get("/users/by-username/:username", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const uid = req.userId!;
  const targetUsername = (req.params.username || "").trim();
  if (!targetUsername) { res.status(400).json({ error: "Invalid username" }); return; }

  const [target] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, bio: usersTable.bio, avatarColor: usersTable.avatarColor, avatarUrl: usersTable.avatarUrl, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.username, targetUsername))
    .limit(1);

  if (!target) { res.status(404).json({ error: "مستخدم غير موجود" }); return; }

  const targetId = target.id;
  let friendshipStatus: "none" | "pending_sent" | "pending_received" | "accepted" = "none";
  let friendshipId: number | undefined;
  let muted = false;

  if (uid !== targetId) {
    const [fs] = await db.select().from(friendshipsTable).where(or(
      and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, targetId)),
      and(eq(friendshipsTable.requesterId, targetId), eq(friendshipsTable.addresseeId, uid)),
    )).limit(1);
    if (fs) {
      friendshipId = fs.id;
      friendshipStatus = fs.status === "accepted" ? "accepted" : fs.requesterId === uid ? "pending_sent" : "pending_received";
    }
    const [muteRow] = await db.select().from(mutedFriendsTable).where(and(eq(mutedFriendsTable.userId, uid), eq(mutedFriendsTable.friendId, targetId))).limit(1);
    muted = !!muteRow;
  }

  res.json({ ...target, friendshipStatus, friendshipId, muted });
});

router.get("/users/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const targetId = Number(req.params.id);
  if (isNaN(targetId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const uid = req.userId!;

  const [target] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      bio: usersTable.bio,
      avatarColor: usersTable.avatarColor,
      avatarUrl: usersTable.avatarUrl,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetId))
    .limit(1);

  if (!target) { res.status(404).json({ error: "مستخدم غير موجود" }); return; }

  // Friendship status
  let friendshipStatus: "none" | "pending_sent" | "pending_received" | "accepted" = "none";
  let friendshipId: number | undefined;
  let muted = false;

  if (uid !== targetId) {
    const [fs] = await db
      .select()
      .from(friendshipsTable)
      .where(or(
        and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, targetId)),
        and(eq(friendshipsTable.requesterId, targetId), eq(friendshipsTable.addresseeId, uid)),
      ))
      .limit(1);

    if (fs) {
      friendshipId = fs.id;
      if (fs.status === "accepted") {
        friendshipStatus = "accepted";
      } else {
        friendshipStatus = fs.requesterId === uid ? "pending_sent" : "pending_received";
      }
    }

    // Check muted
    const [muteRow] = await db
      .select()
      .from(mutedFriendsTable)
      .where(and(eq(mutedFriendsTable.userId, uid), eq(mutedFriendsTable.friendId, targetId)))
      .limit(1);
    muted = !!muteRow;
  }

  res.json({ ...target, friendshipStatus, friendshipId, muted });
});

// ── Search users ──────────────────────────────────────────────────────────────
router.get("/friends/search", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) { res.json([]); return; }

  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarColor: usersTable.avatarColor,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(
      and(
        ne(usersTable.id, req.userId!),
        or(
          ilike(usersTable.username, `%${q}%`),
          ilike(usersTable.displayName, `%${q}%`),
        ),
      )
    )
    .limit(15);
  res.json(users);
});

// ── List friends ──────────────────────────────────────────────────────────────
router.get("/friends", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const uid = req.userId!;

  const cols = {
    friendshipId: friendshipsTable.id,
    status: friendshipsTable.status,
    requesterId: friendshipsTable.requesterId,
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    avatarColor: usersTable.avatarColor,
    avatarUrl: usersTable.avatarUrl,
  };

  // Split into two simple joins to avoid OR in join condition bugs
  const [asSender, asReceiver] = await Promise.all([
    db.select(cols).from(friendshipsTable)
      .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
      .where(eq(friendshipsTable.requesterId, uid)),
    db.select(cols).from(friendshipsTable)
      .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
      .where(eq(friendshipsTable.addresseeId, uid)),
  ]);

  const rows = [...asSender, ...asReceiver];

  // Get muted friends for this user
  const muted = await db
    .select({ friendId: mutedFriendsTable.friendId })
    .from(mutedFriendsTable)
    .where(eq(mutedFriendsTable.userId, uid));
  const mutedSet = new Set(muted.map(m => m.friendId));

  const result = rows.map(r => ({
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    avatarColor: r.avatarColor,
    avatarUrl: r.avatarUrl,
    friendshipId: r.friendshipId,
    muted: mutedSet.has(r.id),
    status: r.status === "accepted"
      ? "accepted"
      : r.requesterId === uid
        ? "pending_sent"
        : "pending_received",
  }));

  res.json(result);
});

// ── Conversations (last message + unread count per friend) ────────────────────
router.get("/friends/conversations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const uid = req.userId!;

  // Get accepted friends — two simple joins instead of OR in join condition
  const convCols = { friendId: usersTable.id, friendshipId: friendshipsTable.id };
  const [convAsSender, convAsReceiver] = await Promise.all([
    db.select(convCols).from(friendshipsTable)
      .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
      .where(and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.status, "accepted"))),
    db.select(convCols).from(friendshipsTable)
      .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
      .where(and(eq(friendshipsTable.addresseeId, uid), eq(friendshipsTable.status, "accepted"))),
  ]);
  const friendRows = [...convAsSender, ...convAsReceiver];

  if (friendRows.length === 0) { res.json([]); return; }

  const friendIds = friendRows.map(r => r.friendId);

  // Get read receipts for all friends in one query
  const receipts = await db
    .select()
    .from(dmReadReceiptsTable)
    .where(eq(dmReadReceiptsTable.userId, uid));

  const receiptMap = new Map(receipts.map(r => [r.friendId, r.lastReadAt]));

  // Build conversation info per friend
  const conversations = await Promise.all(
    friendIds.map(async (fid) => {
      // Last message in this conversation
      const [lastMsg] = await db
        .select({
          id: directMessagesTable.id,
          senderId: directMessagesTable.senderId,
          content: directMessagesTable.content,
          createdAt: directMessagesTable.createdAt,
        })
        .from(directMessagesTable)
        .where(
          or(
            and(eq(directMessagesTable.senderId, uid), eq(directMessagesTable.receiverId, fid)),
            and(eq(directMessagesTable.senderId, fid), eq(directMessagesTable.receiverId, uid)),
          )
        )
        .orderBy(desc(directMessagesTable.createdAt))
        .limit(1);

      // Unread count: messages from friend to me since lastReadAt
      const lastReadAt = receiptMap.get(fid) ?? new Date(0);
      const [{ count }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(directMessagesTable)
        .where(
          and(
            eq(directMessagesTable.senderId, fid),
            eq(directMessagesTable.receiverId, uid),
            gt(directMessagesTable.createdAt, lastReadAt),
          )
        );

      return {
        friendId: fid,
        lastMessage: lastMsg
          ? {
              content: lastMsg.content,
              createdAt: lastMsg.createdAt,
              fromMe: lastMsg.senderId === uid,
            }
          : null,
        unreadCount: count,
      };
    })
  );

  res.json(conversations);
});

// ── Send friend request (+ push notification) ─────────────────────────────────
router.post("/friends/request", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  console.log("[friend-request] body:", JSON.stringify(req.body), "uid:", req.userId);
  const parsed = z.object({ addresseeId: z.number() }).safeParse(req.body);
  if (!parsed.success) {
    console.error("[friend-request] zod fail:", parsed.error.errors);
    res.status(400).json({ error: "بيانات غير صحيحة" }); return;
  }
  const { addresseeId } = parsed.data;
  const uid = req.userId!;

  if (addresseeId === uid) { res.status(400).json({ error: "لا يمكنك إضافة نفسك" }); return; }

  const existing = await db
    .select()
    .from(friendshipsTable)
    .where(or(
      and(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, addresseeId)),
      and(eq(friendshipsTable.requesterId, addresseeId), eq(friendshipsTable.addresseeId, uid)),
    ))
    .limit(1);

  if (existing.length > 0) { res.status(409).json({ error: "طلب موجود مسبقاً" }); return; }

  const [row] = await db
    .insert(friendshipsTable)
    .values({ requesterId: uid, addresseeId, status: "pending" })
    .returning();

  console.log("[friend-request] created row:", row?.id, "from", uid, "to", addresseeId);

  // ── Notify the addressee ─────────────────────────────────────────────────────
  try {
    const [sender] = await db
      .select({ username: usersTable.username, displayName: usersTable.displayName })
      .from(usersTable).where(eq(usersTable.id, uid)).limit(1);

    const senderName = sender?.displayName || sender?.username || "مستخدم";

    // Socket event
    const io = getIO();
    if (io) {
      io.to(`user:${addresseeId}`).emit("friend-request", { fromId: uid, fromName: senderName });
    }

    // Push notification
    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, addresseeId));

    const payload = JSON.stringify({
      title: `طلب صداقة جديد`,
      body: `${senderName} أرسل لك طلب صداقة`,
      icon: "/icon-192.svg",
      url: "/home?tab=friends",
      tag: `friend-req-${uid}`,
    });

    await Promise.allSettled(
      subs.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          console.log(`[FriendReq Push] Sent to userId=${sub.userId}`);
        } catch (err: any) {
          console.error(`[FriendReq Push] Failed userId=${sub.userId} status=${err.statusCode}`);
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
          }
        }
      })
    );
  } catch (e) {
    console.error("[FriendReq notify] error:", e);
  }

  res.json(row);
});

// ── Accept / decline ──────────────────────────────────────────────────────────
router.patch("/friends/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = z.object({ action: z.enum(["accepted", "rejected"]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "بيانات غير صحيحة" }); return; }
  const { action } = parsed.data;
  const uid = req.userId!;

  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(and(eq(friendshipsTable.id, id), eq(friendshipsTable.addresseeId, uid)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  if (action === "accepted") {
    await db.update(friendshipsTable).set({ status: "accepted" }).where(eq(friendshipsTable.id, id));

    // ── Notify the requester ─────────────────────────────────────────────────
    try {
      const [accepter] = await db
        .select({ username: usersTable.username, displayName: usersTable.displayName })
        .from(usersTable).where(eq(usersTable.id, uid)).limit(1);

      const accepterName = accepter?.displayName || accepter?.username || "مستخدم";

      // Real-time socket (if app is open)
      const io = getIO();
      if (io) {
        io.to(`user:${row.requesterId}`).emit("friend-accepted", {
          byId: uid,
          byName: accepterName,
        });
      }

      // Push notification (if app is closed / backgrounded)
      const subs = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.userId, row.requesterId));

      if (subs.length > 0) {
        const payload = JSON.stringify({
          title: "تم قبول طلب الصداقة! 🎉",
          body: `${accepterName} قبل طلب صداقتك`,
          icon: "/icon-192.svg",
          url: "/home?tab=friends",
          tag: `friend-accepted-${uid}`,
        });

        await Promise.allSettled(
          subs.map(async sub => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
              );
              console.log(`[FriendAccept Push] Sent to userId=${sub.userId}`);
            } catch (err: any) {
              console.error(`[FriendAccept Push] Failed userId=${sub.userId} status=${err?.statusCode}`);
              if (err?.statusCode === 410 || err?.statusCode === 404) {
                await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
              }
            }
          })
        );
      }
    } catch (e) {
      console.error("[FriendAccept notify] error:", e);
    }
  } else {
    await db.delete(friendshipsTable).where(eq(friendshipsTable.id, id));
  }
  res.json({ ok: true });
});

// ── Mute friend ───────────────────────────────────────────────────────────────
router.post("/friends/:friendId/mute", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const friendId = Number(req.params.friendId);
  const uid = req.userId!;
  await db
    .insert(mutedFriendsTable)
    .values({ userId: uid, friendId })
    .onConflictDoNothing();
  res.json({ ok: true });
});

// ── Unmute friend ─────────────────────────────────────────────────────────────
router.delete("/friends/:friendId/mute", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const friendId = Number(req.params.friendId);
  const uid = req.userId!;
  await db
    .delete(mutedFriendsTable)
    .where(and(eq(mutedFriendsTable.userId, uid), eq(mutedFriendsTable.friendId, friendId)));
  res.json({ ok: true });
});

// ── Remove friend ─────────────────────────────────────────────────────────────
router.delete("/friends/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const uid = req.userId!;

  await db
    .delete(friendshipsTable)
    .where(and(
      eq(friendshipsTable.id, id),
      or(eq(friendshipsTable.requesterId, uid), eq(friendshipsTable.addresseeId, uid))
    ));
  res.json({ ok: true });
});

export default router;
