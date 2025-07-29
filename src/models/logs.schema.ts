import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  decimal,
  index,
} from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import {
  planDayExercises,
  workouts,
  planDays,
  workoutBlocks,
} from "./workout.schema";
import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";

// Exercise logs - parent container for exercise performance
export const exerciseLogs = pgTable(
  "exercise_logs",
  {
    id: serial("id").primaryKey(),
    // Reference to the plan day exercise
    planDayExerciseId: integer("plan_day_exercise_id")
      .notNull()
      .references(() => planDayExercises.id),

    // Time-based exercise metrics
    durationCompleted: integer("duration_completed"), // in seconds
    timeTaken: integer("time_taken"), // total time for this exercise in seconds

    // Completion status
    isComplete: boolean("is_complete").notNull().default(false),
    isSkipped: boolean("is_skipped").notNull().default(false),

    // Additional data
    notes: text("notes"),
    difficulty: text("difficulty"), // user-reported difficulty
    rating: integer("rating"), // user rating 1-10

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    planDayExerciseIdIdx: index("idx_exercise_logs_plan_day_exercise_id").on(
      table.planDayExerciseId
    ),
    createdAtIdx: index("idx_exercise_logs_created_at").on(table.createdAt),
    isCompleteIdx: index("idx_exercise_logs_is_complete").on(table.isComplete),
    completeCreatedIdx: index("idx_exercise_logs_complete_created")
      .on(table.isComplete, table.createdAt)
      .where(eq(table.isComplete, true)),
  })
);

// New table for set-level exercise logging
export const exerciseSetLogs = pgTable(
  "exercise_set_logs",
  {
    id: serial("id").primaryKey(),
    // Reference to the parent exercise log
    exerciseLogId: integer("exercise_log_id")
      .notNull()
      .references(() => exerciseLogs.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull().default(1),
    setNumber: integer("set_number").notNull(),
    weight: decimal("weight", { precision: 6, scale: 2 }),
    reps: integer("reps"),
    restAfter: integer("rest_after"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    exerciseLogIdIdx: index("idx_exercise_set_logs_exercise_log_id").on(
      table.exerciseLogId
    ),
    roundSetIdx: index("idx_exercise_set_logs_round_set").on(
      table.exerciseLogId,
      table.roundNumber,
      table.setNumber
    ),
  })
);

// Block-level logs - for tracking AMRAP rounds, EMOM minutes, etc.
export const blockLogs = pgTable(
  "block_logs",
  {
    id: serial("id").primaryKey(),
    // Reference to the workout block
    workoutBlockId: integer("workout_block_id")
      .notNull()
      .references(() => workoutBlocks.id),

    // Block completion metrics
    roundsCompleted: integer("rounds_completed"),
    timeCapMinutes: integer("time_cap_minutes"),
    actualTimeMinutes: integer("actual_time_minutes"),

    // Block-specific metrics
    totalReps: integer("total_reps"), // for AMRAP/EMOM
    totalDuration: integer("total_duration"), // in seconds
    score: text("score"), // for CrossFit-style scoring

    // Completion status
    isComplete: boolean("is_complete").notNull().default(false),
    isSkipped: boolean("is_skipped").notNull().default(false),

    // Additional data
    notes: text("notes"),
    difficulty: text("difficulty"), // user-reported difficulty
    rating: integer("rating"), // user rating 1-10

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workoutBlockIdIdx: index("idx_block_logs_workout_block_id").on(
      table.workoutBlockId
    ),
  })
);

// Plan day logs - for tracking day-level completion
export const planDayLogs = pgTable("plan_day_logs", {
  id: serial("id").primaryKey(),
  // Reference to the plan day
  planDayId: integer("plan_day_id")
    .notNull()
    .references(() => planDays.id),

  // Day completion metrics
  totalTimeMinutes: integer("total_time_minutes"),
  blocksCompleted: integer("blocks_completed"),
  exercisesCompleted: integer("exercises_completed"),

  // Day-specific metrics
  totalVolume: integer("total_volume"), // total reps/weight/duration
  averageHeartRate: integer("average_heart_rate"),
  maxHeartRate: integer("max_heart_rate"),

  // Completion status
  isComplete: boolean("is_complete").notNull().default(false),
  isSkipped: boolean("is_skipped").notNull().default(false),

  // Additional data
  notes: text("notes"),
  difficulty: text("difficulty"), // user-reported difficulty
  rating: integer("rating"), // user rating 1-10
  mood: text("mood"), // user mood during workout

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Enhanced workout logs
export const workoutLogs = pgTable(
  "workout_logs",
  {
    id: serial("id").primaryKey(),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workouts.id),

    // Workout completion metrics
    totalTimeMinutes: integer("total_time_minutes").default(0),
    daysCompleted: integer("days_completed").default(0),
    totalDays: integer("total_days").default(0),

    // Workout-specific metrics
    totalVolume: integer("total_volume"), // total reps/weight/duration across all days
    averageRating: decimal("average_rating", { precision: 3, scale: 2 }),

    // Completion tracking
    completedExercises: integer("completed_exercises")
      .array()
      .$type<number[]>(),
    completedBlocks: integer("completed_blocks").array().$type<number[]>(),
    completedDays: integer("completed_days").array().$type<number[]>(),
    
    // Skip tracking
    skippedExercises: integer("skipped_exercises").array().$type<number[]>(),
    skippedBlocks: integer("skipped_blocks").array().$type<number[]>(),

    // Status
    isComplete: boolean("is_complete").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    // Additional data
    notes: text("notes").default(""),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workoutIdIdx: index("idx_workout_logs_workout_id").on(table.workoutId),
  })
);

