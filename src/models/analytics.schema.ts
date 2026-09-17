import { z } from "zod";

// ==================== Analytics Event Schemas ====================

/**
 * Video engagement tracking schema - validates when user opens/plays exercise videos
 */
export const videoEngagementSchema = z.object({
  exercise_id: z.number().int().positive(),
  exercise_name: z.string().min(1),
  video_url: z.string().url(),
  // Where the demo was opened from. Optional so older clients still validate.
  surface: z
    .enum(["workout", "calendar_scheduled", "calendar_complete"])
    .optional(),
});

/**
 * App opened tracking schema - validates when user starts a new app session
 */
export const appOpenedSchema = z.object({
  app_version: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
});

/**
 * Workout abandoned tracking schema - validates when user abandons an active workout
 */
export const workoutAbandonedSchema = z.object({
  workout_id: z.number().int().positive(),
  plan_day_id: z.number().int().positive(),
  block_id: z.number().int().positive(),
  block_name: z.string().min(1),
});

/**
 * Workout started tracking schema - validates when user begins a workout
 */
export const workoutStartedSchema = z.object({
  workout_id: z.number().int().positive(),
  plan_day_id: z.number().int().positive(),
  workout_name: z.string().min(1),
});

/**
 * Workout completed tracking schema - validates when user finishes a workout
 */
export const workoutCompletedSchema = z.object({
  workout_id: z.number().int().positive(),
  plan_day_id: z.number().int().positive(),
  duration_ms: z.number().min(0),
  completion_percentage: z.number().min(0).max(100),
});

/**
 * Generic client event schema - the durable-mirror endpoint.
 *
 * Deliberately permissive about WHICH event: the client registry
 * (frontend/lib/analytics-events.ts) is the source of truth for event names, and
 * duplicating that allow-list here would mean a backend deploy every time a new
 * client event is added. Names are length-capped and properties must be flat and
 * PII-free -- the same contract the client registry documents.
 */
export const clientEventSchema = z.object({
  event_name: z.string().min(1).max(100),
  /** Idempotency key. apiRequest retries once after a token refresh. */
  client_event_id: z.string().min(1).max(100),
  /** Flat primitives only. Never email, name, or medical data. */
  properties: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  /** Device-side timestamp, ISO 8601. */
  occurred_at: z.string().datetime().optional(),
});
