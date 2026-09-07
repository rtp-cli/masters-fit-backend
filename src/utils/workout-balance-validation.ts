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
 *   - consecutive-day muscle overload → [GQ-10] the caller now deterministically
 *     REORDERS the days (`reorderToMinimizeConsecutiveOverload`) to break up
 *     same-muscle pairs, replacing the old corrective second planning LLM call.
 *     (`buildMuscleRebalanceFeedback` is retained for reference/tests.)
 * The MAX threshold is a considered default, not settled — easy to tune here.
 */

const MAX_EXERCISE_REPEATS_PER_DAY = 2;

/**
 * Ramping / percentage set schemes need one entry per set: Wendler 5/3/1 is
 * three warm-up + three working entries of ONE lift at six different loads,
 * a 5x5 work-up or "work up to a heavy single" looks the same. The daily cap
 * used to clip these to two entries (2026-09-07: every Wendler main lift came
 * back as two warm-up sets and nothing else) — so a block whose repeats form a
 * *ladder* is exempt from the cap, up to this many entries of that lift.
 */
export const MAX_RAMP_ENTRIES_PER_BLOCK = 8;

interface RepeatEntry {
  exerciseName?: string;
  weight?: number | null;
}
interface RepeatBlock {
  blockType?: string;
  exercises?: RepeatEntry[];
}

/**
 * True when `entries` (all occurrences of ONE exercise inside ONE block) form a
 * ramping ladder: a `traditional` strength block (or one with no type), at
 * least three entries, every load a positive number, and no two loads equal.
 * Identical-load repeats are NOT a ladder — those belong in one entry with
 * sets > 1, which is exactly the padding the cap exists to remove. Pure.
 */
export function isRampingLadder(entries: RepeatEntry[], blockType?: string): boolean {
  if (entries.length < 3) return false;
  if (blockType && blockType !== "traditional") return false;
  const loads = new Set<number>();
  for (const entry of entries) {
    const w = entry.weight;
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) return false;
    if (loads.has(w)) return false;
    loads.add(w);
  }
  return true;
}

/**
 * Per day, which entries survive the repeat rule. Ladder blocks keep up to
 * MAX_RAMP_ENTRIES_PER_BLOCK entries of the lift and do not count toward the
 * daily cap (a bench ladder plus bench in a later METCON is still fine — the
 * METCON bench is occurrence 1 of 2). Everything else gets the classic
 * "first two per day" treatment. Returns one boolean per entry per block.
 */
function planRepeatSurvivors(day: { blocks?: RepeatBlock[] }): boolean[][] {
  const seenOutsideLadders = new Map<string, number>();
  return (day.blocks || []).map((block) => {
    const exercises = block.exercises || [];
    // Group this block's entries by exercise so ladders can be recognised.
    const byName = new Map<string, number[]>();
    exercises.forEach((ex, idx) => {
      if (!ex.exerciseName) return;
      const list = byName.get(ex.exerciseName);
      if (list) list.push(idx);
      else byName.set(ex.exerciseName, [idx]);
    });
    const ladderKeep = new Set<number>();
    const ladderMember = new Set<number>();
    for (const [, idxs] of byName) {
      if (isRampingLadder(idxs.map((i) => exercises[i]), block.blockType)) {
        idxs.forEach((i, rank) => {
          ladderMember.add(i);
          if (rank < MAX_RAMP_ENTRIES_PER_BLOCK) ladderKeep.add(i);
        });
      }
    }
    return exercises.map((ex, idx) => {
      if (!ex.exerciseName) return true; // never drop an unnamed row on this basis
      if (ladderMember.has(idx)) return ladderKeep.has(idx);
      const next = (seenOutsideLadders.get(ex.exerciseName) || 0) + 1;
      seenOutsideLadders.set(ex.exerciseName, next);
      return next <= MAX_EXERCISE_REPEATS_PER_DAY;
    });
  });
}

export interface ExerciseRepetitionFinding {
  dayNumber: number;
  exerciseName: string;
  count: number;
}

