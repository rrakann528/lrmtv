import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const directMessagesTable = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  receiverId: integer("receiver_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  replyToId: integer("reply_to_id"),
  replyToContent: text("reply_to_content"),
  replyToSenderName: text("reply_to_sender_name"),
  isEdited: boolean("is_edited").notNull().default(false),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_dm_sender").on(t.senderId),
  index("idx_dm_receiver").on(t.receiverId),
  index("idx_dm_pair").on(t.senderId, t.receiverId),
]);

export type DirectMessage = typeof directMessagesTable.$inferSelect;
