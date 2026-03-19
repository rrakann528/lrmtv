import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db, usersTable, loginAttemptsTable, pool } from "@workspace/db";
import { requireAuth, signToken, type AuthRequest } from "../middlewares/auth";
import { z } from "zod";
import { sendOtpEmail, verifySmtp } from "../lib/email";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `avatar-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedExt.includes(ext) && allowedMime.includes(file.mimetype));
  },
});

const router: IRouter = Router();

const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

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
    isSiteAdmin: u.isSiteAdmin,
    isBanned: u.isBanned,
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
    res.cookie("token", token, COOKIE_OPTS);
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

  const clientIp = (req as any).ip || "";
  if (!user) {
    await db.insert(loginAttemptsTable).values({ identifier: email || username || "", ip: clientIp, success: false }).catch(() => {});
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }); return;
  }
  if (!user.passwordHash) {
    res.status(401).json({ error: "هذا الحساب مرتبط بـ Google، سجّل دخولك بـ Google" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await db.insert(loginAttemptsTable).values({ identifier: user.username, ip: clientIp, success: false }).catch(() => {});
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }); return;
  }

  if (user.isBanned) { res.status(403).json({ error: "تم حظر هذا الحساب. تواصل مع الإدارة." }); return; }

  // Auto-grant site admin if email matches ADMIN_EMAIL env var
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (adminEmail && user.email?.toLowerCase() === adminEmail && !user.isSiteAdmin) {
    await db.update(usersTable).set({ isSiteAdmin: true }).where(eq(usersTable.id, user.id));
    user = { ...user, isSiteAdmin: true };
  }

  const token = signToken(user.id, user.username);
  res.cookie("token", token, COOKIE_OPTS);
  res.json({ ...userPublic(user), token });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/auth/logout", (_req, res): void => {
  res.clearCookie("token", { path: '/', sameSite: 'lax', httpOnly: true });
  res.json({ ok: true });
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }

  // Auto-grant admin if ADMIN_EMAIL matches and not already admin
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (adminEmail && user.email?.toLowerCase() === adminEmail && !user.isSiteAdmin) {
    await db.update(usersTable).set({ isSiteAdmin: true }).where(eq(usersTable.id, user.id));
    user = { ...user, isSiteAdmin: true };
  }

  const freshToken = signToken(user.id, user.username);
  res.cookie("token", freshToken, COOKIE_OPTS);
  res.json({ ...userPublic(user), token: freshToken });
});

// ── SMTP health check (admin only) ────────────────────────────────────────────
router.get("/auth/smtp-check", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user?.isSiteAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await verifySmtp();
  res.json({ ...result, port: process.env.SMTP_PORT || "587(default)", host: process.env.SMTP_HOST || "smtp.hostinger.com(default)" });
});

// ── Send OTP ──────────────────────────────────────────────────────────────────
router.post("/auth/send-otp", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    if (!user.email) { res.status(400).json({ error: "لا يوجد بريد إلكتروني مرتبط بالحساب" }); return; }
    if (user.emailVerified) { res.json({ ok: true, alreadyVerified: true }); return; }

    // Rate limit: max 3 OTPs per email per 10 minutes
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM email_otps WHERE email=$1 AND created_at > NOW() - INTERVAL '10 minutes'`,
      [user.email]
    );
    if (parseInt(rows[0].count) >= 3) {
      res.status(429).json({ error: "أرسلنا عدة رموز مؤخراً، انتظر 10 دقائق" }); return;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query(
      `INSERT INTO email_otps (email, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [user.email, code]
    );

    // Fire-and-forget — don't block the response on SMTP
    sendOtpEmail(user.email, code).catch((err: any) =>
      console.error("[send-otp] SMTP error:", err?.message || err)
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[send-otp]", err?.message || err);
    res.status(500).json({ error: "فشل إرسال البريد، تحقق من إعدادات SMTP" });
  }
});

// ── Verify OTP ────────────────────────────────────────────────────────────────
router.post("/auth/verify-otp", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') { res.status(400).json({ error: "الرمز مطلوب" }); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
    if (!user.email) { res.status(400).json({ error: "لا يوجد بريد إلكتروني" }); return; }
    if (user.emailVerified) { res.json({ ok: true }); return; }

    const { rows } = await pool.query(
      `SELECT id FROM email_otps WHERE email=$1 AND code=$2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [user.email, code.trim()]
    );
    if (rows.length === 0) {
      res.status(400).json({ error: "الرمز غير صحيح أو انتهت صلاحيته" }); return;
    }

    await pool.query(`DELETE FROM email_otps WHERE email=$1`, [user.email]);
    await db.update(usersTable).set({ emailVerified: true }).where(eq(usersTable.id, user.id));

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[verify-otp]", err?.message || err);
    res.status(500).json({ error: "خطأ داخلي" });
  }
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

router.post("/auth/avatar-upload", requireAuth, avatarUpload.single("file"), async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file" }); return; }
    const avatarUrl = `/api/uploads/${req.file.filename}`;
    const [updated] = await db.update(usersTable)
      .set({ avatarUrl })
      .where(eq(usersTable.id, req.userId!))
      .returning();
    res.json(userPublic(updated));
  } catch (err) {
    console.error("[avatar-upload]", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
