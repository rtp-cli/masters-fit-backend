/**
 * Where a newly inserted plan day sits in a plan's dayNumber sequence.
 *
 * Pure so the off-by-one — which is invisible in the database and only shows up
 * as a plan that reads in the wrong order — can be tested without a DB.
 */

export interface ExistingPlanDay {
  date: string;
  /** Nullable in the schema; 12 production plans have no dayNumber at all. */
  dayNumber?: number | null;
}

/**
 * @param existing every existing plan day in the plan, any order
 * @param date     the date being inserted
 * @param asAdditionalSession [LR-069] this is a BONUS session on a date that
 *   already has one. Same-date days then count as already ahead of it, so the
 *   bonus lands after the session it supplements. Without this the new day
 *   takes the original's position and pushes the original down, so the plan
 *   reads as though the evening top-up came before the morning workout.
 * @returns the dayNumber the new day should take
 *
 * BASE-AGNOSTIC BY DESIGN. This used to return `count of earlier days + 1`,
 * which silently assumed every plan numbers its days from 1. Production
 * disagrees: 246 plans start at 0, 50 start at 1, one starts at 4, and 12 have
 * no dayNumber at all. On a 0-based plan that returned a number one too high —
 * a bonus session on the 17th landed at 5 while the 18th sat at 4, so the plan
 * sorted the top-up after the following day.
 *
 * Deriving the value from the NEIGHBOURS' actual numbers instead of from a
 * count is correct whatever base a given plan happens to use.
 */
export function resolveInsertPosition(
  existing: ExistingPlanDay[],
  date: string,
  asAdditionalSession = false
): number {
  const numberOf = (d: ExistingPlanDay) => d.dayNumber ?? 0;

  const before = existing.filter((d) =>
    asAdditionalSession ? d.date <= date : d.date < date
  );

  // Slot in directly after the last day that precedes this one.
  if (before.length > 0) {
    return Math.max(...before.map(numberOf)) + 1;
  }

  // Inserting at the very front: take the plan's own first number and let the
  // caller push everything else down, so the plan keeps whatever base it had.
  if (existing.length > 0) {
    return Math.min(...existing.map(numberOf));
  }

  // Empty plan. Unreachable via createPlanDayForRestDay, which always has a
  // workout to insert into; 1 matches how new plans are numbered today.
  return 1;
}
