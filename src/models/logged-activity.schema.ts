import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";

/**
 * [LR-077] Something the user did that the app did not prescribe — a walk, a
 * swim, a tennis match.
 *
 * Deliberately NOT a plan day. Every other log in this codebase hangs off
 * planDayExercises → workoutBlocks → planDays, which exists to record how a
 * PRESCRIPTION was executed. This records that something happened, and there is
 * no prescription behind it: nothing generated it, it has no sets, no reps and
 * no blocks.
 *
 * Two consequences follow from it not being a plan day, and both are the point:
 *  - `calculateScheduledWorkoutStreak` keys on planDays.isComplete, so a logged
 *    activity cannot touch the streak. That is the decided behavior (Rich,
 *    2026-09-22) and it needs no exclusion flag — it is true by construction.
 *  - Anything aggregating plan days (weekly progress, completion rates) will not
 *    see these rows either. Also deliberate for v1.
 */

/**
 * The fixed vocabulary offered in the picker. NOT PreferredStyles (constants/
 * profile.ts) — that is what the user wants the app to PROGRAM for them, an
 * intent about future sessions. This is a record of a thing that already
 * happened in the real world, so it names real-world activities and stays a
 * separate axis on purpose.
 *
 * `other` is the escape hatch; it is the only value for which customType
 * carries meaning. Keeping the common cases as enum values (rather than making
 * everything free text) is what lets us measure whether this feature actually
 * converts the never-activated cohort — free text cannot be counted.
 */
export const LOGGED_ACTIVITY_TYPES = [
  "walk",
  "run",
  "bike",
  "swim",
  "hike",
  "strength",
  "yoga",
  "racket_sport",
  "golf",
  "other",
] as const;

export type LoggedActivityType = (typeof LOGGED_ACTIVITY_TYPES)[number];

/** Optional, and genuinely optional — most people will log a walk and leave. */
export const LOGGED_ACTIVITY_EFFORTS = ["easy", "moderate", "hard"] as const;

export type LoggedActivityEffort = (typeof LOGGED_ACTIVITY_EFFORTS)[number];

/** Guards against a fat-fingered duration becoming a 40-hour walk. */
export const MAX_ACTIVITY_DURATION_MINUTES = 600;

export const loggedActivities = pgTable(
  "logged_activities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /**
     * "YYYY-MM-DD" in the user's own local date, matching planDays.date rather
     * than a timestamp. The app's whole notion of "a day" is this string — a
     * timestamptz here would reintroduce the local-vs-UTC date mismatch that
     * already breaks evening streaks for US users.
     */
    date: text("date").notNull(),
    activityType: text("activity_type").$type<LoggedActivityType>().notNull(),
    /** Only meaningful when activityType is "other"; null otherwise. */
    customType: text("custom_type"),
    durationMinutes: integer("duration_minutes").notNull(),
    effort: text("effort").$type<LoggedActivityEffort>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_logged_activities_user_id").on(table.userId),
    // The calendar and dashboard both read a date window for one user; this is
    // the only shape either of them asks for.
    userDateIdx: index("idx_logged_activities_user_date").on(
      table.userId,
      table.date
    ),
  })
);

export const insertLoggedActivitySchema = createInsertSchema(loggedActivities, {
  userId: z.number().int().positive(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  activityType: z.enum(LOGGED_ACTIVITY_TYPES),
  customType: z.string().trim().min(1).max(60).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVITY_DURATION_MINUTES),
  effort: z.enum(LOGGED_ACTIVITY_EFFORTS).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * What the client may send. userId is absent on purpose — it comes from the
 * verified JWT, never from the body.
 */
export const createLoggedActivitySchema = insertLoggedActivitySchema
  .omit({ userId: true })
  .superRefine((value, ctx) => {
    // "Other" with no label is an unreadable row in the UI and useless in
    // analytics, so require the label exactly where it means something.
    if (value.activityType === "other" && !value.customType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customType"],
        message: "customType is required when activityType is 'other'",
      });
    }
  });

// Types - Explicit interface for TSOA compatibility
export interface LoggedActivity {
  id: number;
  userId: number;
  date: string;
  activityType: LoggedActivityType;
  customType: string | null;
  durationMinutes: number;
  effort: LoggedActivityEffort | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertLoggedActivity = z.infer<typeof insertLoggedActivitySchema>;
export type CreateLoggedActivityInput = z.infer<
  typeof createLoggedActivitySchema
>;
