/**
 * [LR-049] Two quality issues the LLM generation pipeline doesn't reliably
 * self-enforce: the same exercise repeated too often within one workout, and
 * the same muscle group getting heavy focus on consecutive days.
 *
 * These started as detect-and-log (the check* functions below still power that
 * logging), but detection alone let violations ship. Enforcement now layers on
 * top, mirroring the LR-012/LR-013 filter pattern:
 *   - within-day repetition → `capExerciseRepetition` deterministically drops
 *     occurrences of an exercise beyond MAX_EXERCISE_REPEATS_PER_DAY. Dropping
 *     a 3rd+ copy of the SAME exercise is safe (it reads as the model running
 *     out of variety, not intentional structure) and mirrors how the limitation
 *     filter rewrites blocks.
 *   - consecutive-day muscle overload → the caller re-plans once using
 *     `buildMuscleRebalanceFeedback` (the fan-out day calls run in parallel with
 *     no shared context, so the planning stage is the only place to fix it).
 * The MAX threshold is a considered default, not settled — easy to tune here.
 */

const MAX_EXERCISE_REPEATS_PER_DAY = 2;

export interface ExerciseRepetitionFinding {
  dayNumber: number;
  exerciseName: string;
  count: number;
}

/**
 * Counts how many times each exercise name appears across all blocks in a
 * single day. Flags any exercise appearing more than
 * MAX_EXERCISE_REPEATS_PER_DAY times — legitimate for a superset/circuit to
 * repeat an exercise twice, but 3+ times in one workout starts looking like
 * the model ran out of variety rather than intentional programming.
 */
export function checkExerciseRepetition(
  workoutPlan: Array<{ day: number; blocks?: Array<{ exercises?: Array<{ exerciseName?: string }> }> }>
): ExerciseRepetitionFinding[] {
  const findings: ExerciseRepetitionFinding[] = [];

  for (const day of workoutPlan) {
    const counts = new Map<string, number>();
    for (const block of day.blocks || []) {
      for (const exercise of block.exercises || []) {
        const name = exercise.exerciseName;
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    for (const [exerciseName, count] of counts) {
      if (count > MAX_EXERCISE_REPEATS_PER_DAY) {
        findings.push({ dayNumber: day.day, exerciseName, count });
      }
    }
  }

  return findings;
}

/**
 * [LR-049] Enforcement counterpart to checkExerciseRepetition: keeps the first
 * MAX_EXERCISE_REPEATS_PER_DAY occurrences of each exercise per day and drops
 * any beyond that, rewriting the affected blocks (mirrors
 * validateLimitationsAndFilter's block rewrite). Returns the (possibly)
 * modified plan plus the findings, so callers still log what was capped.
 * Only whole extra occurrences are removed — block structure is otherwise
 * untouched, so a legitimate superset that repeats an exercise twice survives.
 */
export function capExerciseRepetition(
  workoutPlan: Array<{ day: number; blocks?: Array<{ exercises?: Array<{ exerciseName?: string }> }> }>
): { workoutPlan: any[]; findings: ExerciseRepetitionFinding[] } {
  const findings = checkExerciseRepetition(workoutPlan);
  if (findings.length === 0) {
    return { workoutPlan, findings };
  }

  const cappedPlan = workoutPlan.map((day) => {
    const seen = new Map<string, number>();
    return {
      ...day,
      blocks: (day.blocks || []).map((block: any) => ({
        ...block,
        exercises: (block.exercises || []).filter((ex: any) => {
          const name = ex.exerciseName;
          if (!name) return true; // never drop an unnamed row on this basis
          const nextCount = (seen.get(name) || 0) + 1;
          seen.set(name, nextCount);
          return nextCount <= MAX_EXERCISE_REPEATS_PER_DAY;
        }),
      })),
    };
  });

  return { workoutPlan: cappedPlan, findings };
}

export interface MuscleGroupOverloadFinding {
  firstDay: number;
  secondDay: number;
  sharedMuscleGroups: string[];
}

/**
 * Flags consecutive (by day number, not counting rest days) day pairs that
 * share a primary muscle group focus — e.g. two heavy leg days back to
 * back. Only compares ADJACENT scheduled days, since the planning stage
 * assigns primaryMuscleGroups per day before per-day generation happens
 * (the one point in the pipeline where cross-day context actually exists —
 * the parallel fan-out day calls don't see each other's output).
 */
export function checkConsecutiveMuscleGroupOverload(
  days: Array<{ day: number; primaryMuscleGroups?: string[] }>
): MuscleGroupOverloadFinding[] {
  const findings: MuscleGroupOverloadFinding[] = [];
  const sorted = [...days].sort((a, b) => a.day - b.day);

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (next.day !== current.day + 1) continue; // not actually consecutive (rest day between)

    const currentGroups = new Set(
      (current.primaryMuscleGroups || []).map((g) => g.toLowerCase())
    );
    const shared = (next.primaryMuscleGroups || [])
      .map((g) => g.toLowerCase())
      .filter((g) => currentGroups.has(g));

    if (shared.length > 0) {
      findings.push({
        firstDay: current.day,
        secondDay: next.day,
        sharedMuscleGroups: shared,
      });
    }
  }

  return findings;
}

/**
 * [LR-049] Corrective instruction appended to a one-shot planning retry when
 * the first plan stacked the same primary muscle group on consecutive training
 * days. Names the offending day pairs so the planner has concrete targets to
 * redistribute, rather than repeating the same soft "balance the week" hint it
 * already ignored. Returns "" when there is nothing to correct.
 */
export function buildMuscleRebalanceFeedback(
  findings: MuscleGroupOverloadFinding[]
): string {
  if (findings.length === 0) return "";
  const pairs = findings
    .map(
      (f) =>
        `Day ${f.firstDay} and Day ${f.secondDay} both target ${f.sharedMuscleGroups.join(", ")}`
    )
    .join("; ");
  return `IMPORTANT — REBALANCE REQUIRED: your previous plan put the same primary muscle group on consecutive training days (${pairs}). Redesign the weekly split so no two consecutive training days share a primary muscle group. Redistribute the per-day focus and muscle-group assignments across the week; keep the same number of days and continue honoring the user's preferred styles, limitations, and goals.`;
}