/**
 * Flags exercises whose repeats within a single day exceed what the rule
 * allows — more than MAX_EXERCISE_REPEATS_PER_DAY occurrences outside a
 * ramping ladder, or a ladder longer than MAX_RAMP_ENTRIES_PER_BLOCK.
 * `count` is the total number of occurrences that day. Legitimate for a
 * superset/circuit to repeat an exercise twice; 3+ identical entries starts
 * looking like the model ran out of variety rather than intentional programming.
 */
export function checkExerciseRepetition(
  workoutPlan: Array<{ day: number; blocks?: RepeatBlock[] }>
): ExerciseRepetitionFinding[] {
  const findings: ExerciseRepetitionFinding[] = [];

  for (const day of workoutPlan) {
    const survivors = planRepeatSurvivors(day);
    const counts = new Map<string, number>();
    const dropped = new Set<string>();
    (day.blocks || []).forEach((block, b) => {
      (block.exercises || []).forEach((exercise, i) => {
        const name = exercise.exerciseName;
        if (!name) return;
        counts.set(name, (counts.get(name) || 0) + 1);
        if (!survivors[b][i]) dropped.add(name);
      });
    });
    for (const exerciseName of dropped) {
      findings.push({ dayNumber: day.day, exerciseName, count: counts.get(exerciseName) || 0 });
    }
  }

  return findings;
}

/**
 * [LR-049] Enforcement counterpart to checkExerciseRepetition: drops the
 * occurrences the rule disallows, rewriting the affected blocks (mirrors
 * validateLimitationsAndFilter's block rewrite). Returns the (possibly)
 * modified plan plus the findings, so callers still log what was capped.
 * Only whole disallowed occurrences are removed — block structure is otherwise
 * untouched, so a superset that repeats an exercise twice and a Wendler
 * ladder both survive intact.
 */
export function capExerciseRepetition(
  workoutPlan: Array<{ day: number; blocks?: RepeatBlock[] }>
): { workoutPlan: any[]; findings: ExerciseRepetitionFinding[] } {
  const findings = checkExerciseRepetition(workoutPlan);
  if (findings.length === 0) {
    return { workoutPlan, findings };
  }

  const cappedPlan = workoutPlan.map((day) => {
    const survivors = planRepeatSurvivors(day);
    return {
      ...day,
      blocks: (day.blocks || []).map((block: any, b: number) => ({
        ...block,
        exercises: (block.exercises || []).filter((_: any, i: number) => survivors[b][i]),
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
/**
 * [GQ-10] Deterministically reorder the week's days to avoid consecutive
 * training days sharing a primary muscle group — replacing the old corrective
 * SECOND planning call (an extra LLM round-trip that the planner often ignored
 * anyway). Greedy: anchor on the first day, then repeatedly append the remaining
 * day with the least primary-muscle overlap with the previously placed day.
 * Returns a NEW array, renumbered 1..N; never drops or adds a day. Now that
 * primaryMuscleGroups are drawn from the canonical enum (GQ-09), the overlap
 * comparison actually matches (previously "Lower Body" vs "quads" never did).
 */
export function reorderToMinimizeConsecutiveOverload<
  T extends { day: number; primaryMuscleGroups?: string[] }
>(days: T[]): T[] {
  if (days.length <= 2) {
    return days.map((d, i) => ({ ...d, day: i + 1 }));
  }
  const remaining = [...days];
  const result: T[] = [remaining.shift() as T];
  while (remaining.length > 0) {
    const lastMuscles = new Set(
      (result[result.length - 1].primaryMuscleGroups || []).map((g) =>
        g.toLowerCase()
      )
    );
    let bestIdx = 0;
    let bestOverlap = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const overlap = (remaining[i].primaryMuscleGroups || []).filter((g) =>
        lastMuscles.has(g.toLowerCase())
      ).length;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
        if (overlap === 0) break; // can't do better than zero
      }
    }
    result.push(remaining.splice(bestIdx, 1)[0]);
  }
  return result.map((d, i) => ({ ...d, day: i + 1 }));
}

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
