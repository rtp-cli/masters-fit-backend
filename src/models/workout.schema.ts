import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  date,
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
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
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
  date: date("date").notNull(),
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
  exercises: many(planDayExercises),
}));

// Workout Exercise Junction Table
export const planDayExercises = pgTable("plan_day_exercises", {
  id: serial("id").primaryKey(),
  planDayId: integer("plan_day_id")
    .notNull()
    .references(() => planDays.id),
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
    planDay: one(planDays, {
      fields: [planDayExercises.planDayId],
      references: [planDays.id],
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
  isActive: boolean | null;
  name: string;
  description: string | null;
  completed: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanDay {
  id: number;
  workoutId: number;
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanDayExercise {
  id: number;
  planDayId: number;
  exerciseId: number;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  restTime: number | null;
  notes: string | null;
  completed: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type InsertPlanDayExercise = z.infer<typeof insertPlanDayExerciseSchema>;
