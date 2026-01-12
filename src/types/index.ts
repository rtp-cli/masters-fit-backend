// Common types
export { ApiResponse } from "@/types/common/responses";

// Auth types
export * from "@/types/auth/requests";
export * from "@/types/auth/responses";

// Dashboard types
export * from "@/types/dashboard/types";
export * from "@/types/dashboard/requests";
export * from "@/types/dashboard/responses";

// Exercise types
export {
  Exercise,
  ExercisesResponse,
  ExerciseResponse,
} from "@/types/exercise/responses";

// Logs types
export {
  ExerciseLogsResponse,
  ExerciseLogResponse,
  BlockLogsResponse,
  BlockLogResponse,
  PlanDayLogsResponse,
  PlanDayLogResponse,
  WorkoutLogResponse,
  WorkoutLogOrNullResponse,
  WorkoutLogsResponse,
  WorkoutProgressResponse,
  PlanDayProgressResponse,
  CompletedExercisesResponse,
} from "@/types/logs/responses";

// Profile types
export * from "@/types/profile/types";

// Prompts types
export * from "@/types/prompts/requests";
export * from "@/types/prompts/responses";

// Search types
export {
  DateSearchResponse,
  ExerciseSearchResponse,
  ExerciseUserStats,
  DateSearchWorkout,
  DateSearchPlanDay,
  DateSearchExercise,
  ExerciseDetails,
  SearchExerciseDetails,
  PersonalRecord,
} from "@/types/search/responses";

// User types
export * from "./user/responses";

// Workout types
export * from "@/types/workout/requests";
export {
  WorkoutsResponse,
  WorkoutResponse,
  WorkoutWithDetails,
  PlanDayWithExercises,
  PlanDayWithExercise,
  PlanDayResponse,
  PlanDayExerciseResponse,
  // New block-based types
  WorkoutBlock,
  WorkoutBlockWithExercises,
  WorkoutBlockWithExercise,
  WorkoutBlockExercise,
  WorkoutBlockResponse,
  WorkoutBlockExerciseResponse,
} from "@/types/workout/responses";

// Subscription types
export * from "@/types/subscription/requests";
export * from "@/types/subscription/responses";
