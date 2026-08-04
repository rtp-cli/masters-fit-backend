/**
 * [GQ-13] Automated compliance scoring for the generation eval harness.
 *
 * Given a generated weekly workout and the set of checks a scenario declares,
 * score how well the output honored the request. Pure and deterministic so the
 * same generated plan always scores the same — the harness runs these before
 * and after a prompt change and compares the deltas. Kept independent of the DB
 * and the LLM so it is unit-testable.
 *
 * Equipment/muscle data for exercises the model chose from the catalog comes in
 * via `exerciseMeta` (looked up by the harness); exercises the model invented
 * (`exercisesToAdd`) carry their own equipment inline and are merged in by the
 * harness before scoring.
 */

/** Equipment tokens that mean "needs no equipment". */
const BODYWEIGHT_TOKENS = new Set(["bodyweight", "none", "body weight", ""]);

export interface ScoredExercise {
  exerciseName?: string;
}

export interface ScoredBlock {
  blockType?: string;
  blockDurationMinutes?: number;
  exercises?: ScoredExercise[];
}

export interface ScoredDay {
  day: number;
  blocks?: ScoredBlock[];
}

export interface ScoredWorkout {
  workoutPlan: ScoredDay[];
}

export interface ExerciseMeta {
  equipment: string[];
  muscleGroups: string[];
}

export type ComplianceCheck =
  /** No exercise name contains `needle` (case-insensitive) — exclusion asks. */
  | { id: string; label: string; type: "excludes"; needle: string }
  /** No exercise on day `dayNumber` contains `needle` — calendar/day-scoped asks. */
  | { id: string; label: string; type: "excludesOnDay"; dayNumber: number; needle: string }
  /** Every exercise on day `dayNumber` needs no equipment. */
  | { id: string; label: string; type: "equipmentFreeDay"; dayNumber: number }
  /** Every exercise in the whole plan needs no equipment. */
  | { id: string; label: string; type: "equipmentFreeAll" }
  /** At least one block anywhere has this blockType. */
  | { id: string; label: string; type: "blockTypeSomewhere"; blockType: string }
  /** No block anywhere has this blockType — "no AMRAPs / no circuits" asks. */
  | { id: string; label: string; type: "blockTypeAbsent"; blockType: string }
  /** Every day has at least one block of this blockType. */
  | { id: string; label: string; type: "blockTypeEachDay"; blockType: string }
  /** Fraction of days whose summed block duration is within ±tolerance of target. */
  | {
      id: string;
      label: string;
      type: "durationCompliance";
      targetMinutes: number;
      toleranceMinutes: number;
    }
  /** No exercise appears more than twice within a single day. */
  | { id: string; label: string; type: "noRepeatOverTwice" };

export interface CheckResult {
  id: string;
  label: string;
  type: string;
  score: number; // 0..1
  passed: boolean; // score === 1
  detail: string;
}

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

const needsNoEquipment = (
  name: string | undefined,
  meta: Map<string, ExerciseMeta>
): boolean => {
  const equip = meta.get(norm(name))?.equipment;
  // Unknown exercise with no metadata — treat as bodyweight (conservative: the
  // model marks equipment-requiring invented exercises in exercisesToAdd, which
  // the harness merges in, so a genuine miss here is rare).
  if (!equip || equip.length === 0) return true;
  return equip.every((e) => BODYWEIGHT_TOKENS.has(norm(e)));
};

const allExercises = (
  workout: ScoredWorkout
): { dayNumber: number; name: string | undefined; blockType: string | undefined }[] => {
  const out: { dayNumber: number; name: string | undefined; blockType: string | undefined }[] = [];
  for (const day of workout.workoutPlan || []) {
    for (const block of day.blocks || []) {
      for (const ex of block.exercises || []) {
        out.push({ dayNumber: day.day, name: ex.exerciseName, blockType: block.blockType });
      }
    }
  }
  return out;
};

