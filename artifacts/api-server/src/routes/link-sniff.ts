import { Router, type IRouter, type Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import * as dns from "dns/promises";
import * as net from "net";
import { db, roomsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { sniffVideoUrls } from "../lib/link-sniffer";
import { isUserDjInRoom } from "../lib/socket";

function isPrivateIpAddr(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    if (ip === "255.255.255.255") return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower === "::") return true;
    return false;
  }
  return false;
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost") return true;
  return isPrivateIpAddr(hostname);
}

async function resolvedToPrivate(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true;
  if (net.isIP(hostname)) return isPrivateIpAddr(hostname);
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];
    if (all.length === 0) return false;
    return all.some(isPrivateIpAddr);
  } catch {
    return false;
  }
}

const router: IRouter = Router();

const sniffLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { error: "عدد المحاولات كثير — انتظر دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/link-sniff",
  sniffLimiter,
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { url, roomSlug } = req.body as { url?: string; roomSlug?: string };

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "الرابط مطلوب" });
      return;
    }

    if (!roomSlug || typeof roomSlug !== "string") {
      res.status(400).json({ error: "roomSlug مطلوب" });
      return;
    }

    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }

    let isAuthorized = isUserDjInRoom(roomSlug, userId);

    if (!isAuthorized) {
      const [room] = await db
        .select({ creatorUserId: roomsTable.creatorUserId })
        .from(roomsTable)
        .where(eq(roomsTable.slug, roomSlug))
        .limit(1);
      if (room && room.creatorUserId === userId) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      res.status(403).json({ error: "فقط الـ DJ أو المسؤول يمكنه استخدام الاستخراج" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "رابط غير صالح" });
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: "يجب أن يبدأ الرابط بـ http أو https" });
      return;
    }

    if (await resolvedToPrivate(parsedUrl.hostname)) {
      res.status(400).json({ error: "رابط غير مسموح به" });
      return;
    }

    try {
      const result = await sniffVideoUrls(url, roomSlug, 45000);
      res.json(result);
    } catch (err: any) {
      console.error("[link-sniff] error:", err.message);
      res.status(500).json({ error: "فشل استخراج الروابط — حاول مرة أخرى" });
    }
  }
);

export default router;
