import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requireAuth, signToken, type AuthRequest } from "../middlewares/auth";
import { z } from "zod";

const router: IRouter = Router();

function userPublic(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl,
    email: u.email,
    emailVerified: u.emailVerified,
    provider: u.provider,
  };
}

// ── Register ───────────────────────────────────────────────────────────────────
const RegisterBody = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\u0600-\u06FF]+$/, "اسم مستخدم غير صالح"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(6, "كلمة المرور 6 أحرف على الأقل").max(64),
  displayName: z.string().max(40).optional(),
});

router.post("/auth/register", async (req, res): Promise<void> => {
  try {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || "بيانات غير صحيحة" });
      return;
    }
    const { username, email, password, displayName } = parsed.data;

    const [byUsername] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
    if (byUsername) { res.status(409).json({ error: "اسم المستخدم محجوز" }); return; }

    const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (byEmail) { res.status(409).json({ error: "البريد الإلكتروني مستخدم مسبقاً" }); return; }

    const passwordHash = await bcrypt.hash(password, 10);
    const colors = ["#06B6D4", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#EC4899"];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const [user] = await db.insert(usersTable).values({
      username,
      email,
      passwordHash,
      displayName: displayName || username,
      avatarColor,
      provider: "local",
      emailVerified: false,
    }).returning();

    const token = signToken(user.id, user.username);
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
    res.status(201).json({ ...userPublic(user), token });
  } catch (err: any) {
    console.error("[register]", err?.message || err);
    res.status(500).json({ error: err?.message || "خطأ داخلي في الخادم" });
  }
});

// ── Login ──────────────────────────────────────────────────────────────────────
// Accepts email OR username
const LoginBody = z.object({
  email:    z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1),
}).refine(d => d.email || d.username, { message: "يجب إدخال البريد أو اسم المستخدم" });

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message || "بيانات غير صحيحة" }); return; }
  const { email, username, password } = parsed.data;

  let user: typeof usersTable.$inferSelect | undefined;
  if (email && email.trim()) {
    // Try email first (exact match)
    const [byEmail] = await db.select().from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
    user = byEmail;
    // Fallback: maybe they typed their username in the email field
    if (!user) {
      const [byUsername] = await db.select().from(usersTable)
        .where(eq(usersTable.username, email.trim())).limit(1);
      user = byUsername;
    }
  } else if (username && username.trim()) {
    const [byUsername] = await db.select().from(usersTable)
      .where(eq(usersTable.username, username.trim())).limit(1);
    user = byUsername;
  }

  if (!user) { res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }); return; }
  if (!user.passwordHash) {
    res.status(401).json({ error: "هذا الحساب مرتبط بـ Google، سجّل دخولك بـ Google" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }); return; }

  const token = signToken(user.id, user.username);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
  res.json({ ...userPublic(user), token });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/auth/logout", (_req, res): void => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  const freshToken = signToken(user.id, user.username);
  res.cookie("token", freshToken, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
  res.json({ ...userPublic(user), token: freshToken });
});

// ── Update Profile ────────────────────────────────────────────────────────────
const ProfileBody = z.object({
  displayName: z.string().max(40).optional(),
  bio: z.string().max(160).optional(),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  avatarUrl: z.string().url().max(512).optional().or(z.literal("")),
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\u0600-\u06FF]+$/).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).max(64).optional(),
});

router.patch("/auth/profile", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "بيانات غير صحيحة" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  const { displayName, bio, avatarColor, avatarUrl, username, currentPassword, newPassword } = parsed.data;

  if (username && username !== user.username) {
    const taken = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
    if (taken.length > 0) { res.status(409).json({ error: "اسم المستخدم محجوز" }); return; }
  }

  let passwordHash: string | undefined;
  if (newPassword) {
    if (!user.passwordHash) {
      res.status(400).json({ error: "حسابك مرتبط بـ Google ولا يمكن تغيير كلمة المرور" });
      return;
    }
    if (!currentPassword) { res.status(400).json({ error: "أدخل كلمة المرور الحالية" }); return; }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" }); return; }
    passwordHash = await bcrypt.hash(newPassword, 10);
  }

  const updates: Partial<typeof usersTable.$inferSelect> = {};
  if (displayName !== undefined) updates.displayName = displayName || null;
  if (bio !== undefined) updates.bio = bio || null;
  if (avatarColor) updates.avatarColor = avatarColor;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl || null;
  if (username) updates.username = username;
  if (passwordHash) updates.passwordHash = passwordHash;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!)).returning();
  res.json(userPublic(updated));
});

export default router;
