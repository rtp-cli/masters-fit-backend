import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { exercises } from "@/models/exercise.schema";
import { prompts } from "@/models/prompts.schema";
import { relations } from "drizzle-orm";

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
  completed: boolean("completed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
});

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
  blockName: text("block_name"), // Name of the workout block
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
});

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
  weight: integer("weight"),
  duration: integer("duration"), // in seconds
  restTime: integer("rest_time"), // in seconds
  notes: text("notes"),
  completed: boolean("completed").default(false),
  order: integer("order").default(1), // Order of exercises within the block
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
export const insertWorkoutSchema = createInsertSchema(workouts).omit({
  id: true,
  createdAt: true,
});

export const insertPlanDaySchema = createInsertSchema(planDays).omit({
  id: true,
});

export const insertWorkoutBlockSchema = createInsertSchema(workoutBlocks).omit({
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
  weight: number | null;
  duration: number | null;
  restTime: number | null;
  notes: string | null;
  completed: boolean | null;
  order: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type InsertWorkoutBlock = z.infer<typeof insertWorkoutBlockSchema>;
export type InsertPlanDayExercise = z.infer<typeof insertPlanDayExerciseSchema>;
