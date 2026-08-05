/**
 * [Duration] Deterministic post-generation duration backstop.
 *
 * Diagnosis: the fan-out day model has a ~4-block "default workout size" and
 * plateaus around 55-60 min regardless of the target, so long sessions
 * (75/90 min) land well short — despite very explicit prompt instructions. Like
 * the AVOID case (GQ-07), prompt volume alone doesn't make Haiku comply, so this
 * guarantees the duration the user asked for: any day whose blocks sum to under
 * (target - tolerance) is padded by adding real work — extra sets to strength
 * blocks, extra rounds to circuits — and each padded block's
 * blockDurationMinutes is bumped by that block's OWN implied per-unit time, so
 * the numbers stay internally consistent and the padding is honest (the user
 * actually performs the added work).
 *
 * Only pads UNDER-target days (the common failure); over-target and in-range
 * days are untouched. Warmup/cooldown blocks are never padded. Runs LAST in the
 * post-generation pipeline, after equipment/limitation/AVOID/repetition changes,
 * so it pads the final plan.
 */

const WARMUP_COOLDOWN = new Set(["warmup", "cooldown"]);
// Blocks whose real duration scales with an extra ROUND (you simply do the
// circuit/flow one more time). Deliberately EXCLUDES amrap/emom/tabata/for_time:
// their duration is pinned by timeCapMinutes / a rep scheme / a fixed round
// count, so bumping `rounds` would add minutes the user never actually trains
// (the app runs the cap/scheme regardless).
const ROUND_PADDABLE = new Set(["circuit", "flow"]);
// Blocks whose real duration scales with an extra SET per exercise.
const SET_PADDABLE = new Set(["traditional", "superset"]);

const MAX_SETS_PER_EXERCISE = 6;
const MAX_ROUNDS = 8;
const MAX_ITERATIONS = 40;

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

export interface DurationPadFinding {
  dayNumber: number;
  before: number;
  after: number;
  target: number;
}

const blockMinutes = (block: any): number => block.blockDurationMinutes || 0;
const dayTotal = (day: any): number =>
  (day.blocks || []).reduce((s: number, b: any) => s + blockMinutes(b), 0);

/**
 * How a block can be honestly grown, or null if it can't be:
 *   "rounds" — a plain circuit/flow, +1 round;
 *   "sets"   — a traditional/superset block, +1 set on each exercise.
 * Time-capped or rep-scheme blocks (amrap/emom/tabata/for_time, or anything
 * carrying timeCapMinutes / protocolConfig.repScheme) return null — their
 * duration is fixed by the cap/scheme and padding them would be dishonest.
 * Returns null once the block hits its set/round cap.
 */
function padMode(block: any): "rounds" | "sets" | null {
  const type = norm(block.blockType);
  if (WARMUP_COOLDOWN.has(type)) return null;
  if (!Array.isArray(block.exercises) || block.exercises.length === 0) return null;
  if ((block.blockDurationMinutes || 0) <= 0) return null;
  // Duration pinned by a time cap or a rep scheme — never pad.
  if ((block.timeCapMinutes || 0) > 0) return null;
  if ((block.protocolConfig?.repScheme?.length || 0) > 0) return null;

  if (ROUND_PADDABLE.has(type)) {
    const rounds = block.rounds && block.rounds > 0 ? block.rounds : 1;
    return rounds < MAX_ROUNDS ? "rounds" : null;
  }
  if (SET_PADDABLE.has(type)) {
    const maxSets = block.exercises.reduce(
      (m: number, e: any) => Math.max(m, e.sets || 0),
      0
    );
    const totalSets = block.exercises.reduce(
      (s: number, e: any) => s + (e.sets || 0),
      0
    );
    return totalSets > 0 && maxSets < MAX_SETS_PER_EXERCISE ? "sets" : null;
  }
  return null;
}

/** Minutes one "unit" would add, using the block's own reported duration as the
 * per-unit basis. 0 when the block can't be padded. */
function unitGain(block: any): number {
  const minutes = blockMinutes(block);
  const mode = padMode(block);
  if (mode === "rounds") {
    const rounds = block.rounds && block.rounds > 0 ? block.rounds : 1;
    return minutes / rounds; // one more round
  }
  if (mode === "sets") {
    const totalSets = (block.exercises || []).reduce(
      (s: number, e: any) => s + (e.sets || 0),
      0
    );
    if (totalSets <= 0) return 0;
    return (minutes / totalSets) * block.exercises.length; // +1 set each
  }
  return 0;
}

/** Applies one unit to a block, mutating it. blockDurationMinutes stays an
 * integer so there's no cumulative rounding drift. */
function applyUnit(block: any): void {
  const mode = padMode(block);
  const gain = unitGain(block);
  if (gain <= 0) return;
  if (mode === "rounds") {
    block.rounds = (block.rounds && block.rounds > 0 ? block.rounds : 1) + 1;
  } else {
    for (const ex of block.exercises || []) ex.sets = (ex.sets || 0) + 1;
  }
  block.blockDurationMinutes = Math.round(blockMinutes(block) + gain);
}

/**
 * Pads under-target days to within tolerance of `targetMinutes`. Pure: returns a
 * new plan (blocks/exercises are copied before mutation) plus findings for
 * logging. Days already within tolerance (or with no padable block) are returned
 * unchanged.
 */
export function padDaysToTargetDuration(
  workoutPlan: any[],
  targetMinutes: number,
  toleranceMinutes: number
): { workoutPlan: any[]; findings: DurationPadFinding[] } {
  const findings: DurationPadFinding[] = [];
  const floor = targetMinutes - toleranceMinutes;

  const padded = workoutPlan.map((day) => {
    const before = dayTotal(day);
    if (before >= floor) return day;

    // Copy the day's blocks/exercises so we never mutate the input.
    const blocks = (day.blocks || []).map((b: any) => ({
      ...b,
      exercises: (b.exercises || []).map((e: any) => ({ ...e })),
    }));
    const newDay = { ...day, blocks };

    const padable = blocks.filter((b: any) => padMode(b) !== null);
    if (padable.length === 0) return day; // nothing safe to grow

    const ceiling = targetMinutes + toleranceMinutes;
    let iterations = 0;
    while (dayTotal(newDay) < floor && iterations < MAX_ITERATIONS) {
      iterations++;
      const current = dayTotal(newDay);
      // Choose the unit that fills the most of the remaining gap WITHOUT
      // exceeding target+tolerance — so one big block (e.g. a 20-min circuit at
      // rounds=1) can't overshoot from 51 to 71 on a single bump.
      let choice: any = null;
      let bestResulting = -Infinity;
      for (const b of padable) {
        const gain = unitGain(b);
        if (gain <= 0) continue;
        const resulting = current + gain;
        if (resulting <= ceiling && resulting > bestResulting) {
          bestResulting = resulting;
          choice = b;
        }
      }
      if (!choice) break; // capped, or every remaining unit would overshoot
      applyUnit(choice);
    }

    // blockDurationMinutes stayed integer throughout, and only padded blocks
    // changed — so an untouched day compares equal and logs no finding.
    const after = dayTotal(newDay);
    if (after !== before) {
      findings.push({ dayNumber: day.day, before, after, target: targetMinutes });
    }
    return newDay;
  });

  return { workoutPlan: padded, findings };
}
