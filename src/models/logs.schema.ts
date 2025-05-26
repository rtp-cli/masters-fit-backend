import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { planDayExercises } from "./workout.schema";
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
  status: text("status").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertExerciseLogSchema = createInsertSchema(exerciseLogs, {
  planDayExerciseId: z.number(),
  setsCompleted: z.number(),
  repsCompleted: z.number(),
  weightUsed: z.number(),
  status: z.string(),
  notes: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ExerciseLog = typeof exerciseLogs.$inferSelect;
export type InsertExerciseLog = z.infer<typeof insertExerciseLogSchema>;
