import { Router } from "express";
import { db, pool, groupsTable, groupMembersTable, groupMessagesTable, groupInvitationsTable, usersTable, pushSubscriptionsTable } from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, ilike, not } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { applyWordFilter } from "../lib/socket";
import webpush from "web-push";

const router = Router();

router.get("/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const myGroups = await db
      .select({
        id: groupsTable.id,
        name: groupsTable.name,
        description: groupsTable.description,
        avatarColor: groupsTable.avatarColor,
        creatorId: groupsTable.creatorId,
        isPrivate: groupsTable.isPrivate,
        createdAt: groupsTable.createdAt,
        role: groupMembersTable.role,
      })
      .from(groupMembersTable)
      .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
      .where(eq(groupMembersTable.userId, userId))
      .orderBy(desc(groupsTable.createdAt));

    const groupIds = myGroups.map(g => g.id);
    let memberCounts: Record<number, number> = {};
    if (groupIds.length > 0) {
      const counts = await db
        .select({
          groupId: groupMembersTable.groupId,
          count: sql<number>`count(*)::int`,
        })
        .from(groupMembersTable)
        .where(inArray(groupMembersTable.groupId, groupIds))
        .groupBy(groupMembersTable.groupId);
      memberCounts = Object.fromEntries(counts.map(c => [c.groupId, c.count]));
    }

    res.json(myGroups.map(g => ({
      ...g,
      memberCount: memberCounts[g.id] || 0,
    })));
  } catch (err: any) {
    console.error("[groups] list error:", err.message);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

// ── Groups badge (unread count for bottom nav) ────────────────────────────────
router.get("/groups/badge", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const myGroups = await db.select({ id: groupMembersTable.groupId })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.userId, userId));

    if (myGroups.length === 0) { res.json({ count: 0 }); return; }

    const groupIds = myGroups.map(g => g.id);
    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT group_id)::int as count
       FROM group_messages
       WHERE group_id = ANY($1) AND sender_id != $2 AND created_at > $3`,
      [groupIds, userId, since]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (err: any) {
    console.error("[groups] badge error:", err.message);
    res.json({ count: 0 });
  }
});

router.post("/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { name, description, avatarColor, isPrivate } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1 || name.trim().length > 60) {
      res.status(400).json({ error: "Group name is required (1-60 chars)" });
      return;
    }

    const isPublicGroup = isPrivate === false;
    const values: any = {
      name: isPublicGroup ? applyWordFilter(name.trim()) : name.trim(),
      description: description?.trim()?.slice(0, 200) || null,
      creatorId: userId,
      isPrivate: !isPublicGroup,
    };
    if (avatarColor && /^#[0-9A-Fa-f]{6}$/.test(avatarColor)) {
      values.avatarColor = avatarColor;
    }

    const [group] = await db.insert(groupsTable).values(values).returning();

    await db.insert(groupMembersTable).values({
      groupId: group.id,
      userId,
      role: "admin",
    });

    res.json({ ...group, role: "admin", memberCount: 1 });
  } catch (err: any) {
    console.error("[groups] create error:", err.message);
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.get("/groups/public", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const conditions = [eq(groupsTable.isPrivate, false)];
    if (search) {
      conditions.push(ilike(groupsTable.name, `%${search}%`));
    }

    const publicGroups = await db
      .select({
        id: groupsTable.id,
        name: groupsTable.name,
        description: groupsTable.description,
        avatarColor: groupsTable.avatarColor,
        creatorId: groupsTable.creatorId,
        isPrivate: groupsTable.isPrivate,
        createdAt: groupsTable.createdAt,
      })
      .from(groupsTable)
      .where(and(...conditions))
      .orderBy(desc(groupsTable.createdAt))
      .limit(50);

    const groupIds = publicGroups.map(g => g.id);
    let memberCounts: Record<number, number> = {};
    let myMemberships = new Set<number>();

    if (groupIds.length > 0) {
      const counts = await db
        .select({ groupId: groupMembersTable.groupId, count: sql<number>`count(*)::int` })
        .from(groupMembersTable)
        .where(inArray(groupMembersTable.groupId, groupIds))
        .groupBy(groupMembersTable.groupId);
      memberCounts = Object.fromEntries(counts.map(c => [c.groupId, c.count]));

      const myRows = await db
        .select({ groupId: groupMembersTable.groupId })
        .from(groupMembersTable)
        .where(and(inArray(groupMembersTable.groupId, groupIds), eq(groupMembersTable.userId, userId)));
      myMemberships = new Set(myRows.map(r => r.groupId));
    }

    res.json(publicGroups.map(g => ({
      ...g,
      memberCount: memberCounts[g.id] || 0,
      isMember: myMemberships.has(g.id),
    })));
  } catch (err: any) {
    console.error("[groups] public list error:", err.message);
    res.status(500).json({ error: "Failed to fetch public groups" });
  }
});

router.post("/groups/:id/join", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    if (group.isPrivate) { res.status(403).json({ error: "Cannot join private group" }); return; }

    const [existing] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (existing) { res.status(400).json({ error: "Already a member" }); return; }

    await db.insert(groupMembersTable).values({ groupId, userId, role: "member" });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[groups] join error:", err.message);
    res.status(500).json({ error: "Failed to join group" });
  }
});

router.get("/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }

    const members = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarColor: usersTable.avatarColor,
        avatarUrl: usersTable.avatarUrl,
        role: groupMembersTable.role,
        joinedAt: groupMembersTable.joinedAt,
      })
      .from(groupMembersTable)
      .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
      .where(eq(groupMembersTable.groupId, groupId))
      .orderBy(groupMembersTable.joinedAt);

    res.json({ ...group, myRole: membership.role, members });
  } catch (err: any) {
    console.error("[groups] detail error:", err.message);
    res.status(500).json({ error: "Failed to fetch group" });
  }
});

async function sendGroupPush(recipientId: number, payload: object) {
  try {
    const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, recipientId));
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }
  } catch {}
}

router.post("/groups/:id/invite", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can invite" });
      return;
    }

    const friendId = typeof req.body.friendId === 'number' ? req.body.friendId : parseInt(req.body.friendId);
    if (!friendId || isNaN(friendId) || friendId <= 0) { res.status(400).json({ error: "Valid friendId required" }); return; }

    const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, friendId)).limit(1);
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

    const [existingMember] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, friendId)))
      .limit(1);
    if (existingMember) { res.status(400).json({ error: "Already a member" }); return; }

    const [existingInvite] = await db.select().from(groupInvitationsTable)
      .where(and(
        eq(groupInvitationsTable.groupId, groupId),
        eq(groupInvitationsTable.inviteeId, friendId),
        eq(groupInvitationsTable.status, "pending"),
      ))
      .limit(1);
    if (existingInvite) { res.status(409).json({ error: "Invite already sent" }); return; }

    await db.delete(groupInvitationsTable).where(and(
      eq(groupInvitationsTable.groupId, groupId),
      eq(groupInvitationsTable.inviteeId, friendId),
    ));

    let inv;
    try {
      [inv] = await db.insert(groupInvitationsTable).values({
        groupId,
        inviterId: userId,
        inviteeId: friendId,
      }).returning();
    } catch (insertErr: any) {
      if (insertErr.code === '23505') { res.status(409).json({ error: "Invite already sent" }); return; }
      throw insertErr;
    }

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    const [inviter] = await db.select({ displayName: usersTable.displayName, username: usersTable.username })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    const { getIO } = await import("../lib/socket");
    const io = getIO();
    if (io) {
      io.to(`user:${friendId}`).emit("group:invite", {
        id: inv.id,
        groupId,
        groupName: group?.name || '',
        groupAvatarColor: group?.avatarColor || '#8B5CF6',
        inviterName: inviter?.displayName || inviter?.username || '',
      });
    }

    sendGroupPush(friendId, {
      title: `دعوة مجموعة 👥`,
      body: `${inviter?.displayName || inviter?.username} دعاك للانضمام إلى "${group?.name}"`,
      tag: `group-invite-${groupId}`,
      url: '/home',
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error("[groups] invite error:", err.message);
    res.status(500).json({ error: "Failed to send invite" });
  }
});

router.get("/group-invitations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const invites = await db
      .select({
        id: groupInvitationsTable.id,
        groupId: groupInvitationsTable.groupId,
        inviterId: groupInvitationsTable.inviterId,
        status: groupInvitationsTable.status,
        createdAt: groupInvitationsTable.createdAt,
        groupName: groupsTable.name,
        groupAvatarColor: groupsTable.avatarColor,
        inviterUsername: usersTable.username,
        inviterDisplayName: usersTable.displayName,
        inviterAvatarColor: usersTable.avatarColor,
        inviterAvatarUrl: usersTable.avatarUrl,
      })
      .from(groupInvitationsTable)
      .innerJoin(groupsTable, eq(groupInvitationsTable.groupId, groupsTable.id))
      .innerJoin(usersTable, eq(groupInvitationsTable.inviterId, usersTable.id))
      .where(and(eq(groupInvitationsTable.inviteeId, userId), eq(groupInvitationsTable.status, "pending")))
      .orderBy(desc(groupInvitationsTable.createdAt));

    res.json(invites);
  } catch (err: any) {
    console.error("[groups] list invitations error:", err.message);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

router.post("/group-invitations/:id/accept", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const invId = parseInt(req.params.id as string);
    if (isNaN(invId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [inv] = await db.select().from(groupInvitationsTable)
      .where(and(eq(groupInvitationsTable.id, invId), eq(groupInvitationsTable.inviteeId, userId)))
      .limit(1);
    if (!inv || inv.status !== "pending") { res.status(404).json({ error: "Invitation not found" }); return; }

    const [existingMember] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, inv.groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (existingMember) {
      await db.update(groupInvitationsTable).set({ status: "accepted" }).where(eq(groupInvitationsTable.id, invId));
      res.json({ success: true });
      return;
    }

    await db.insert(groupMembersTable).values({
      groupId: inv.groupId,
      userId,
      role: "member",
    });

    await db.update(groupInvitationsTable).set({ status: "accepted" }).where(eq(groupInvitationsTable.id, invId));

    res.json({ success: true, groupId: inv.groupId });
  } catch (err: any) {
    console.error("[groups] accept invitation error:", err.message);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
});

router.post("/group-invitations/:id/reject", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const invId = parseInt(req.params.id as string);
    if (isNaN(invId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [inv] = await db.select().from(groupInvitationsTable)
      .where(and(eq(groupInvitationsTable.id, invId), eq(groupInvitationsTable.inviteeId, userId)))
      .limit(1);
    if (!inv || inv.status !== "pending") { res.status(404).json({ error: "Invitation not found" }); return; }

    await db.update(groupInvitationsTable).set({ status: "rejected" }).where(eq(groupInvitationsTable.id, invId));
    res.json({ success: true });
  } catch (err: any) {
    console.error("[groups] reject invitation error:", err.message);
    res.status(500).json({ error: "Failed to reject invitation" });
  }
});

router.post("/groups/:id/members", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can add members" });
      return;
    }

    const { username } = req.body;
    if (!username) { res.status(400).json({ error: "Username required" }); return; }

    const [target] = await db.select().from(usersTable)
      .where(eq(usersTable.username, username.replace('@', '').trim()))
      .limit(1);
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const [existing] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, target.id)))
      .limit(1);
    if (existing) { res.status(400).json({ error: "Already a member" }); return; }

    await db.insert(groupMembersTable).values({
      groupId,
      userId: target.id,
      role: "member",
    });

    res.json({ success: true, user: { id: target.id, username: target.username, displayName: target.displayName, avatarColor: target.avatarColor, avatarUrl: target.avatarUrl, role: "member" } });
  } catch (err: any) {
    console.error("[groups] add member error:", err.message);
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.delete("/groups/:id/members/:userId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const myId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    const targetUserId = parseInt(req.params.userId as string);
    if (isNaN(groupId) || isNaN(targetUserId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, myId)))
      .limit(1);

    const isSelf = myId === targetUserId;
    if (!isSelf && (!membership || membership.role !== "admin")) {
      res.status(403).json({ error: "Only admins can remove members" });
      return;
    }

    await db.delete(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, targetUserId)));

    const remaining = await db.select().from(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
    if (remaining.length === 0) {
      await db.delete(groupsTable).where(eq(groupsTable.id, groupId));
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[groups] remove member error:", err.message);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

router.delete("/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    if (group.creatorId !== userId) { res.status(403).json({ error: "Only the creator can delete the group" }); return; }

    await db.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
    await db.delete(groupsTable).where(eq(groupsTable.id, groupId));

    res.json({ success: true });
  } catch (err: any) {
    console.error("[groups] delete error:", err.message);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

router.put("/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can edit the group" });
      return;
    }

    const { name, description, avatarColor, isPrivate } = req.body;
    const updates: any = {};
    if (name) updates.name = name.trim().slice(0, 60);
    if (description !== undefined) updates.description = description?.trim()?.slice(0, 200) || null;
    if (avatarColor) updates.avatarColor = avatarColor;
    if (typeof isPrivate === 'boolean') updates.isPrivate = isPrivate;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updates" });
      return;
    }

    const [updated] = await db.update(groupsTable).set(updates).where(eq(groupsTable.id, groupId)).returning();
    res.json(updated);
  } catch (err: any) {
    console.error("[groups] update error:", err.message);
    res.status(500).json({ error: "Failed to update group" });
  }
});

router.post("/groups/:id/invite-room", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const { roomSlug, roomName } = req.body;
    if (!roomSlug || !roomName) { res.status(400).json({ error: "roomSlug and roomName required" }); return; }

    const members = await db.select({ userId: groupMembersTable.userId }).from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, groupId));

    const { roomInvitesTable } = await import("@workspace/db");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let inviteCount = 0;
    for (const m of members) {
      if (m.userId === userId) continue;
      try {
        await db.insert(roomInvitesTable).values({
          senderId: userId,
          receiverId: m.userId,
          roomSlug,
          roomName,
          status: "pending",
          expiresAt,
        });
        inviteCount++;
      } catch {}
    }

    res.json({ success: true, invited: inviteCount });
  } catch (err: any) {
    console.error("[groups] invite-room error:", err.message);
    res.status(500).json({ error: "Failed to invite group" });
  }
});

router.get("/groups/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const msgs = await db
      .select({
        id: groupMessagesTable.id,
        groupId: groupMessagesTable.groupId,
        senderId: groupMessagesTable.senderId,
        content: groupMessagesTable.content,
        replyToId: groupMessagesTable.replyToId,
        replyToContent: groupMessagesTable.replyToContent,
        replyToSenderName: groupMessagesTable.replyToSenderName,
        isEdited: groupMessagesTable.isEdited,
        editedAt: groupMessagesTable.editedAt,
        createdAt: groupMessagesTable.createdAt,
        senderUsername: usersTable.username,
        senderDisplayName: usersTable.displayName,
        senderAvatarColor: usersTable.avatarColor,
        senderAvatarUrl: usersTable.avatarUrl,
      })
      .from(groupMessagesTable)
      .innerJoin(usersTable, eq(groupMessagesTable.senderId, usersTable.id))
      .where(eq(groupMessagesTable.groupId, groupId))
      .orderBy(asc(groupMessagesTable.createdAt))
      .limit(200);

    res.json(msgs);
  } catch (err: any) {
    console.error("[groups] messages error:", err.message);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/groups/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const { content, replyToId, replyToContent, replyToSenderName } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0 || content.length > 1000) {
      res.status(400).json({ error: "Content required (max 1000 chars)" });
      return;
    }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const [groupInfo] = await db.select({ isPrivate: groupsTable.isPrivate })
      .from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    const filteredContent = groupInfo?.isPrivate ? content.trim() : applyWordFilter(content.trim());

    const [msg] = await db.insert(groupMessagesTable).values({
      groupId,
      senderId: userId,
      content: filteredContent,
      replyToId: replyToId ?? null,
      replyToContent: typeof replyToContent === 'string' ? replyToContent.slice(0, 200) : null,
      replyToSenderName: typeof replyToSenderName === 'string' ? replyToSenderName.slice(0, 100) : null,
    }).returning();

    const [sender] = await db.select({
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarColor: usersTable.avatarColor,
      avatarUrl: usersTable.avatarUrl,
    }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    const fullMsg = {
      ...msg,
      senderUsername: sender?.username,
      senderDisplayName: sender?.displayName,
      senderAvatarColor: sender?.avatarColor,
      senderAvatarUrl: sender?.avatarUrl,
    };

    const { getIO } = await import("../lib/socket");
    const io = getIO();
    const members = await db.select({ userId: groupMembersTable.userId })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, groupId));
    const [group] = await db.select({ name: groupsTable.name }).from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);

    for (const m of members) {
      if (m.userId === userId) continue;
      if (io) {
        io.to(`user:${m.userId}`).emit("group:message", fullMsg);
      }
      sendGroupPush(m.userId, {
        title: `${group?.name || 'مجموعة'}`,
        body: `${sender?.displayName || sender?.username}: ${content.trim().slice(0, 80)}`,
        tag: `group-msg-${groupId}`,
        url: '/home',
      });
    }

    // ── @mention detection ────────────────────────────────────────────────────
    const mentionMatches = content.trim().match(/@([a-zA-Z0-9_]+)/g) || [];
    if (mentionMatches.length > 0 && io) {
      const mentionedUsernames = [...new Set(mentionMatches.map((m: string) => m.slice(1).toLowerCase()))];
      const mentionedUsers = await db.select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(inArray(usersTable.username, mentionedUsernames));
      for (const mu of mentionedUsers) {
        if (mu.id === userId) continue;
        const isMember = members.find(m => m.userId === mu.id);
        if (!isMember) continue;
        io.to(`user:${mu.id}`).emit("group:mention", {
          groupId,
          groupName: group?.name || 'مجموعة',
          fromUser: sender?.displayName || sender?.username || 'شخص ما',
          content: content.trim().slice(0, 80),
        });
      }
    }

    res.status(201).json(fullMsg);
  } catch (err: any) {
    console.error("[groups] send message error:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/groups/:id/messages/:messageId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    const messageId = parseInt(req.params.messageId as string);
    if (isNaN(groupId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [msg] = await db.select().from(groupMessagesTable)
      .where(and(eq(groupMessagesTable.id, messageId), eq(groupMessagesTable.groupId, groupId)))
      .limit(1);
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.senderId !== userId) {
      const [membership] = await db.select().from(groupMembersTable)
        .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
        .limit(1);
      if (!membership || membership.role !== 'admin') { res.status(403).json({ error: "Not allowed" }); return; }
    }

    await db.delete(groupMessagesTable).where(eq(groupMessagesTable.id, messageId));

    const { getIO } = await import("../lib/socket");
    const io = getIO();
    if (io) {
      const members = await db.select({ userId: groupMembersTable.userId })
        .from(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:message-deleted", { groupId, messageId });
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[groups] delete message error:", err.message);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ── Edit group message ────────────────────────────────────────────────────────
router.patch("/groups/:id/messages/:messageId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    const messageId = parseInt(req.params.messageId as string);
    if (isNaN(groupId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim() || content.length > 1000) {
      res.status(400).json({ error: "Content required" }); return;
    }

    const [msg] = await db.select().from(groupMessagesTable)
      .where(and(eq(groupMessagesTable.id, messageId), eq(groupMessagesTable.groupId, groupId)))
      .limit(1);
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (msg.senderId !== userId) { res.status(403).json({ error: "Not allowed" }); return; }

    const [updated] = await db.update(groupMessagesTable)
      .set({ content: content.trim(), isEdited: true, editedAt: new Date() })
      .where(eq(groupMessagesTable.id, messageId))
      .returning();

    const { getIO } = await import("../lib/socket");
    const io = getIO();
    if (io) {
      const members = await db.select({ userId: groupMembersTable.userId })
        .from(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:message-edited", { groupId, messageId, content: updated.content, isEdited: true });
      }
    }

    res.json({ ok: true, message: updated });
  } catch (err: any) {
    console.error("[groups] edit message error:", err.message);
    res.status(500).json({ error: "Failed to edit" });
  }
});

// ── React to group message ────────────────────────────────────────────────────
router.post("/groups/:id/messages/:messageId/react", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id as string);
    const messageId = parseInt(req.params.messageId as string);
    if (isNaN(groupId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { emoji } = req.body;
    if (!emoji || typeof emoji !== 'string' || emoji.length > 10) { res.status(400).json({ error: "Emoji required" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId))).limit(1);
    if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

    const { rows: existing } = await pool.query(
      `SELECT id FROM message_reactions WHERE message_type='group' AND message_id=$1 AND user_id=$2 AND emoji=$3`,
      [messageId, userId, emoji]
    );
    if (existing.length > 0) {
      await pool.query(`DELETE FROM message_reactions WHERE id=$1`, [existing[0].id]);
    } else {
      await pool.query(
        `INSERT INTO message_reactions (message_type, message_id, user_id, emoji) VALUES ('group',$1,$2,$3) ON CONFLICT DO NOTHING`,
        [messageId, userId, emoji]
      );
    }

    const { rows: reactions } = await pool.query(
      `SELECT emoji, user_id as "userId" FROM message_reactions WHERE message_type='group' AND message_id=$1`,
      [messageId]
    );

    const { getIO } = await import("../lib/socket");
    const io = getIO();
    if (io) {
      const members = await db.select({ userId: groupMembersTable.userId })
        .from(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:reaction", { groupId, messageId, reactions });
      }
    }

    res.json({ ok: true, reactions });
  } catch (err: any) {
    console.error("[groups] react error:", err.message);
    res.status(500).json({ error: "Failed to react" });
  }
});

export default router;
