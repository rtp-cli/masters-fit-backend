/**
 * Canonical Mixpanel event names emitted by the BACKEND.
 *
 * Convention: snake_case `domain_action`, matching the client registry
 * (frontend `lib/analytics-events.ts`). Both systems key `distinct_id` on the
 * user's uuid so client- and server-emitted events resolve to one person.
 *
 * Ownership rule (single owner per event):
 *  - Server-authoritative FACTS (verified generation outcomes, replacements)
 *    are owned here.
 *  - User-native funnel/interaction events (paywall, onboarding steps,
 *    onboarding_completed, screen views, exercise_logged) are owned by the
 *    CLIENT and are intentionally absent from this list.
 *
 * The generation facts are namespaced with `server_` on purpose: the client
 * emits its own user-PERCEIVED `workout_generation_*` events (the wait/journey),
 * and these server facts (with llm_model / error_type) must NOT collide with them.
 *
 * See the event map doc for the full client + server catalog.
 */
export const BACKEND_ANALYTICS_EVENT = {
  APP_OPENED: "app_opened",
  VIDEO_LINK_OPENED: "video_link_opened",
  WORKOUT_ABANDONED: "workout_abandoned",
  WORKOUT_STARTED: "workout_started",
  WORKOUT_COMPLETED: "workout_completed",
  EXERCISE_REPLACED: "exercise_replaced",
  // Server-authoritative generation facts — see the `server_` note above.
  SERVER_WORKOUT_GENERATED: "server_workout_generated",
  SERVER_WORKOUT_GENERATION_FAILED: "server_workout_generation_failed",
} as const;

export type BackendAnalyticsEventName =
  (typeof BACKEND_ANALYTICS_EVENT)[keyof typeof BACKEND_ANALYTICS_EVENT];
