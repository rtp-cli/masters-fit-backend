/**
 * [LR-049] Detects two quality issues the LLM generation pipeline doesn't
 * currently guard against: the same exercise repeated too often within one
 * workout, and the same muscle group getting heavy focus on consecutive
 * days. Both are detect-and-log, not auto-fix — unlike LR-012's equipment
 * mismatch (a hard usability blocker), these are programming-quality
 * signals where auto-rewriting a day's plan risks breaking a legitimately
 * structured circuit/superset, so this is deliberately observational for
 * now. The exact thresholds below are a first draft, not a final answer —
 * flagged clearly for review, not treated as settled.
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