// Schemas for insert operations
export const insertExerciseLogSchema = createInsertSchema(exerciseLogs, {
  planDayExerciseId: z.number(),
  durationCompleted: z.number().optional(),
  timeTaken: z.number().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExerciseSetLogSchema = createInsertSchema(exerciseSetLogs, {
  exerciseLogId: z.number(),
  roundNumber: z.number().min(1),
  setNumber: z.number().min(1),
  weight: z.number().min(0).optional(),
  reps: z.number().min(0).optional(),
  restAfter: z.number().min(0).optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const insertBlockLogSchema = createInsertSchema(blockLogs, {
  workoutBlockId: z.number(),
  roundsCompleted: z.number().optional(),
  timeCapMinutes: z.number().optional(),
  actualTimeMinutes: z.number().optional(),
  totalReps: z.number().optional(),
  totalDuration: z.number().optional(),
  score: z.string().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlanDayLogSchema = createInsertSchema(planDayLogs, {
  planDayId: z.number(),
  totalTimeMinutes: z.number().optional(),
  blocksCompleted: z.number().optional(),
  exercisesCompleted: z.number().optional(),
  totalVolume: z.number().optional(),
  averageHeartRate: z.number().optional(),
  maxHeartRate: z.number().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
  mood: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs, {
  workoutId: z.number(),
  totalTimeMinutes: z.number().optional(),
  daysCompleted: z.number().optional(),
  totalDays: z.number().optional(),
  totalVolume: z.number().optional(),
  averageRating: z.number().optional(),
  completedExercises: z.array(z.number()).optional(),
  completedBlocks: z.array(z.number()).optional(),
  completedDays: z.array(z.number()).optional(),
  skippedExercises: z.array(z.number()).optional(),
  skippedBlocks: z.array(z.number()).optional(),
  isComplete: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update schemas
export const updateExerciseLogSchema = z.object({
  durationCompleted: z.number().optional(),
  timeTaken: z.number().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
});

export const updateExerciseSetLogSchema = z.object({
  weight: z.number().min(0).optional(),
  reps: z.number().min(0).optional(),
  restAfter: z.number().min(0).optional(),
});

export const updateBlockLogSchema = z.object({
  roundsCompleted: z.number().optional(),
  timeCapMinutes: z.number().optional(),
  actualTimeMinutes: z.number().optional(),
  totalReps: z.number().optional(),
  totalDuration: z.number().optional(),
  score: z.string().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
});

export const updatePlanDayLogSchema = z.object({
  totalTimeMinutes: z.number().optional(),
  blocksCompleted: z.number().optional(),
  exercisesCompleted: z.number().optional(),
  totalVolume: z.number().optional(),
  averageHeartRate: z.number().optional(),
  maxHeartRate: z.number().optional(),
  isComplete: z.boolean().optional(),
  isSkipped: z.boolean().optional(),
  notes: z.string().optional(),
  difficulty: z.string().optional(),
  rating: z.number().min(1).max(10).optional(),
  mood: z.string().optional(),
});

export const updateWorkoutLogSchema = z.object({
  totalTimeMinutes: z.number().optional(),
  daysCompleted: z.number().optional(),
  totalDays: z.number().optional(),
  totalVolume: z.number().optional(),
  averageRating: z.number().optional(),
  completedExercises: z.array(z.number()).optional(),
  completedBlocks: z.array(z.number()).optional(),
  completedDays: z.array(z.number()).optional(),
  skippedExercises: z.array(z.number()).optional(),
  skippedBlocks: z.array(z.number()).optional(),
  isComplete: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

// Types - Explicit interfaces for TSOA compatibility
export interface ExerciseLog {
  id: number;
  planDayExerciseId: number;
  durationCompleted: number | null;
  timeTaken: number | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExerciseSetLog {
  id: number;
  exerciseLogId: number;
  roundNumber: number;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  restAfter: number | null;
  createdAt: Date;
}

export interface BlockLog {
  id: number;
  workoutBlockId: number;
  roundsCompleted: number | null;
  timeCapMinutes: number | null;
  actualTimeMinutes: number | null;
  totalReps: number | null;
  totalDuration: number | null;
  score: string | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanDayLog {
  id: number;
  planDayId: number;
  totalTimeMinutes: number | null;
  blocksCompleted: number | null;
  exercisesCompleted: number | null;
  totalVolume: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  isComplete: boolean;
  isSkipped: boolean;
  notes: string | null;
  difficulty: string | null;
  rating: number | null;
  mood: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutLog {
  id: number;
  workoutId: number;
  totalTimeMinutes: number | null;
  daysCompleted: number | null;
  totalDays: number | null;
  totalVolume: number | null;
  averageRating: number | null;
  completedExercises: number[] | null;
  completedBlocks: number[] | null;
  completedDays: number[] | null;
  skippedExercises: number[] | null;
  skippedBlocks: number[] | null;
  isComplete: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Type exports for insert operations
export type InsertExerciseLog = z.infer<typeof insertExerciseLogSchema>;
export type InsertExerciseSetLog = z.infer<typeof insertExerciseSetLogSchema>;
export type InsertBlockLog = z.infer<typeof insertBlockLogSchema>;
export type InsertPlanDayLog = z.infer<typeof insertPlanDayLogSchema>;
export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;

// Type exports for update operations
export type UpdateExerciseLog = z.infer<typeof updateExerciseLogSchema>;
export type UpdateExerciseSetLog = z.infer<typeof updateExerciseSetLogSchema>;
export type UpdateBlockLog = z.infer<typeof updateBlockLogSchema>;
export type UpdatePlanDayLog = z.infer<typeof updatePlanDayLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
