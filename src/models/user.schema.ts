import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  needsOnboarding: boolean("needs_onboarding").default(true),
});

// Schema for insert operations
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  name: true,
});

// Schema for update operations
export const updateUserSchema = createInsertSchema(users).pick({
  email: true,
  name: true,
  needsOnboarding: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

// Auth schemas
export const emailAuthSchema = z.object({
  email: z.string().email(),
});

export type EmailAuthData = z.infer<typeof emailAuthSchema>;
