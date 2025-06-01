// Common
export { ApiResponse } from "@/types/common/responses";

// Auth
export * from "@/types/auth/requests";
export * from "@/types/auth/responses";

// Workout
export * from "@/types/workout/requests";
export {
  WorkoutsResponse,
  WorkoutResponse,
  WorkoutWithDetails,
  PlanDayWithExercises,
  PlanDayWithExercise,
  PlanDayResponse,
  PlanDayExerciseResponse,
} from "@/types/workout/responses";

// Exercise
export {
  Exercise,
  ExercisesResponse,
  ExerciseResponse,
} from "@/types/exercise/responses";

// Profile
export * from "@/types/profile/types";

// Logs
export {
  ExerciseLogsResponse,
  ExerciseLogResponse,
  WorkoutLogResponse,
  WorkoutLogOrNullResponse,
  WorkoutLogsResponse,
  CompletedExercisesResponse,
} from "@/types/logs/responses";

// Prompts
export * from "@/types/prompts/requests";
export * from "@/types/prompts/responses";

// Dashboard
export * from "@/types/dashboard/types";
export * from "@/types/dashboard/requests";
export * from "@/types/dashboard/responses";
