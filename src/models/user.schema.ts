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
    themeMode: text("theme_mode").default("auto"),
    colorTheme: text("color_theme").default("original"),
    // Internal ops notifications (never surfaced to the user). Both are
    // write-once claim markers: an atomic conditional UPDATE sets them, so N
    // Render instances racing the same user still produce exactly one email.
    // signupNotifiedAt — the "new user finished onboarding" alert was sent.
    signupNotifiedAt: timestamp("signup_notified_at"),
    // stalledDigestNotifiedAt — this user has appeared in a stalled-signup
    // digest at least once. Null means they are NEW to the list, which is what
    // gates whether today's digest sends at all.
    stalledDigestNotifiedAt: timestamp("stalled_digest_notified_at"),
    // Outbound user-facing email. Unlike the two markers above, these govern
    // mail that reaches the CUSTOMER, so both are load-bearing for compliance.
    // onboardingNudgeSentAt — the "finish setting up" nudge went out. Claimed
    // by the same atomic conditional UPDATE, and never cleared: one nudge per
    // account, for the life of the account.
    onboardingNudgeSentAt: timestamp("onboarding_nudge_sent_at"),
    // activationNudgeSentAt — the "your plan is waiting" nudge went out.
    // Separate column from onboardingNudgeSentAt on purpose: they target
    // different failures (never finished setup vs. finished setup, got a plan,
    // never started it) and a user can legitimately be eligible for both. One
    // shared column would silently suppress the second.
    activationNudgeSentAt: timestamp("activation_nudge_sent_at"),
    // featureTourSentAt — the "features you may have missed" email went out.
    // Its own column for the same reason activationNudgeSentAt is separate from
    // onboardingNudgeSentAt: it targets a different audience entirely (people
    // who HAVE trained, rather than people who never started), and a shared
    // column would silently suppress whichever send came second.
    featureTourSentAt: timestamp("feature_tour_sent_at"),
    // comebackSentAt — the "your plan ran out, want to try again?" email went
    // out. Its own column again: this targets people who never started AND whose
    // plan has since expired, which is a different set from both nudges and from
    // the feature tour.
    comebackSentAt: timestamp("comeback_sent_at"),
    // emailOptedOutAt — this person clicked unsubscribe. Checked before every
    // non-transactional send. Set by an unauthenticated link, so it is
    // deliberately the ONLY thing that link can write.
    emailOptedOutAt: timestamp("email_opted_out_at"),
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
  themeMode: true,
  colorTheme: true,
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
  themeMode: string | null;
  colorTheme: string | null;
  signupNotifiedAt: Date | null;
  stalledDigestNotifiedAt: Date | null;
  onboardingNudgeSentAt: Date | null;
  activationNudgeSentAt: Date | null;
  emailOptedOutAt: Date | null;
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
