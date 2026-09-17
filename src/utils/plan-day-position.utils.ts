/**
 * Where a newly inserted plan day sits in a plan's dayNumber sequence.
 *
 * Pure so the off-by-one — which is invisible in the database and only shows up
 * as a plan that reads in the wrong order — can be tested without a DB.
 */

/**
 * @param existingDates every existing plan day's date in the plan, any order
 * @param date          the date being inserted
 * @param asAdditionalSession [LR-069] this is a BONUS session on a date that
 *   already has one. Same-date days then count as already ahead of it, so the
 *   bonus lands after the session it supplements. Without this the new day
 *   takes the original's position and pushes the original down, so the plan
 *   reads as though the evening top-up came before the morning workout.
 * @returns the 1-based dayNumber the new day should take
 */
export function resolveInsertPosition(
  existingDates: string[],
  date: string,
  asAdditionalSession = false
): number {
  return (
    existingDates.filter((existing) =>
      asAdditionalSession ? existing <= date : existing < date
    ).length + 1
  );
}