function runCheck(
  check: ComplianceCheck,
  workout: ScoredWorkout,
  meta: Map<string, ExerciseMeta>
): CheckResult {
  const base = { id: check.id, label: check.label, type: check.type };

  switch (check.type) {
    case "excludes": {
      const needle = check.needle.toLowerCase();
      const hits = allExercises(workout).filter((e) => norm(e.name).includes(needle));
      const passed = hits.length === 0;
      return {
        ...base,
        score: passed ? 1 : 0,
        passed,
        detail: passed
          ? `no "${check.needle}" present`
          : `found ${hits.length}: ${[...new Set(hits.map((h) => h.name))].join(", ")}`,
      };
    }

    case "excludesOnDay": {
      const needle = check.needle.toLowerCase();
      const dayEx = allExercises(workout).filter((e) => e.dayNumber === check.dayNumber);
      const hits = dayEx.filter((e) => norm(e.name).includes(needle));
      const passed = hits.length === 0;
      return {
        ...base,
        score: passed ? 1 : 0,
        passed,
        detail: passed
          ? `no "${check.needle}" on day ${check.dayNumber}`
          : `day ${check.dayNumber} has ${hits.length}: ${[...new Set(hits.map((h) => h.name))].join(", ")}`,
      };
    }

    case "equipmentFreeDay": {
      const dayEx = allExercises(workout).filter((e) => e.dayNumber === check.dayNumber);
      if (dayEx.length === 0) {
        return { ...base, score: 0, passed: false, detail: `day ${check.dayNumber} has no exercises` };
      }
      const offenders = dayEx.filter((e) => !needsNoEquipment(e.name, meta));
      const score = (dayEx.length - offenders.length) / dayEx.length;
      return {
        ...base,
        score,
        passed: offenders.length === 0,
        detail:
          offenders.length === 0
            ? `all ${dayEx.length} exercises on day ${check.dayNumber} are bodyweight`
            : `${offenders.length}/${dayEx.length} need equipment: ${offenders
                .map((o) => o.name)
                .join(", ")}`,
      };
    }

    case "equipmentFreeAll": {
      const ex = allExercises(workout);
      if (ex.length === 0) return { ...base, score: 0, passed: false, detail: "no exercises" };
      const offenders = ex.filter((e) => !needsNoEquipment(e.name, meta));
      const score = (ex.length - offenders.length) / ex.length;
      return {
        ...base,
        score,
        passed: offenders.length === 0,
        detail:
          offenders.length === 0
            ? `all ${ex.length} exercises are bodyweight`
            : `${offenders.length}/${ex.length} need equipment: ${[
                ...new Set(offenders.map((o) => o.name)),
              ].join(", ")}`,
      };
    }

    case "blockTypeSomewhere": {
      const want = check.blockType.toLowerCase();
      const found = (workout.workoutPlan || []).some((d) =>
        (d.blocks || []).some((b) => norm(b.blockType) === want)
      );
      return {
        ...base,
        score: found ? 1 : 0,
        passed: found,
        detail: found ? `${check.blockType} block present` : `no ${check.blockType} block anywhere`,
      };
    }

    case "blockTypeAbsent": {
      const want = check.blockType.toLowerCase();
      const offenders = (workout.workoutPlan || []).flatMap((d) =>
        (d.blocks || [])
          .filter((b) => norm(b.blockType) === want)
          .map(() => d.day)
      );
      const passed = offenders.length === 0;
      return {
        ...base,
        score: passed ? 1 : 0,
        passed,
        detail: passed
          ? `no ${check.blockType} blocks present`
          : `${offenders.length} ${check.blockType} block(s) on day(s) ${[...new Set(offenders)].join(", ")}`,
      };
    }

    case "blockTypeEachDay": {
      const want = check.blockType.toLowerCase();
      const days = workout.workoutPlan || [];
      if (days.length === 0) return { ...base, score: 0, passed: false, detail: "no days" };
      const withType = days.filter((d) => (d.blocks || []).some((b) => norm(b.blockType) === want));
      const score = withType.length / days.length;
      return {
        ...base,
        score,
        passed: withType.length === days.length,
        detail: `${withType.length}/${days.length} days have a ${check.blockType} block`,
      };
    }

    case "durationCompliance": {
      const days = workout.workoutPlan || [];
      if (days.length === 0) return { ...base, score: 0, passed: false, detail: "no days" };
      const perDay = days.map((d) => {
        const total = (d.blocks || []).reduce((s, b) => s + (b.blockDurationMinutes || 0), 0);
        return { day: d.day, total };
      });
      const within = perDay.filter(
        (d) => Math.abs(d.total - check.targetMinutes) <= check.toleranceMinutes
      );
      const score = within.length / perDay.length;
      const offenders = perDay.filter(
        (d) => Math.abs(d.total - check.targetMinutes) > check.toleranceMinutes
      );
      return {
        ...base,
        score,
        passed: offenders.length === 0,
        detail:
          offenders.length === 0
            ? `all ${perDay.length} days within ±${check.toleranceMinutes} of ${check.targetMinutes}m`
            : `off-target: ${offenders.map((o) => `d${o.day}=${o.total}m`).join(", ")} (target ${check.targetMinutes})`,
      };
    }

    case "noRepeatOverTwice": {
      const offenders: string[] = [];
      for (const day of workout.workoutPlan || []) {
        const counts = new Map<string, number>();
        for (const block of day.blocks || []) {
          for (const ex of block.exercises || []) {
            const n = norm(ex.exerciseName);
            if (!n) continue;
            counts.set(n, (counts.get(n) || 0) + 1);
          }
        }
        for (const [n, c] of counts) {
          if (c > 2) offenders.push(`d${day.day}:${n}×${c}`);
        }
      }
      return {
        ...base,
        score: offenders.length === 0 ? 1 : 0,
        passed: offenders.length === 0,
        detail: offenders.length === 0 ? "no exercise repeated >2× in a day" : offenders.join(", "),
      };
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = check;
      return { ...base, score: 0, passed: false, detail: `unknown check ${(_never as any).type}` };
    }
  }
}

export interface WorkoutScore {
  results: CheckResult[];
  /** Mean of all check scores, 0..1. */
  overall: number;
}

export function scoreWorkout(
  workout: ScoredWorkout,
  meta: Map<string, ExerciseMeta>,
  checks: ComplianceCheck[]
): WorkoutScore {
  const results = checks.map((c) => runCheck(c, workout, meta));
  const overall = results.length
    ? results.reduce((s, r) => s + r.score, 0) / results.length
    : 0;
  return { results, overall };
}
