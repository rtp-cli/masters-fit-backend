import { pgTable, text, serial, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").default(false),
  pushNotificationToken: text("push_notification_token"), // Expo push token
  createdAt: timestamp("created_at").defaultNow(),
  needsOnboarding: boolean("needs_onboarding").default(true),
}, (table) => ({
  emailIdx: index("idx_users_email").on(table.email),
}));

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
  pushNotificationToken: true,
});

// Types - Explicit interface for TSOA compatibility
export interface User {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean | null;
  pushNotificationToken: string | null;
  createdAt: Date | null;
  needsOnboarding: boolean | null;
}

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

// Auth schemas
export const emailAuthSchema = z.object({
  email: z.string().email(),
});

export type EmailAuthData = z.infer<typeof emailAuthSchema>;
