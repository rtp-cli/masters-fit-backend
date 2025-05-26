import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// AuthCodes table
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  code: text("code").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Schema for insert operations
export const insertAuthCodeSchema = createInsertSchema(authCodes).pick({
  email: true,
  code: true,
  expires_at: true,
});

// Types
export type AuthCode = typeof authCodes.$inferSelect;
export type InsertAuthCode = z.infer<typeof insertAuthCodeSchema>;
