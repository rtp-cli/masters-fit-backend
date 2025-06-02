import { ApiResponse } from "@/types/common/responses";

// Exercise related types for search
export interface SearchExerciseDetails {
  id: number;
  name: string;
  description: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  instructions: string;
  link?: string;
}

export interface DateSearchExercise {
  id: number;
  exercise: SearchExerciseDetails;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  completed: boolean;
  completionRate: number;
}

export interface DateSearchPlanDay {
  id: number;
  date: Date;
  exercises: DateSearchExercise[];
}

export interface DateSearchWorkout {
  id: number;
  name: string;
  description: string;
  completed: boolean;
  planDay: DateSearchPlanDay;
  overallCompletionRate: number;
}

export interface DateSearchResponse extends ApiResponse {
  date: string;
  workout: DateSearchWorkout | null;
}

// Exercise search with user stats
export interface ExerciseDetails {
  id: number;
  name: string;
  description: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  instructions: string;
  link?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PersonalRecord {
  maxWeight: number | null;
  maxReps: number;
  maxSets: number;
}

export interface ExerciseUserStats {
  totalAssignments: number;
  totalCompletions: number;
  completionRate: number;
  averageSets: number;
  averageReps: number;
  averageWeight: number | null;
  lastPerformed: Date | null;
  personalRecord: PersonalRecord;
}

export interface ExerciseSearchResponse extends ApiResponse {
  exercise: ExerciseDetails;
  userStats: ExerciseUserStats | null;
}
