import { Router } from "express";
import { db, reportsTable, usersTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, requireSiteAdmin, type AuthRequest } from "../middlewares/auth";
import { kickUserFromAllRooms, siteMuteUser } from "../lib/socket";

const router = Router();

const VALID_REASONS = ["spam", "abuse", "inappropriate", "harassment", "other"] as const;

// ── Submit a report (any authenticated user) ─────────────────────────────────
router.post("/reports", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { messageId, messageContent, reportedUsername, roomSlug, reason } = req.body as {
      messageId?: number;
      messageContent?: string;
      reportedUsername: string;
      roomSlug?: string;
      reason?: string;
    };

    if (!reportedUsername?.trim()) {
      res.status(400).json({ error: "reportedUsername مطلوب" });
      return;
    }
    if (req.username === reportedUsername) {
      res.status(400).json({ error: "لا يمكنك الإبلاغ عن نفسك" });
      return;
    }

    const safeReason = VALID_REASONS.includes(reason as any) ? reason! : "other";

    await db.insert(reportsTable).values({
      messageId: messageId ?? null,
      messageContent: String(messageContent || "").slice(0, 1000),
      reportedUsername: reportedUsername.trim(),
      reporterUsername: req.username!,
      roomSlug: roomSlug?.trim() || null,
      reason: safeReason,
      status: "pending",
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error("[reports] POST error:", e.message);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ── Get all reports (admin only) ─────────────────────────────────────────────
router.get("/admin/reports", requireSiteAdmin, async (req: AuthRequest, res) => {
  try {
    const status = (req.query.status as string) || "pending";
    const whereClause = status === "all"
      ? undefined
      : eq(reportsTable.status, status);

    const rows = whereClause
      ? await db.select().from(reportsTable).where(whereClause).orderBy(desc(reportsTable.createdAt)).limit(200)
      : await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt)).limit(200);

    res.json(rows);
  } catch (e: any) {
    console.error("[reports] GET admin error:", e.message);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ── Review a report (admin: dismiss | ban | kick) ────────────────────────────
router.patch("/admin/reports/:id", requireSiteAdmin, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { action } = req.body as { action: "dismiss" | "ban" | "kick" | "mute" };

    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id)).limit(1);
    if (!report) { res.status(404).json({ error: "البلاغ غير موجود" }); return; }

    const [targetUser] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.username, report.reportedUsername)).limit(1);

    if (targetUser) {
      if (action === "ban") {
        await db.update(usersTable).set({ isBanned: true }).where(eq(usersTable.id, targetUser.id));
        kickUserFromAllRooms(targetUser.id);
      } else if (action === "kick") {
        kickUserFromAllRooms(targetUser.id);
      } else if (action === "mute") {
        siteMuteUser(targetUser.id, true);
      }
    }

    await db.update(reportsTable).set({
      status: action === "dismiss" ? "dismissed" : "resolved",
      reviewedBy: req.username!,
      reviewedAt: new Date(),
    }).where(eq(reportsTable.id, id));

    res.json({ ok: true });
  } catch (e: any) {
    console.error("[reports] PATCH admin error:", e.message);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ── Delete a report (admin) ───────────────────────────────────────────────────
router.delete("/admin/reports/:id", requireSiteAdmin, async (_req, res) => {
  try {
    const id = Number(_req.params.id);
    await db.delete(reportsTable).where(eq(reportsTable.id, id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

export default router;
