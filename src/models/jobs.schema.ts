import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { workouts } from "@/models/workout.schema";
import { relations } from "drizzle-orm";

// Job status enum
export const JobStatus = {
  PENDING: "pending",
  PROCESSING: "processing", 
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

// Job type enum
export const JobType = {
  WORKOUT_GENERATION: "workout_generation",
  WORKOUT_REGENERATION: "workout_regeneration",
  DAILY_REGENERATION: "daily_workout_regeneration",
} as const;

export type JobStatusType = typeof JobStatus[keyof typeof JobStatus];
export type JobTypeType = typeof JobType[keyof typeof JobType];

// Background jobs table for tracking async operations
export const backgroundJobs = pgTable("background_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  jobType: text("job_type").notNull(), // "workout_generation"
  status: text("status").notNull().default(JobStatus.PENDING), // pending, processing, completed, failed
  progress: integer("progress").default(0), // 0-100
  data: jsonb("data"), // Job input data
  result: jsonb("result"), // Job result data
  error: text("error"), // Error message if failed
  workoutId: integer("workout_id").references(() => workouts.id), // Reference to generated workout
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  userIdIdx: index("idx_background_jobs_user_id").on(table.userId),
  statusIdx: index("idx_background_jobs_status").on(table.status),
  jobTypeIdx: index("idx_background_jobs_job_type").on(table.jobType),
  userStatusIdx: index("idx_background_jobs_user_status").on(table.userId, table.status),
}));

export const backgroundJobRelations = relations(backgroundJobs, ({ one }) => ({
  user: one(users, {
    fields: [backgroundJobs.userId],
    references: [users.id],
  }),
  workout: one(workouts, {
    fields: [backgroundJobs.workoutId],
    references: [workouts.id],
  }),
}));

// Schemas for insert operations
export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  userId: true,
  createdAt: true,
}).partial();

// Types - Explicit interfaces for TSOA compatibility
export interface BackgroundJob {
  id: number;
  userId: number;
  jobType: string;
  status: JobStatusType;
  progress: number | null;
  data: any; // JSON data
  result: any; // JSON result
  error: string | null;
  workoutId: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface WorkoutGenerationJobData {
  customFeedback?: string;
  timezone?: string;
  profileData?: {
    age?: number;
    height?: number;
    weight?: number;
    gender?: string;
    goals?: string[];
    limitations?: string[];
    fitnessLevel?: string;
    environment?: string[];
    equipment?: string[];
    workoutStyles?: string[];
    availableDays?: string[];
    workoutDuration?: number;
    intensityLevel?: number;
    medicalNotes?: string;
  };
}

export interface WorkoutGenerationJobResult {
  workoutId: number;
  workoutName: string;
  planDaysCount: number;
  totalExercises: number;
  generationTimeMs: number;
}

export interface WorkoutRegenerationJobData {
  customFeedback?: string;
  profileData?: {
    age?: number;
    height?: number;
    weight?: number;
    gender?: string;
    goals?: string[];
    limitations?: string[];
    fitnessLevel?: string;
    environment?: string[];
    equipment?: string[];
    workoutStyles?: string[];
    availableDays?: string[];
    workoutDuration?: number;
    intensityLevel?: number;
    medicalNotes?: string;
  };
}

export interface WorkoutRegenerationJobResult {
  workoutId: number;
  workoutName: string;
  planDaysCount: number;
  totalExercises: number;
  generationTimeMs: number;
  previousWorkoutId?: number;
}

export interface DailyRegenerationJobData {
  planDayId: number;
  regenerationReason: string;
  regenerationStyles?: string[];
  threadId?: string;
}

export interface DailyRegenerationJobResult {
  planDayId: number;
  planDayName: string;
  totalExercises: number;
  generationTimeMs: number;
}

export type InsertBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;
export type UpdateBackgroundJob = z.infer<typeof updateBackgroundJobSchema>;