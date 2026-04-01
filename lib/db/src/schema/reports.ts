import { pgTable, text, serial, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id"),
  messageContent: text("message_content").notNull().default(""),
  reportedUsername: text("reported_username").notNull(),
  reporterUsername: text("reporter_username").notNull(),
  roomSlug: varchar("room_slug", { length: 64 }),
  reason: varchar("reason", { length: 50 }).notNull().default("other"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_reports_status").on(t.status),
  index("idx_reports_reported").on(t.reportedUsername),
]);

export type Report = typeof reportsTable.$inferSelect;
