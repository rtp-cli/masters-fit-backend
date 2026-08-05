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
// Blocks whose duration scales with rounds rather than sets.
const ROUNDS_BASED = new Set([
  "circuit",
  "amrap",
  "emom",
  "for_time",
  "tabata",
  "flow",
]);

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

const isPadable = (block: any): boolean =>
  !WARMUP_COOLDOWN.has(norm(block.blockType)) &&
  Array.isArray(block.exercises) &&
  block.exercises.length > 0;

/**
 * Minutes one "unit" would add to a block (a round for rounds-based blocks, a
 * set-per-exercise for others), using the block's own reported duration as the
 * per-unit basis. Returns 0 when the block is capped or has no basis to estimate.
 */
function unitGain(block: any): number {
  const minutes = blockMinutes(block);
  if (minutes <= 0) return 0;
  if (ROUNDS_BASED.has(norm(block.blockType))) {
    const rounds = block.rounds && block.rounds > 0 ? block.rounds : 1;
    if (rounds >= MAX_ROUNDS) return 0;
    return minutes / rounds; // one more round
  }
  const exercises = block.exercises || [];
  const totalSets = exercises.reduce((s: number, e: any) => s + (e.sets || 0), 0);
  const maxSets = exercises.reduce((m: number, e: any) => Math.max(m, e.sets || 0), 0);
  if (totalSets <= 0 || maxSets >= MAX_SETS_PER_EXERCISE) return 0;
  const perSet = minutes / totalSets;
  return perSet * exercises.length; // one more set on each exercise
}

/** Applies one unit to a block, mutating it, and returns the minutes added. */
function applyUnit(block: any): number {
  const gain = unitGain(block);
  if (gain <= 0) return 0;
  if (ROUNDS_BASED.has(norm(block.blockType))) {
    block.rounds = (block.rounds && block.rounds > 0 ? block.rounds : 1) + 1;
  } else {
    for (const ex of block.exercises || []) ex.sets = (ex.sets || 0) + 1;
  }
  block.blockDurationMinutes = blockMinutes(block) + gain;
  return gain;
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

    const padable = blocks.filter(isPadable);
    if (padable.length === 0) return day; // nothing safe to grow

    let iterations = 0;
    while (dayTotal(newDay) < floor && iterations < MAX_ITERATIONS) {
      iterations++;
      // Pick the smallest positive unit for fine-grained control (avoids large
      // overshoot from bumping a big block by a full round).
      let target: any = null;
      let smallest = Infinity;
      for (const b of padable) {
        const gain = unitGain(b);
        if (gain > 0 && gain < smallest) {
          smallest = gain;
          target = b;
        }
      }
      if (!target) break; // everything capped
      applyUnit(target);
    }

    // Round each padded block's minutes back to a clean integer.
    for (const b of blocks) {
      b.blockDurationMinutes = Math.round(blockMinutes(b));
    }
    const after = dayTotal(newDay);
    if (after !== before) {
      findings.push({ dayNumber: day.day, before, after, target: targetMinutes });
    }
    return newDay;
  });

  return { workoutPlan: padded, findings };
}
