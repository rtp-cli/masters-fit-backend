import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import {
  protocolConfigSchema,
  type ProtocolConfig,
} from "@/utils/protocol-config";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { exercises } from "@/models/exercise.schema";
import { prompts } from "@/models/prompts.schema";
import { relations } from "drizzle-orm";
import type { WorkoutSourceType } from "@/constants/access-policy";

// Workout table
export const workouts = pgTable("workouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  promptId: integer("prompt_id")
    .notNull()
    .references(() => prompts.id),
  isActive: boolean("is_active").default(true),
  name: text("name").notNull(),
  description: text("description"),
  // [GQ-04] "Couldn't apply X because Y" — parts of the user's request the
  // generated plan could not honor, surfaced in-app. Nullable/empty is the
  // normal case (a plan that honored everything).
  feedbackConflicts: jsonb("feedback_conflicts").$type<
    { request: string; reason: string }[]
  >(),
  completed: boolean("completed").default(false),
  // Lineage tag (AI_INITIAL | AI_NEW_PROGRAM | AI_REGENERATION | REST_DAY |
  // REPEAT | MANUAL). Descriptive metadata for analytics/debugging/cleanup —
  // NOT the source of truth for entitlement (the ai_operations ledger is).
  sourceType: text("source_type").$type<WorkoutSourceType>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  userIdIdx: index("idx_workouts_user_id").on(table.userId),
  userActiveIdx: uniqueIndex("idx_workouts_user_active").on(table.userId).where(sql`is_active = true`),
  completedIdx: index("idx_workouts_completed").on(table.completed),
}));

export const workoutRelations = relations(workouts, ({ many }) => ({
  planDays: many(planDays),
}));

// Single day of the workout plan
export const planDays = pgTable("plan_days", {
  id: serial("id").primaryKey(),
  workoutId: integer("workout_id")
    .notNull()
    .references(() => workouts.id),
  date: text("date").notNull(),
  instructions: text("instructions"), // Day-level coaching instructions
  name: text("name"), // Name of the workout day
  description: text("description"), // Description of the workout day
  dayNumber: integer("day_number"), // Day number in the workout plan
  isComplete: boolean("is_complete").default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  workoutIdIdx: index("idx_plan_days_workout_id").on(table.workoutId),
  dateIdx: index("idx_plan_days_date").on(table.date),
  workoutDateIdx: index("idx_plan_days_workout_date").on(table.workoutId, table.date),
  isCompleteIdx: index("idx_plan_days_complete").on(table.isComplete),
  incompleteWorkoutDateIdx: index("idx_plan_days_incomplete").on(table.workoutId, table.date).where(sql`is_complete = false`),
}));

export const planDayRelations = relations(planDays, ({ one, many }) => ({
  workout: one(workouts, {
    fields: [planDays.workoutId],
    references: [workouts.id],
  }),
  blocks: many(workoutBlocks),
}));

// Workout blocks - represents different segments of a workout day
export const workoutBlocks = pgTable("workout_blocks", {
  id: serial("id").primaryKey(),
  planDayId: integer("plan_day_id")
    .notNull()
    .references(() => planDays.id),
  blockType: text("block_type").default("traditional"), // Type of workout block
  // How this block is scored, independent of structure (gap-analysis Phase 2):
  // completion | rounds_reps | time | reps | load | quality | none.
  // Nullable — old rows derive a default from blockType in code.
  scoringType: text("scoring_type"),
  // Typed protocol details the scalar columns can't hold (gap-analysis
  // Phase 4): repScheme (21-15-9), work/rest intervals, EMOM interval
  // length. Validated by protocolConfigSchema before persistence —
  // essential behavior must NOT depend on this being present.
  protocolConfig: jsonb("protocol_config").$type<ProtocolConfig>(),
  blockName: text("block_name"), // Name of the workout block
  // [GQ-12] Per-block muscle focus — the muscles THIS block trains, which can
  // differ across blocks on the same day (a strength block on chest + a
  // full-body metcon). Nullable; empty/absent means "no per-block focus".
  primaryMuscleGroups: text("primary_muscle_groups")
    .array()
    .$type<string[]>(),
  blockDurationMinutes: integer("block_duration_minutes"), // Calculated duration of the block in minutes
  timeCapMinutes: integer("time_cap_minutes"), // Time cap for AMRAP/EMOM blocks
  rounds: integer("rounds").default(1), // Number of rounds for circuits/flows
  instructions: text("instructions"), // Block-level coaching instructions
  order: integer("order").default(1), // Order of blocks within the day
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  planDayIdIdx: index("idx_workout_blocks_plan_day_id").on(table.planDayId),
}));

