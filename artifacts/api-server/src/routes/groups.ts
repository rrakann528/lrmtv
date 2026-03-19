import { Router } from "express";
import { db, groupsTable, groupMembersTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

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

router.post("/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { name, description, avatarColor } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1 || name.trim().length > 60) {
      res.status(400).json({ error: "Group name is required (1-60 chars)" });
      return;
    }

    const values: any = {
      name: name.trim(),
      description: description?.trim()?.slice(0, 200) || null,
      creatorId: userId,
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

router.get("/groups/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id);
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

router.post("/groups/:id/members", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const groupId = parseInt(req.params.id);
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
    const groupId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
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
    const groupId = parseInt(req.params.id);
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
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [membership] = await db.select().from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
      .limit(1);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can edit the group" });
      return;
    }

    const { name, description, avatarColor } = req.body;
    const updates: any = {};
    if (name) updates.name = name.trim().slice(0, 60);
    if (description !== undefined) updates.description = description?.trim()?.slice(0, 200) || null;
    if (avatarColor) updates.avatarColor = avatarColor;

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
    const groupId = parseInt(req.params.id);
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

export default router;
