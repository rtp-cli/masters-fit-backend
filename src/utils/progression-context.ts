/**
 * [LR-014] Every week was generated cold — no memory of what happened the
 * prior week. This builds a small, prompt-injectable progression hint from
 * the user's most recent previous week's completion rate (the fraction of
 * scheduled days they actually completed, already computed by
 * WorkoutService.getPreviousWorkouts).
 *
 * Deliberately conservative and simple for a first pass: a completion-rate
 * based nudge, not per-exercise weight/rep tracking (that would need
 * set-level completion data this pipeline doesn't currently surface to the
 * generator). The exact thresholds (80% / 50%) are a first draft, not a
 * final answer — flagged for review.
 */
export function buildProgressionContext(
  previousWeekCompletionRate: number | null
): string {
  if (previousWeekCompletionRate === null) {
    return "";
  }

  if (previousWeekCompletionRate >= 80) {
    return `

## PROGRESSION CONTEXT
The user completed ${previousWeekCompletionRate}% of last week's scheduled workouts — a strong week. Nudge intensity/volume up modestly this week (e.g. slightly higher reps, sets, or weight than a typical baseline week for this user's level) rather than repeating the exact same prescription.`;
  }

  if (previousWeekCompletionRate < 50) {
    return `

## PROGRESSION CONTEXT
The user completed only ${previousWeekCompletionRate}% of last week's scheduled workouts. Hold intensity/volume steady or ease back slightly this week rather than increasing — prioritize consistency and re-engagement over progression right now.`;
  }

  return `

## PROGRESSION CONTEXT
The user completed ${previousWeekCompletionRate}% of last week's scheduled workouts — a moderate week. Keep this week's intensity/volume roughly the same as a typical baseline week; no aggressive progression or reduction warranted.`;
}
