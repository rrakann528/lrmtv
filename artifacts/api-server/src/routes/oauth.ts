import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { signToken } from "../middlewares/auth";

const router = Router();

function getPublicOrigin(req: any): string {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) return `https://${replitDomain}`;
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function getApiCallbackBase(req: any): string {
  return `${getPublicOrigin(req)}/api`;
}

function sendSuccessPage(res: any, token: string, redirectTo: string) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>جاري التوجيه...</title>
  <style>body{margin:0;background:#0D0D0E;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;color:#06B6D4;}</style>
</head>
<body>
  <div>جاري التوجيه...</div>
  <script>
    try {
      window.location.replace(${JSON.stringify(redirectTo)});
    } catch(e) {
      window.location.href = ${JSON.stringify(redirectTo)};
    }
  </script>
</body>
</html>`);
}

function sendErrorPage(res: any, errorKey: string, origin: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const dest = `${origin}/auth?error=${errorKey}`;
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>خطأ</title></head>
<body>
  <script>window.location.replace(${JSON.stringify(dest)});</script>
</body>
</html>`);
}

async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  profile: { email?: string; displayName?: string; avatarUrl?: string }
) {
  if (!providerId) throw new Error(`providerId is required for provider ${provider}`);

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.provider, provider), eq(usersTable.providerId, providerId)))
    .limit(1);

  if (existing) return existing;

  if (profile.email) {
    const [byEmail] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, profile.email))
      .limit(1);

    if (byEmail) {
      const [updated] = await db
        .update(usersTable)
        .set({ provider, providerId, emailVerified: true, avatarUrl: profile.avatarUrl || byEmail.avatarUrl })
        .where(eq(usersTable.id, byEmail.id))
        .returning();
      return updated;
    }
  }

  const baseUsername = (profile.email?.split("@")[0] || `user_${provider}`)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 28);

  let username = baseUsername;
  let attempt = 0;
  while (true) {
    const [taken] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
    if (!taken) break;
    attempt++;
    username = `${baseUsername}_${attempt}`;
    if (username.length > 32) {
      username = `u_${Date.now()}`.slice(0, 32);
      break;
    }
  }

  const colors = ["#06B6D4", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#EC4899"];
  const avatarColor = colors[Math.floor(Math.random() * colors.length)];

  const [newUser] = await db
    .insert(usersTable)
    .values({
      username,
      provider,
      providerId,
      displayName: profile.displayName?.slice(0, 40) || username,
      avatarUrl: profile.avatarUrl || null,
      email: profile.email || null,
      emailVerified: !!profile.email,
      avatarColor,
      passwordHash: null,
    })
    .returning();

  return newUser;
}

// ── Google OAuth ───────────────────────────────────────────────────────────────

router.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: "Google OAuth غير مُفعَّل" });
    return;
  }
  const callbackUrl = `${getApiCallbackBase(req)}/auth/google/callback`;
  console.log("[OAuth] Google redirect. callbackUrl:", callbackUrl);
  const client = new OAuth2Client(clientId, process.env.GOOGLE_CLIENT_SECRET, callbackUrl);
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, error } = req.query as Record<string, string>;
  const origin = getPublicOrigin(req);
  console.log("[OAuth] Google callback. origin:", origin, "error:", error, "hasCode:", !!code);

  if (error || !code) {
    sendErrorPage(res, "google_cancelled", origin);
    return;
  }

  try {
    const callbackUrl = `${getApiCallbackBase(req)}/auth/google/callback`;
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl
    );

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const userInfoRes = await client.request<{
      id: string;
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    }>({ url: "https://www.googleapis.com/oauth2/v2/userinfo" });

    const info = userInfoRes.data;
    const googleId = info.id || info.sub || "";
    console.log("[OAuth] Google user:", info.email, "id:", googleId);

    if (!googleId) throw new Error("Could not get Google user ID");

    const user = await findOrCreateOAuthUser("google", googleId, {
      email: info.email,
      displayName: info.name,
      avatarUrl: info.picture,
    });

    const token = signToken(user.id, user.username);
    console.log("[OAuth] Success. userId:", user.id, "redirecting to:", `${origin}/home`);
    sendSuccessPage(res, token, `${origin}/home`);
  } catch (err) {
    console.error("[OAuth] Google error:", err);
    sendErrorPage(res, "google_failed", origin);
  }
});

export default router;
