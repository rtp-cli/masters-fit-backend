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
// Never trim a working block below this many sets per exercise, or below one
// exercise — past that it stops being the workout the plan described.
const MIN_SETS_PER_EXERCISE = 2;
// Only rewrite a declared duration when the prescribed work exceeds it by more
// than this. Keeps rounding and honest estimation noise from churning the plan.
const RECONCILE_MARGIN_MINUTES = 3;

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

export interface DurationPadFinding {
  dayNumber: number;
  before: number;
  after: number;
  target: number;
}

/** One block whose declared duration understated its own prescribed work. */
export interface DurationReconcileFinding {
  dayNumber: number;
  blockName: string;
  declared: number;
  estimated: number;
}

/** One day trimmed back to the user's time budget. */
export interface DurationTrimFinding {
  dayNumber: number;
  before: number;
  after: number;
  target: number;
  setsRemoved: number;
  exercisesRemoved: string[];
}

const blockMinutes = (block: any): number => block.blockDurationMinutes || 0;
const dayTotal = (day: any): number =>
  (day.blocks || []).reduce((s: number, b: any) => s + blockMinutes(b), 0);

/**
 * [Duration honesty] Seconds one working rep takes, by rep count.
 *
 * Rest dominates a strength block's clock — in the prod sample behind this it
 * was 85-95% of the total — so this only has to be roughly right. Higher-rep
 * sets are lighter and move faster, hence the taper.
 */
function secondsPerRep(reps: number): number {
  if (reps <= 12) return 3.5;
  if (reps <= 20) return 2.5;
  return 2;
}

/**
 * [Duration honesty] What a block's PRESCRIBED WORK actually takes, in minutes,
 * derived from sets/reps/rest rather than the model's self-report.
 *
 * Returns null for any block whose duration is not a function of its sets; the
 * caller then keeps the declared value:
 *   - amrap/emom/tabata/for_time — the time cap or rep scheme IS the duration;
 *   - circuit/flow — rounds x work, which the prod sample did not show broken;
 *   - warmup/cooldown — fixed short blocks.
 * Scoping to traditional/superset matches exactly where the breakage was
 * measured, so the estimate never second-guesses a block it cannot model well
 * (50 jump-rope singles is nothing like 50 strength reps).
 *
 * Rest counts once per set, the final set included: that trailing rest is the
 * transition into the next exercise or block, so it is real time the session
 * spends.
 */
export function estimateBlockMinutes(block: any): number | null {
  const type = norm(block?.blockType);
  if (!SET_PADDABLE.has(type)) return null;
  const exercises = Array.isArray(block?.exercises) ? block.exercises : [];
  if (exercises.length === 0) return null;

  let seconds = 0;
  for (const ex of exercises) {
    const sets = Math.max(Number(ex?.sets) || 0, 0);
    if (sets === 0) continue;
    const reps = Math.max(Number(ex?.reps) || 0, 0);
    const held = Math.max(Number(ex?.duration) || 0, 0);
    const rest = Math.max(Number(ex?.restTime) || 0, 0);
    // A time-based entry states its own per-set seconds; a rep-based one is
    // reps x tempo.
    const workPerSet = held > 0 ? held : reps * secondsPerRep(reps);
    seconds += sets * (workPerSet + rest);
  }
  if (seconds <= 0) return null;
  return seconds / 60;
}

/**
 * [Duration honesty] Replaces a block's declared blockDurationMinutes with the
 * estimate when the declaration UNDERSTATES the prescribed work by more than
 * RECONCILE_MARGIN_MINUTES. Mutates the blocks it corrects.
 *
 * Deliberately one-directional. Understatement is the failure that was measured
 * — 49 of 177 prod strength blocks over 30 days declared a duration their own
 * prescribed rest already consumed, before a single rep — and it is the one
 * that hurts the user: the session silently runs long against her time budget.
 * Correcting OVERstatement downward would feed the padder and add volume nobody
 * has validated, so it is left alone.
 */
