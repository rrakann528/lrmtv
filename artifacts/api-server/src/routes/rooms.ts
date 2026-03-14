import { Router, type IRouter } from "express";
import { eq, desc, asc, and } from "drizzle-orm";
import { db, roomsTable, playlistItemsTable, chatMessagesTable } from "@workspace/db";
import { getActiveRooms, kickRoom } from "../lib/socket";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  CreateRoomBody,
  GetRoomParams,
  GetRoomResponse,
  GetRoomPlaylistParams,
  GetRoomPlaylistResponse,
  AddPlaylistItemParams,
  AddPlaylistItemBody,
  GetRoomMessagesParams,
  GetRoomMessagesQueryParams,
  GetRoomMessagesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

// ── List public rooms ──────────────────────────────────────────────────────────
router.get("/rooms", async (_req, res): Promise<void> => {
  const dbRooms = await db.select({
    id: roomsTable.id,
    slug: roomsTable.slug,
    name: roomsTable.name,
    type: roomsTable.type,
    createdAt: roomsTable.createdAt,
  }).from(roomsTable).where(eq(roomsTable.type, "public")).orderBy(desc(roomsTable.createdAt)).limit(50);

  const active = getActiveRooms();
  const countMap = new Map(active.map(r => [r.slug, r.userCount]));

  res.json(dbRooms.map(r => ({ ...r, userCount: countMap.get(r.slug) ?? 0 })));
});

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let room;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const slug = generateSlug();
      const [created] = await db
        .insert(roomsTable)
        .values({
          slug,
          name: parsed.data.name,
          type: parsed.data.type,
        })
        .returning();
      room = created;
      break;
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }

  if (!room) {
    res.status(500).json({ error: "Failed to generate unique slug" });
    return;
  }

  res.status(201).json(
    GetRoomResponse.parse({
      id: room.id,
      slug: room.slug,
      name: room.name,
      type: room.type,
      createdAt: room.createdAt,
      background: room.background,
    })
  );
});

router.get("/rooms/:slug", async (req, res): Promise<void> => {
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const raw = Array.isArray(params.data.slug) ? params.data.slug[0] : params.data.slug;
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, raw));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json(
    GetRoomResponse.parse({
      id: room.id,
      slug: room.slug,
      name: room.name,
      type: room.type,
      createdAt: room.createdAt,
      background: room.background,
    })
  );
});

router.get("/rooms/:slug/playlist", async (req, res): Promise<void> => {
  const params = GetRoomPlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const raw = Array.isArray(params.data.slug) ? params.data.slug[0] : params.data.slug;
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, raw));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const items = await db
    .select()
    .from(playlistItemsTable)
    .where(eq(playlistItemsTable.roomId, room.id))
    .orderBy(asc(playlistItemsTable.position));

  res.json(GetRoomPlaylistResponse.parse(items));
});

router.post("/rooms/:slug/playlist", async (req, res): Promise<void> => {
  const params = AddPlaylistItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AddPlaylistItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const raw = Array.isArray(params.data.slug) ? params.data.slug[0] : params.data.slug;
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, raw));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const existingItems = await db
    .select()
    .from(playlistItemsTable)
    .where(eq(playlistItemsTable.roomId, room.id));

  const [item] = await db
    .insert(playlistItemsTable)
    .values({
      roomId: room.id,
      url: body.data.url,
      sourceType: body.data.sourceType,
      title: body.data.title,
      position: existingItems.length,
      addedBy: body.data.addedBy,
    })
    .returning();

  res.status(201).json(
    GetRoomPlaylistResponse.parse([item])[0]
  );
});

router.delete("/rooms/:slug/playlist/:itemId", async (req, res): Promise<void> => {
  const { slug, itemId } = req.params;
  const rawSlug = Array.isArray(slug) ? slug[0] : slug;

  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, rawSlug as string));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const id = parseInt(itemId as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item ID" });
    return;
  }

  await db
    .delete(playlistItemsTable)
    .where(and(eq(playlistItemsTable.id, id), eq(playlistItemsTable.roomId, room.id)));

  res.status(204).send();
});

router.patch("/rooms/:slug/playlist/reorder", async (req, res): Promise<void> => {
  const { slug } = req.params;
  const rawSlug = Array.isArray(slug) ? slug[0] : slug;

  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, rawSlug as string));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const { items } = req.body as { items: { id: number; position: number }[] };
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "items array required" });
    return;
  }

  const valid = items.every(
    (item) => typeof item === 'object' && item !== null && typeof item.id === 'number' && typeof item.position === 'number'
  );
  if (!valid) {
    res.status(400).json({ error: "Each item must have numeric id and position" });
    return;
  }

  for (const item of items) {
    await db
      .update(playlistItemsTable)
      .set({ position: item.position })
      .where(and(eq(playlistItemsTable.id, item.id), eq(playlistItemsTable.roomId, room.id)));
  }

  const updated = await db
    .select()
    .from(playlistItemsTable)
    .where(eq(playlistItemsTable.roomId, room.id))
    .orderBy(asc(playlistItemsTable.position));

  res.json(updated);
});

router.get("/rooms/:slug/messages", async (req, res): Promise<void> => {
  const params = GetRoomMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetRoomMessagesQueryParams.safeParse(req.query);
  const limit = query.success ? query.data.limit ?? 50 : 50;

  const raw = Array.isArray(params.data.slug) ? params.data.slug[0] : params.data.slug;
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.slug, raw));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.roomId, room.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);

  res.json(GetRoomMessagesResponse.parse(messages.reverse()));
});

// ── Delete room ────────────────────────────────────────────────────────────────
router.delete("/rooms/:slug", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const slug = req.params.slug;
  if (!slug) { res.status(400).json({ error: "slug required" }); return; }

  const [room] = await db
    .select({ id: roomsTable.id, creatorUserId: roomsTable.creatorUserId })
    .from(roomsTable)
    .where(eq(roomsTable.slug, slug))
    .limit(1);

  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  if (room.creatorUserId !== req.userId) {
    res.status(403).json({ error: "Only the room creator can delete this room" });
    return;
  }

  await db.delete(playlistItemsTable).where(eq(playlistItemsTable.roomId, room.id));
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.roomId, room.id));
  await db.delete(roomsTable).where(eq(roomsTable.id, room.id));

  kickRoom(slug);

  res.json({ ok: true });
});

export default router;
