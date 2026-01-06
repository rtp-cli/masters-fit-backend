import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  uuid,
  serial,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table - Integer primary key (original structure + uuid for analytics)
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").notNull().unique().defaultRandom(), // UUID for analytics - auto-generated
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    emailVerified: boolean("email_verified").default(false),
    pushNotificationToken: text("push_notification_token"),
    createdAt: timestamp("created_at").defaultNow(),
    needsOnboarding: boolean("needs_onboarding").default(true),
    waiverAcceptedAt: timestamp("waiver_accepted_at"),
    waiverVersion: text("waiver_version"),
    isActive: boolean("is_active").default(true),
  },
  (table) => ({
    emailIdx: index("idx_users_email").on(table.email),
  })
);

// Refresh tokens table
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    isRevoked: boolean("is_revoked").default(false),
  },
  (table) => ({
    userIdIdx: index("idx_refresh_tokens_user_id").on(table.userId),
    tokenHashIdx: index("idx_refresh_tokens_token_hash").on(table.tokenHash),
    expiresAtIdx: index("idx_refresh_tokens_expires_at").on(table.expiresAt),
  })
);

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
  waiverAcceptedAt: true,
  waiverVersion: true,
  isActive: true,
});

// Types - Explicit interface for TSOA compatibility
export interface User {
  id: number;
  uuid: string; // UUID for analytics - required
  email: string;
  name: string;
  emailVerified: boolean | null;
  pushNotificationToken: string | null;
  createdAt: Date | null;
  needsOnboarding: boolean | null;
  waiverAcceptedAt: Date | null;
  waiverVersion: string | null;
  isActive: boolean | null;
}

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

// Auth schemas
export const emailAuthSchema = z.object({
  email: z.string().email(),
});

export type EmailAuthData = z.infer<typeof emailAuthSchema>;

// Refresh token schemas
export const insertRefreshTokenSchema = createInsertSchema(refreshTokens).pick({
  userId: true,
  tokenHash: true,
  expiresAt: true,
});

// Refresh token types
export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date | null;
  isRevoked: boolean | null;
}

export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
