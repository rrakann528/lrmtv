import { pgTable, text, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => roomsTable.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  content: text("content").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("message"),
  replyToId: integer("reply_to_id"),
  replyToUsername: text("reply_to_username"),
  replyToContent: text("reply_to_content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_chat_room_created").on(t.roomId, t.createdAt),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
