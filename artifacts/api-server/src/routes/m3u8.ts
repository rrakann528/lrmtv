import { Router } from "express";
import { db, storedM3u8Table } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "express-rate-limit";

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads" },
});

function rewriteM3u8Paths(content: string, baseUrl?: string): string {
  const domainInPathRegex = /^\/([a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)+)(\/.*)?$/;

  return content
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return line;

      const domainMatch = trimmed.match(domainInPathRegex);
      if (domainMatch) {
        const domain = domainMatch[1];
        const rest = domainMatch[2] || "";
        return `https://${domain}${rest}`;
      }

      if (baseUrl) {
        const base = baseUrl.replace(/\/$/, "");
        const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
        return `${base}${path}`;
      }

      return line;
    })
    .join("\n");
}

router.post("/m3u8/upload", requireAuth, uploadLimiter,
  async (req, res) => {
    try {
      const { content, baseUrl } = req.body as { content?: string; baseUrl?: string };
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Missing content" });
      }
      if (content.length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: "File too large (max 2MB)" });
      }
      if (!content.includes("#EXTM3U")) {
        return res.status(400).json({ error: "Invalid M3U8 file" });
      }

      const rewritten = rewriteM3u8Paths(content, baseUrl);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [row] = await db
        .insert(storedM3u8Table)
        .values({ content: rewritten, baseUrl: baseUrl ?? null, expiresAt })
        .returning({ id: storedM3u8Table.id });

      return res.json({ id: row.id });
    } catch (err) {
      console.error("[m3u8/upload]", err);
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

router.get("/m3u8/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(storedM3u8Table)
      .where(eq(storedM3u8Table.id, id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Not found" });
    if (new Date() > row.expiresAt) {
      await db.delete(storedM3u8Table).where(eq(storedM3u8Table.id, id));
      return res.status(410).json({ error: "Expired" });
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(row.content);
  } catch (err) {
    console.error("[m3u8/:id]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.options("/m3u8/:id", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.sendStatus(204);
});

export default router;
