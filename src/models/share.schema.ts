import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { planDays } from "@/models/workout.schema";

// A shareable workout link. The public read of `code` serves the frozen
// `snapshot` and MUST NOT join live plan/log tables (§3.2 of the share spec):
// the user can later edit/regenerate the plan day, and the public endpoint
// must never be a path from an anonymous code into live user tables.
export type ShareKind = "completed" | "planned" | "milestone";

// The client picks a name *style*, never a raw string — the label is resolved
// server-side from the JWT user's single `name` column (§3.1). Keeping the raw
// style lets the card re-resolve if a user renames their account before revoke.
export type ShareNameStyle = "first" | "full" | "anonymous";

// ---------------------------------------------------------------------------
// Frozen snapshot payload (§3.2), version 2.
//
// v2 builds a `completed` share from what was LOGGED (exercise_logs +
// exercise_set_logs), not from the prescription in plan_day_exercises. v1 read
// the plan, so a card could claim a prescribed 25 lb for a set the user took to
// 45, and claim a planned 60 minutes for a 41-minute session. The prescription
// is still the source for a `planned` share, where there is nothing logged yet.
//
// Warm-up / cool-down / mobility blocks are excluded entirely (product decision)
// — from the blocks, from the rows and from every count.
//
// It must never contain injuries, limitations, age, goals, or the AI prompt.
// ---------------------------------------------------------------------------

/** One logged set. Omitted entirely when the sharer hid performance. */
export interface ShareSnapshotSet {
  reps?: number | null;
  weight?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  // 1-based round, present only when the parent block ran more than one.
  round?: number;
}

export interface ShareSnapshotExercise {
  name: string;
  // false when the plan carried this exercise but no log exists for it. Always
  // true on a `planned` share, where the prescription IS the content.
  logged: boolean;
  // Actual logged sets, in order. Empty when !logged or performance is hidden.
  sets: ShareSnapshotSet[];
  // Pre-rendered one-line summary ("3 × 8-6 @ 40-50 lb"). Composed server-side
  // so the card and the landing page can never disagree about the same set.
  summary: string;
  // A qualifier, never a value: "Reps not logged", "Bodyweight".
  note?: string | null;
  // Demo affordance for the landing page — a YouTube id resolved at share time.
  demoVideoId?: string | null;
}

export interface ShareSnapshotBlock {
  name: string | null;
  // traditional | circuit | amrap | emom | flow | for_time | tabata
  type: string | null;
  // Composed server-side: "Circuit · 3 rounds · 14 min".
  label: string;
  rounds?: number | null;
  // Scored protocols (amrap/emom/for_time/tabata) carry a block-level result
  // instead of per-exercise sets. Null when block_logs has nothing for it.
  score?: string | null;
  exercises: ShareSnapshotExercise[];
}

export interface ShareSnapshot {
  // Absent on v1 snapshots minted before this change; readers must treat a
  // missing version as 1 and fall back to the flat `exercises` array.
  version?: 2;
  kind: ShareKind;
  workoutName: string;
  // Human subline under the title, e.g. "Strength · upper body".
  subtitle?: string | null;
  // ISO date (YYYY-MM-DD) of the plan day this share was built from.
  date?: string | null;
  // Rounded minutes for the card ("42 min") — deliberately not m:ss (§4.2).
  // Real elapsed time when it was logged, else the prescribed sum.
  minutes?: number | null;
  minutesAreActual: boolean;
  // Working exercises in the plan, warm-up/cool-down already excluded.
  exerciseCount: number;
  // How many of those carry at least one log. Equals exerciseCount on a
  // `planned` share.
  loggedCount: number;
  // Logged sets for `completed`; prescribed sets for `planned`.
  setCount: number;
  // loggedCount < exerciseCount. Drives the card banner and the muted rows.
  partial: boolean;
  equipment: string[];
  blocks: ShareSnapshotBlock[];
  // Whether the sharer opted to show loads and reps at all.
  showPerformance: boolean;
  // Streak milestone counts (kind === "milestone", or the streak chip when shown).
  streak?: number | null;
  // The resolved display label ("Michael", "Michael Foo") or null when anonymous.
  displayName?: string | null;
}

export const shareLinks = pgTable(
  "share_links",
  {
    id: serial("id").primaryKey(),
    // 6-char, uppercase, Crockford base32 (no I/L/O/U) — reads cleanly aloud
    // and off a printed card footer.
    code: text("code").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // null for a milestone share.
    planDayId: integer("plan_day_id").references(() => planDays.id),
    kind: text("kind").$type<ShareKind>().notNull(),
    // Column stays `show_weights`: the field was renamed when the toggle grew
    // from loads-only to loads+reps, but a rename alone isn't worth a prod push.
    showPerformance: boolean("show_weights").notNull().default(false),
    showStreak: boolean("show_streak").notNull().default(true),
    nameStyle: text("name_style").$type<ShareNameStyle>().notNull().default("first"),
    // Resolved label frozen at share time (null when anonymous).
    displayName: text("display_name"),
    snapshot: jsonb("snapshot").$type<ShareSnapshot>().notNull(),
    // null = draft (never minted by POST /workout, which always publishes).
    // The public read refuses anything unpublished. Kept for a future draft flow.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    codeIdx: index("idx_share_links_code").on(table.code),
    userCreatedIdx: index("idx_share_links_user_created").on(
      table.userId,
      table.createdAt.desc()
    ),
  })
);

export const insertShareLinkSchema = createInsertSchema(shareLinks).omit({
  id: true,
  openCount: true,
  createdAt: true,
});

export interface ShareLink {
  id: number;
  code: string;
  userId: number;
  planDayId: number | null;
  kind: ShareKind;
  showPerformance: boolean;
  showStreak: boolean;
  nameStyle: ShareNameStyle;
  displayName: string | null;
  snapshot: ShareSnapshot;
  publishedAt: Date | null;
  revokedAt: Date | null;
  openCount: number;
  createdAt: Date;
}

export type InsertShareLink = z.infer<typeof insertShareLinkSchema>;

// Request body the client sends for both /preview and /workout (§3.3).
//
// `showWeights` is the v1 spelling and is still accepted: app builds already in
// the wild send it, and they must keep working. When both are absent the share
// hides performance, which is the safe default.
export const shareRequestSchema = z
  .object({
    planDayId: z.number().int().positive().optional(),
    kind: z.enum(["completed", "planned", "milestone"]),
    showPerformance: z.boolean().optional(),
    showWeights: z.boolean().optional(),
    showStreak: z.boolean().default(true),
    nameStyle: z.enum(["first", "full", "anonymous"]).default("first"),
  })
  .transform(({ showPerformance, showWeights, ...rest }) => ({
    ...rest,
    showPerformance: showPerformance ?? showWeights ?? false,
  }));

export type ShareRequest = z.infer<typeof shareRequestSchema>;
