import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { exercises } from "@/models/exercise.schema";

// A user's permanently-excluded exercises ("never prescribe this again"). The
// reason is not analytics — it changes what the app puts in the slot's place
// and is how Settings → Excluded exercises groups the list, so it must persist.
// Reversible only from that Settings list (no undo toast), which is why the row
// is a durable record rather than transient state.
export type ExerciseExclusionReason =
  | "hurts"
  | "no_equipment"
  | "too_hard"
  | "dislike";

export const EXERCISE_EXCLUSION_REASONS: ExerciseExclusionReason[] = [
  "hurts",
  "no_equipment",
  "too_hard",
  "dislike",
];

export const exerciseExclusions = pgTable(
  "exercise_exclusions",
  {
    id: serial("id").primaryKey(),
    // Cascade: an exclusion is a user-scoped preference with no meaning once
    // either side is gone. (Account deletion is a soft delete today; this stays
    // correct if a hard delete is ever added.)
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    exerciseId: integer("exercise_id")
      .references(() => exercises.id, { onDelete: "cascade" })
      .notNull(),
    reason: text("reason").$type<ExerciseExclusionReason>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // One exclusion per (user, exercise) — re-excluding is idempotent, and the
    // query-time NOT IN filter stays a simple set membership.
    userExerciseIdx: uniqueIndex("idx_exercise_exclusions_user_exercise").on(
      table.userId,
      table.exerciseId
    ),
    userIdIdx: index("idx_exercise_exclusions_user_id").on(table.userId),
  })
);

export const insertExerciseExclusionSchema = createInsertSchema(
  exerciseExclusions,
  {
    userId: z.number(),
    exerciseId: z.number(),
    reason: z.enum(["hurts", "no_equipment", "too_hard", "dislike"]),
  }
).omit({
  id: true,
  createdAt: true,
});

// Types - Explicit interface for TSOA compatibility
export interface ExerciseExclusion {
  id: number;
  userId: number;
  exerciseId: number;
  reason: ExerciseExclusionReason;
  createdAt: Date;
}

export type InsertExerciseExclusion = z.infer<
  typeof insertExerciseExclusionSchema
>;
