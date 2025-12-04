// ==================== Analytics Request Types ====================

/**
 * Video engagement tracking request
 */
export interface VideoEngagementRequest {
  user_id: string; // UUID
  exercise_id: number;
  exercise_name: string;
  video_url: string;
}

/**
 * App opened tracking request
 */
export interface AppOpenedRequest {
  user_id: string; // UUID
  app_version: string;
  platform: "ios" | "android" | "web";
}

/**
 * Workout abandoned tracking request
 */
export interface WorkoutAbandonedRequest {
  user_id: string; // UUID
  workout_id: number;
  plan_day_id?: number;
  current_exercise?: string;
  current_block?: string;
  duration: number;
}

/**
 * Workout started tracking request
 */
export interface WorkoutStartedRequest {
  user_id: string; // UUID
  workout_id: number;
  plan_day_id: number;
}

/**
 * Workout completed tracking request
 */
export interface WorkoutCompletedRequest {
  user_id: string; // UUID
  workout_id: number;
  plan_day_id: number;
  duration: number;
  completion_percentage: number;
}

/**
 * Onboarding started tracking request
 */
export interface OnboardingStartedRequest {
  user_id: string; // UUID
}