export function reconcileDeclaredDurations(
  day: any
): DurationReconcileFinding[] {
  const findings: DurationReconcileFinding[] = [];
  for (const block of day.blocks || []) {
    const estimated = estimateBlockMinutes(block);
    if (estimated === null) continue;
    const declared = blockMinutes(block);
    if (estimated - declared <= RECONCILE_MARGIN_MINUTES) continue;
    const corrected = Math.round(estimated);
    findings.push({
      dayNumber: day.day,
      blockName: block.blockName || "(unnamed block)",
      declared,
      estimated: corrected,
    });
    block.blockDurationMinutes = corrected;
  }
  return findings;
}

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

/** Minutes one "unit" would add. 0 when the block can't be padded.
 *
 * For set-based blocks the basis is the ESTIMATE (sets/reps/rest), not the
 * block's own reported duration: deriving per-set time from a number the model
 * invented was circular, so a block that understated itself also understated
 * every set added to it. Rounds-based circuits/flows can't be estimated, so
 * they still divide their declared duration by their round count. */
function unitGain(block: any): number {
  const mode = padMode(block);
  if (mode === "rounds") {
    const rounds = block.rounds && block.rounds > 0 ? block.rounds : 1;
    return blockMinutes(block) / rounds; // one more round
  }
  if (mode === "sets") {
    const exercises = block.exercises || [];
    const totalSets = exercises.reduce(
      (s: number, e: any) => s + (e.sets || 0),
      0
    );
    if (totalSets <= 0) return 0;
    const basis = estimateBlockMinutes(block) ?? blockMinutes(block);
    return (basis / totalSets) * exercises.length; // +1 set each
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
  block.blockDurationMinutes = restateBlockMinutes(block, gain);
}

/**
 * The block's stated duration after a change of `delta` minutes.
 *
 * The estimate is used ONLY as a floor — the stated number may never drop below
 * the work the block actually prescribes. It deliberately does NOT replace an
 * OVERSTATED declaration with the (smaller) estimate: that would be the
 * downward correction reconcileDeclaredDurations refuses to make, arriving
 * through the back door. Both padding and trimming therefore move the number by
 * one honest unit at a time.
 */
function restateBlockMinutes(block: any, delta: number): number {
  const estimated = estimateBlockMinutes(block);
  const shifted = blockMinutes(block) + delta;
  return Math.round(
    estimated === null ? shifted : Math.max(shifted, estimated)
  );
}

/** Minutes the block's estimate loses across `mutate` — the exact honest cost
 * of whatever was just removed. 0 when the block can't be estimated. */
function applyShrink(block: any, mutate: () => void): void {
  const before = estimateBlockMinutes(block);
  mutate();
  const after = estimateBlockMinutes(block);
  const delta = before !== null && after !== null ? after - before : 0;
  block.blockDurationMinutes = restateBlockMinutes(block, delta);
}

/** Removes one set from the exercise carrying the most, or returns false when
 * nothing in the block can shed a set without going below the floor. */
function removeOneSet(block: any): boolean {
  if (!SET_PADDABLE.has(norm(block.blockType))) return false;
  const exercises = block.exercises || [];
  let target: any = null;
  for (const ex of exercises) {
    const sets = Number(ex?.sets) || 0;
    if (sets <= MIN_SETS_PER_EXERCISE) continue;
    if (!target || sets > (Number(target.sets) || 0)) target = ex;
  }
  if (!target) return false;
  applyShrink(block, () => {
    target.sets = (Number(target.sets) || 0) - 1;
  });
  return true;
}

/** Drops the block's LAST exercise — the accessory position — or returns null
 * when the block is down to its final movement. */
function removeLastExercise(block: any): string | null {
  if (!SET_PADDABLE.has(norm(block.blockType))) return null;
  const exercises = block.exercises || [];
  if (exercises.length <= 1) return null;
  let dropped: any = null;
  applyShrink(block, () => {
    [dropped] = exercises.splice(exercises.length - 1, 1);
  });
  return dropped?.exerciseName || "(unnamed exercise)";
}

/**
 * Fits every day to `targetMinutes` +/- tolerance. Pure: returns a new plan
 * (blocks/exercises are copied before mutation) plus findings for logging.
 *
 * Three steps per day, in order:
 *   1. RECONCILE — rewrite any declared block duration that understates its own
 *      prescribed work, so steps 2/3 act on real minutes rather than the
 *      model's self-report;
 *   2. PAD — grow an under-target day (the original backstop);
 *   3. TRIM — shrink an over-target day by removing sets, then accessory
 *      exercises. New: overshoots used to be left alone, which is how a 30-min
 *      request shipped ~40 minutes of work.
 *
 * A day needs at most one of pad/trim, since reconcile only ever moves a day
 * upward.
 */
export function fitDaysToTargetDuration(
  workoutPlan: any[],
  targetMinutes: number,
  toleranceMinutes: number
): {
  workoutPlan: any[];
  findings: DurationPadFinding[];
  reconcileFindings: DurationReconcileFinding[];
  trimFindings: DurationTrimFinding[];
} {
  const findings: DurationPadFinding[] = [];
  const reconcileFindings: DurationReconcileFinding[] = [];
  const trimFindings: DurationTrimFinding[] = [];

  // No budget, nothing to fit against — including no trimming, which would
  // otherwise read a target of 0 as "cut everything".
  if (!(targetMinutes > 0)) {
    return { workoutPlan, findings, reconcileFindings, trimFindings };
  }

  const floor = targetMinutes - toleranceMinutes;
  const ceiling = targetMinutes + toleranceMinutes;

  const fitted = workoutPlan.map((day) => {
    // Copy the day's blocks/exercises so we never mutate the input.
    const blocks = (day.blocks || []).map((b: any) => ({
      ...b,
      exercises: (b.exercises || []).map((e: any) => ({ ...e })),
    }));
    const newDay = { ...day, blocks };

    // 1. Make the numbers honest before deciding whether the day fits.
    const reconciled = reconcileDeclaredDurations(newDay);
    reconcileFindings.push(...reconciled);
    const before = dayTotal(newDay);

    if (before < floor) {
      const padable = blocks.filter((b: any) => padMode(b) !== null);
      let iterations = 0;
      while (
        padable.length > 0 &&
        dayTotal(newDay) < floor &&
        iterations < MAX_ITERATIONS
      ) {
        iterations++;
        const current = dayTotal(newDay);
        // Choose the unit that fills the most of the remaining gap WITHOUT
        // exceeding target+tolerance — so one big block (e.g. a 20-min circuit
        // at rounds=1) can't overshoot from 51 to 71 on a single bump.
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
    } else if (before > ceiling) {
      // Shed sets from the biggest offender first, then accessory exercises —
      // the same order the corrective-retry prompt asks the model for, done
      // deterministically instead. Time-capped and circuit blocks are never
      // touched: their duration is the cap, not the set count.
      const trimmable = blocks.filter((b: any) =>
        SET_PADDABLE.has(norm(b.blockType))
      );
      let setsRemoved = 0;
      const exercisesRemoved: string[] = [];
      let iterations = 0;
      while (
        trimmable.length > 0 &&
        dayTotal(newDay) > ceiling &&
        iterations < MAX_ITERATIONS
      ) {
        iterations++;
        const biggest = trimmable.reduce((a: any, b: any) =>
          blockMinutes(b) > blockMinutes(a) ? b : a
        );
        if (removeOneSet(biggest)) {
          setsRemoved++;
          continue;
        }
        const dropped = removeLastExercise(biggest);
        if (dropped) {
          exercisesRemoved.push(dropped);
          continue;
        }
        // This block is at its floor; stop considering it.
        trimmable.splice(trimmable.indexOf(biggest), 1);
      }
      if (setsRemoved > 0 || exercisesRemoved.length > 0) {
        trimFindings.push({
          dayNumber: day.day,
          before,
          after: dayTotal(newDay),
          target: targetMinutes,
          setsRemoved,
          exercisesRemoved,
        });
        return newDay;
      }
    }

    // Padding is the only path that still reports a DurationPadFinding; trims
    // report their own shape above. Compare against the post-reconcile total so
    // a reconcile-only day isn't miscounted as padded.
    const after = dayTotal(newDay);
    if (after !== before) {
      findings.push({
        dayNumber: day.day,
        before,
        after,
        target: targetMinutes,
      });
      return newDay;
    }
    // Nothing grew or shrank: keep the reconciled copy only if reconcile
    // actually rewrote a block, otherwise hand back the untouched input so
    // callers and tests see referential equality.
    return reconciled.length > 0 ? newDay : day;
  });

  return { workoutPlan: fitted, findings, reconcileFindings, trimFindings };
}
