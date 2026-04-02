import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const storedM3u8Table = pgTable("stored_m3u8", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),
  baseUrl: text("base_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type StoredM3u8 = typeof storedM3u8Table.$inferSelect;
