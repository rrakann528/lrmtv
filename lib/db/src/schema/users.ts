import { pgTable, text, serial, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash"),
  provider: varchar("provider", { length: 20 }).notNull().default("local"),
  providerId: text("provider_id"),
  displayName: varchar("display_name", { length: 40 }),
  bio: varchar("bio", { length: 160 }),
  avatarColor: varchar("avatar_color", { length: 7 }).notNull().default("#06B6D4"),
  avatarUrl: text("avatar_url"),
  email: varchar("email", { length: 255 }).unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  isSiteAdmin: boolean("is_site_admin").notNull().default(false),
  isBanned: boolean("is_banned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