export const workoutBlockRelations = relations(
  workoutBlocks,
  ({ one, many }) => ({
    planDay: one(planDays, {
      fields: [workoutBlocks.planDayId],
      references: [planDays.id],
    }),
    exercises: many(planDayExercises),
  })
);

// Workout Exercise Junction Table - now references workout blocks instead of plan days
export const planDayExercises = pgTable("plan_day_exercises", {
  id: serial("id").primaryKey(),
  workoutBlockId: integer("workout_block_id")
    .notNull()
    .references(() => workoutBlocks.id),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id),
  sets: integer("sets"),
  reps: integer("reps"),
  // Optional rep range around `reps` (e.g. 8-12); display + progression
  // context, reps stays the single prefill target (gap-analysis Phase 4)
  repsMin: integer("reps_min"),
  repsMax: integer("reps_max"),
  weight: integer("weight"),
  duration: integer("duration"), // in seconds
  restTime: integer("rest_time"), // in seconds
  // Prescribed distance in meters (runs, rows, carries) — the Murph runs
  distanceM: integer("distance_m"),
  // Prescribed target effort (RPE 1-10), previously prose-only in notes
  rpe: integer("rpe"),
  notes: text("notes"),
  completed: boolean("completed").default(false),
  isSkipped: boolean("is_skipped").default(false),
  order: integer("order").default(1), // Order of exercises within the block
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  workoutBlockIdIdx: index("idx_plan_day_exercises_workout_block_id").on(table.workoutBlockId),
  exerciseIdIdx: index("idx_plan_day_exercises_exercise_id").on(table.exerciseId),
}));

export const planDayExerciseRelations = relations(
  planDayExercises,
  ({ one }) => ({
    workoutBlock: one(workoutBlocks, {
      fields: [planDayExercises.workoutBlockId],
      references: [workoutBlocks.id],
    }),
    exercise: one(exercises, {
      fields: [planDayExercises.exerciseId],
      references: [exercises.id],
    }),
  })
);

// Schemas for insert operations
export const insertWorkoutSchema = createInsertSchema(workouts, {
  // drizzle-zod types jsonb as a generic Json union; pin it to the real shape
  // so InsertWorkout.feedbackConflicts matches the column's $type (GQ-04).
  feedbackConflicts: z
    .array(z.object({ request: z.string(), reason: z.string() }))
    .nullable()
    .optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const insertPlanDaySchema = createInsertSchema(planDays).omit({
  id: true,
});

export const insertWorkoutBlockSchema = createInsertSchema(workoutBlocks, {
  // drizzle-zod types jsonb as a generic Json union; pin it to the real shape
  protocolConfig: protocolConfigSchema.nullable().optional(),
  // [GQ-12] Accept string[] | null | undefined for the per-block muscle focus.
  primaryMuscleGroups: z.array(z.string()).nullable().optional(),
}).omit({
  id: true,
});

export const insertPlanDayExerciseSchema = createInsertSchema(
  planDayExercises
).omit({
  id: true,
});

// Types - Explicit interfaces for TSOA compatibility
export interface Workout {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  promptId: number;
  isActive?: boolean;
  name: string;
  description?: string;
  completed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanDay {
  id: number;
  workoutId: number;
  date: string;
  instructions: string | null;
  name: string | null;
  description: string | null;
  dayNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutBlock {
  id: number;
  planDayId: number;
  blockType: string | null;
  scoringType: string | null;
  protocolConfig: ProtocolConfig | null;
  blockName: string | null;
  blockDurationMinutes: number | null;
  timeCapMinutes: number | null;
  rounds: number | null;
  instructions: string | null;
  order: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanDayExercise {
  id: number;
  workoutBlockId: number;
  exerciseId: number;
  sets: number | null;
  reps: number | null;
  repsMin: number | null;
  repsMax: number | null;
  weight: number | null;
  duration: number | null;
  restTime: number | null;
  distanceM: number | null;
  rpe: number | null;
  notes: string | null;
  completed: boolean | null;
  isSkipped: boolean | null;
  order: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type InsertWorkoutBlock = z.infer<typeof insertWorkoutBlockSchema>;
export type InsertPlanDayExercise = z.infer<typeof insertPlanDayExerciseSchema>;
