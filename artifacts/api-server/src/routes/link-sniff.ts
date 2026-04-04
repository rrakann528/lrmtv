import { Router, type IRouter, type Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db, roomsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { sniffVideoUrls, isDomainAllowed } from "../lib/link-sniffer";
import { isUserDjInRoom } from "../lib/socket";

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.")) return true;
  if (hostname.startsWith("169.254.") || hostname.startsWith("0.") || hostname === "0.0.0.0") return true;
  return false;
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

    if (isPrivateHost(parsedUrl.hostname)) {
      res.status(400).json({ error: "رابط غير مسموح به" });
      return;
    }

    if (!isDomainAllowed(url)) {
      res.status(403).json({
        error: "هذا الموقع غير مدعوم حالياً",
        hint: "المواقع المدعومة: EgyBest, Shahid4u, FaselHD, MyCima, Akwam, ArabSeed والمزيد",
      });
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
