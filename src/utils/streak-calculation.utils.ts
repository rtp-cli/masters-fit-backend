export interface StreakDayData {
  /** A scheduled workout day, format YYYY-MM-DD. */
  date: string;
  /** Whether that scheduled workout was completed (planDays.isComplete). */
  isComplete: boolean;
}

/**
 * Current workout streak = consecutive *completed scheduled workouts*, counted
 * back from the most recent.
 *
 * Rest days carry no planDay, so they are simply absent from `days` and never
 * break a streak. Today's scheduled-but-not-yet-done workout doesn't break it
 * either (the day isn't over); only a *past* missed scheduled workout does.
 *
 * Counts each scheduled day at most once: if multiple plan days share a date,
 * that date counts as completed when any of them is complete.
 *
 * @param days   scheduled workout days
 * @param today  the user's local "today" (YYYY-MM-DD) — caller resolves this via
 *               the timezone precedence so the streak matches the user's real day.
 */
export function calculateScheduledWorkoutStreak(
  days: StreakDayData[],
  today: string
): number {
  // Collapse to one entry per date (complete if any plan day that date is).
  const completeByDate = new Map<string, boolean>();
  for (const day of days) {
    if (day.date > today) continue; // ignore future scheduled workouts
    completeByDate.set(
      day.date,
      (completeByDate.get(day.date) ?? false) || day.isComplete
    );
  }

  // Walk newest-first.
  const dates = [...completeByDate.keys()].sort((a, b) => (a < b ? 1 : -1));

  let streak = 0;
  for (const date of dates) {
    if (completeByDate.get(date)) {
      streak++;
      continue;
    }
    // Incomplete scheduled day:
    if (date === today) {
      continue; // today isn't over — neither counts nor breaks
    }
    break; // a past scheduled workout was missed — streak ends here
  }

  return streak;
}
