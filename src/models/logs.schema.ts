import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { planDayExercises, workouts } from "./workout.schema";
import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";

export const exerciseLogs = pgTable("exercise_logs", {
  id: serial("id").primaryKey(),
  // This is the ID for the plan day exercise (so lunges on day 7, for example)
  planDayExerciseId: integer("plan_day_exercise_id")
    .notNull()
    .references(() => planDayExercises.id),
  setsCompleted: integer("sets_completed").notNull(),
  repsCompleted: integer("reps_completed").notNull(),
  weightUsed: integer("weight_used").notNull(),
  timeTaken: integer("time_taken"),
  notes: text("notes"),
  isComplete: boolean("is_complete").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workoutLogs = pgTable("workout_logs", {
  id: serial("id").primaryKey(),
  workoutId: integer("workout_id")
    .notNull()
    .references(() => workouts.id),
  totalTimeTaken: integer("total_time_taken").default(0),
  notes: text("notes").default(""),
  completedExercises: integer("completed_exercises").array().$type<number[]>(),
  isComplete: boolean("is_complete").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertExerciseLogSchema = createInsertSchema(exerciseLogs, {
  planDayExerciseId: z.number(),
  setsCompleted: z.number(),
  repsCompleted: z.number(),
  weightUsed: z.number(),
  isComplete: z.boolean().optional(),
  timeTaken: z.number().optional(),
  notes: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs, {
  workoutId: z.number(),
  isComplete: z.boolean().optional(),
  totalTimeTaken: z.number().optional(),
  notes: z.string().optional(),
  completedExercises: z.array(z.number()).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateWorkoutLogSchema = z.object({
  isComplete: z.boolean().optional(),
  totalTimeTaken: z.number().optional(),
  notes: z.string().optional(),
});

export type ExerciseLog = typeof exerciseLogs.$inferSelect;
export type InsertExerciseLog = z.infer<typeof insertExerciseLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
