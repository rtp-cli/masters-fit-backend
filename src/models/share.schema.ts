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
// Frozen snapshot payload (§3.2). Everything the link serves forever lives
// here; weights are OMITTED entirely (not included-and-hidden) when the sharer
// left "Show weights" off, and never present at all on a `planned` card.
// It must never contain injuries, limitations, age, goals, or the AI prompt.
// ---------------------------------------------------------------------------
export interface ShareSnapshotExercise {
  name: string;
  sets: number | null;
  reps: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  restSeconds?: number | null;
  distanceM?: number | null;
  eachSide?: boolean;
  // Only present when show_weights is true and this is a `completed` card.
  weight?: number | null;
  // Demo affordance for the landing page — a YouTube id resolved at share time.
  demoVideoId?: string | null;
}

export interface ShareSnapshot {
  kind: ShareKind;
  workoutName: string;
  // Human subline under the title, e.g. "Strength · upper body".
  subtitle?: string | null;
  // ISO date (YYYY-MM-DD) of the plan day this share was built from.
  date?: string | null;
  // Rounded minutes for the card ("42 min") — deliberately not m:ss (§4.2).
  minutes?: number | null;
  exerciseCount: number;
  setCount: number;
  equipment: string[];
  exercises: ShareSnapshotExercise[];
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
    showWeights: boolean("show_weights").notNull().default(false),
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
  showWeights: boolean;
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
export const shareRequestSchema = z.object({
  planDayId: z.number().int().positive().optional(),
  kind: z.enum(["completed", "planned", "milestone"]),
  showWeights: z.boolean().default(false),
  showStreak: z.boolean().default(true),
  nameStyle: z.enum(["first", "full", "anonymous"]).default("first"),
});

export type ShareRequest = z.infer<typeof shareRequestSchema>;
