import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const bannedIpsTable = pgTable("banned_ips", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull().unique(),
  reason: text("reason").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BannedIp = typeof bannedIpsTable.$inferSelect;
