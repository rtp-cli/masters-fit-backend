import { addDays } from "@/utils/date.utils";

/**
 * [LR-024] The workout date search only accepted exact YYYY-MM-DD. Resolves
 * natural-language phrases against an already-resolved, timezone-aware
 * "today" string (from resolveTodayString) — this function does no
 * timezone math itself, just day arithmetic on top of a caller-supplied
 * today, so it stays pure and easily testable.
 *
 * "this week"/"last week" use a rolling 7-day window (today-6..today, and
 * today-13..today-7), matching the same convention already used by
 * WorkoutService.getPreviousWorkouts's "week" filter — not a calendar week
 * (Mon-Sun) — for consistency with the rest of the codebase, not because
 * one is more "correct" than the other.
 */
export type ResolvedDateQuery =
  | { type: "single"; date: string }
  | { type: "range"; startDate: string; endDate: string };

const RECOGNIZED_PHRASES = new Set([
  "today",
  "yesterday",
  "this week",
  "last week",
]);

export function isRecognizedDatePhrase(input: string): boolean {
  return RECOGNIZED_PHRASES.has(input.trim().toLowerCase());
}

/**
 * Returns null if the input isn't a recognized phrase — callers should fall
 * back to parsing it as an exact YYYY-MM-DD date, unchanged from before.
 */
export function resolveDatePhrase(
  input: string,
  todayString: string
): ResolvedDateQuery | null {
  const phrase = input.trim().toLowerCase();

  switch (phrase) {
    case "today":
      return { type: "single", date: todayString };
    case "yesterday":
      return { type: "single", date: addDays(todayString, -1) };
    case "this week":
      return {
        type: "range",
        startDate: addDays(todayString, -6),
        endDate: todayString,
      };
    case "last week":
      return {
        type: "range",
        startDate: addDays(todayString, -13),
        endDate: addDays(todayString, -7),
      };
    default:
      return null;
  }
}
