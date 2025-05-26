import { z } from "zod";
import {
  insertWorkoutSchema,
  insertPlanDaySchema,
  insertPlanDayExerciseSchema,
} from "@/models/workout.schema";

// TSOA-compatible type for workout creation
export interface CreateWorkoutRequest {
  userId: number;
  startDate: string;
  endDate: string;
  promptId: number;
  name: string;
  description?: string;
  completed?: boolean;
  isActive?: boolean;
}

// TSOA-compatible type for plan day creation
export interface CreatePlanDayRequest {
  workoutId: number;
  date: string;
}

// TSOA-compatible type for plan day exercise creation
export interface CreatePlanDayExerciseRequest {
  planDayId: number;
  exerciseId: number;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  restTime: number | null;
  completed: boolean | null;
}

export interface UpdateWorkoutRequest extends Partial<CreateWorkoutRequest> {}

export interface UpdatePlanDayExerciseRequest
  extends Partial<CreatePlanDayExerciseRequest> {}

export interface WorkoutExercise {
  exerciseId: number;
  sets: number;
  reps: number;
  duration?: number;
  restTime?: number;
  notes?: string;
}

export interface LogWorkoutRequest {
  completedAt: string;
  duration: number;
  exercises: CompletedExercise[];
  notes?: string;
}

export interface CompletedExercise {
  exerciseId: number;
  sets: CompletedSet[];
}

export interface CompletedSet {
  reps: number;
  weight?: number;
  duration?: number;
  notes?: string;
}

// We still keep the Zod types for runtime validation
export type InsertWorkoutZod = z.infer<typeof insertWorkoutSchema>;
export type InsertPlanDayZod = z.infer<typeof insertPlanDaySchema>;
export type InsertPlanDayExerciseZod = z.infer<
  typeof insertPlanDayExerciseSchema
>;
