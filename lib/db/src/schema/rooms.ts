import { pgTable, text, serial, timestamp, varchar, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roomsTable = pgTable("rooms", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  type: varchar("type", { length: 10 }).notNull().default("public"),
  background: text("background").default("default"),
  adminSocketId: text("admin_socket_id"),
  creatorUserId: integer("creator_user_id"),
  isFrozen: boolean("is_frozen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_rooms_creator").on(t.creatorUserId),
]);

export const insertRoomSchema = createInsertSchema(roomsTable).omit({ id: true, createdAt: true });
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
