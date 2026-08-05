/**
 * [GQ-11] Muscle-load validation on the ACTUAL generated exercises.
 *
 * GQ-10 balances the PLAN's per-day primaryMuscleGroups focus, but the exercises
 * a day actually gets can still pile incidental load onto a muscle the day was
 * never meant to feature (e.g. a "back day" whose rows + presses quietly hammer
 * shoulders), and that muscle can then get hit again the next day — the exact
 * "muscle group overload" complaint that kicked off this whole effort (user 41).
 * This module computes per-day load from the real exercises (canonical muscle
 * groups from GQ-09), flags non-focus dominance and consecutive-day overlap, and
 * repairs it by ALIGNING each day to its intended focus: it swaps out only
 * "off-focus filler" exercises (ones doing ZERO focus work) for focus-matching
 * catalog exercises, so intended training is never removed — incidental overload
 * is strictly reduced.
 */

import { normalizeMuscleGroups } from "@/constants/muscle-groups";

// Ubiquitous / stabilizer groups excluded from "major mover" load: core is
// tagged on ~43% of exercises, full_body / cardio are non-specific. Counting
// them would drown out the heavy movers that actually cause overload.
export const STABILIZER_MUSCLES = new Set(["core", "full_body", "cardio"]);

// A non-focus muscle is "over-loaded" on a day when it carries at least this
// many sets AND this share of the day's major-mover volume.
const NONFOCUS_MIN_LOAD = 6;
const NONFOCUS_MIN_SHARE = 0.3;
// A muscle is "heavy" on a day (for consecutive-overlap purposes) at this load.
const HEAVY_MIN_LOAD = 8;

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

export type MuscleByExercise = Map<string, string[]>;

/**
 * Builds a name -> canonical-muscle-groups lookup from the filtered catalog
 * (already canonical) plus the model-invented exercisesToAdd (raw LLM labels,
 * normalized here so the load model only ever sees canonical groups).
 */
export function buildMuscleByExercise(
  catalog: Array<{ name: string; muscleGroups?: string[] }>,
  exercisesToAdd: Array<{ name?: string; muscleGroups?: string[] }>
): MuscleByExercise {
  const map: MuscleByExercise = new Map();
  for (const item of catalog) {
    map.set(norm(item.name), (item.muscleGroups || []).map(norm));
  }
  for (const added of exercisesToAdd || []) {
    if (!added?.name) continue;
    map.set(norm(added.name), normalizeMuscleGroups(added.muscleGroups).groups);
  }
  return map;
}

/**
 * name -> style tag (strength/crossfit/yoga/rehab/…). Used so a focus-alignment
 * swap stays within the SAME modality — otherwise a strength press could be
 * "balanced" by swapping in a recovery/mobility item that merely matches the
 * muscle filter (a real bug the naive version produced).
 */
export function buildTagByExercise(
  catalog: Array<{ name: string; tag?: string }>,
  exercisesToAdd: Array<{ name?: string; tag?: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of catalog) {
    if (item.tag) map.set(norm(item.name), norm(item.tag));
  }
  for (const added of exercisesToAdd || []) {
    if (added?.name && added.tag) map.set(norm(added.name), norm(added.tag));
  }
  return map;
}

// Secondary muscles get partial credit: an exercise's FIRST listed muscle is
// its primary mover (the convention stratifyCatalog already relies on), the
// rest are secondary. Without this, every press/row tagging "shoulders" as a
// secondary inflates shoulder load and produces phantom overload.
const SECONDARY_WEIGHT = 0.5;

/** Volume a single exercise contributes: sets × rounds (circuits repeat sets). */
function exerciseVolume(ex: any, block: any): number {
  const sets = ex.sets && ex.sets > 0 ? ex.sets : 1;
  const rounds = block.rounds && block.rounds > 1 ? block.rounds : 1;
  return sets * rounds;
}

export interface DayMuscleLoad {
  dayNumber: number;
  /** Major-mover muscle -> total volume (stabilizers excluded). */
  load: Map<string, number>;
  total: number;
}

/** Per-day major-mover load from the day's actual exercises. */
export function computeDayMuscleLoad(
  day: any,
  muscleByExercise: MuscleByExercise
): DayMuscleLoad {
  const load = new Map<string, number>();
  for (const block of day.blocks || []) {
    for (const ex of block.exercises || []) {
      const muscles = muscleByExercise.get(norm(ex.exerciseName)) || [];
      const vol = exerciseVolume(ex, block);
      muscles.forEach((m, i) => {
        if (STABILIZER_MUSCLES.has(m)) return;
        const weight = i === 0 ? 1 : SECONDARY_WEIGHT; // first = primary mover
        load.set(m, (load.get(m) || 0) + vol * weight);
      });
    }
  }
  let total = 0;
  for (const v of load.values()) total += v;
  return { dayNumber: day.day, load, total };
}

export interface NonFocusDominanceFinding {
  dayNumber: number;
  muscle: string;
  load: number;
  share: number;
}

/**
 * Non-focus muscles carrying a disproportionate share of a day's volume — i.e.
 * the day is incidentally over-training a muscle it wasn't meant to feature.
 */
export function findNonFocusDominance(
  dayLoad: DayMuscleLoad,
  focusMuscles: Set<string>
): NonFocusDominanceFinding[] {
  const findings: NonFocusDominanceFinding[] = [];
  if (dayLoad.total <= 0) return findings;
  for (const [muscle, load] of dayLoad.load) {
    if (focusMuscles.has(muscle)) continue;
    const share = load / dayLoad.total;
    if (load >= NONFOCUS_MIN_LOAD && share >= NONFOCUS_MIN_SHARE) {
      findings.push({ dayNumber: dayLoad.dayNumber, muscle, load, share });
    }
  }
  return findings;
}

export interface ConsecutiveOverlapFinding {
  firstDay: number;
  secondDay: number;
  muscle: string;
  firstLoad: number;
  secondLoad: number;
}

/**
 * Muscles heavily loaded on two CALENDAR-adjacent days (adjacency provided by
 * the caller from the real schedule dates, so rest-day gaps don't count).
 */
export function findConsecutiveMuscleOverlap(
  dayLoads: DayMuscleLoad[],
  adjacentPairs: Array<[number, number]>
): ConsecutiveOverlapFinding[] {
  const byDay = new Map(dayLoads.map((d) => [d.dayNumber, d]));
  const findings: ConsecutiveOverlapFinding[] = [];
  for (const [a, b] of adjacentPairs) {
    const da = byDay.get(a);
    const db = byDay.get(b);
    if (!da || !db) continue;
    for (const [muscle, firstLoad] of da.load) {
      const secondLoad = db.load.get(muscle) || 0;
      if (firstLoad >= HEAVY_MIN_LOAD && secondLoad >= HEAVY_MIN_LOAD) {
        findings.push({ firstDay: a, secondDay: b, muscle, firstLoad, secondLoad });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Repair: align each day to its intended focus
// ---------------------------------------------------------------------------

export interface FocusAlignmentFinding {
  dayNumber: number;
  removed: string;
  replacement: string;
  overloadedMuscle: string;
}

const matchedAvoidTerm = (name: string, terms: string[]): boolean =>
  terms.some((t) => t && norm(name).includes(t));

/**
 * [GQ-11] Deterministically reduces incidental non-focus muscle overload by
 * swapping OFF-FOCUS filler exercises (exercises doing zero focus work) for
 * focus-matching catalog exercises. Never touches an exercise that contributes
 * to the day's focus, so intended training is preserved — this can only make a
 * day MORE aligned with its planned focus. Bounded to `maxSwapsPerDay`.
 */
export function alignDaysToFocus(
  workoutPlan: any[],
  dayFocus: Map<number, string[]>,
  muscleByExercise: MuscleByExercise,
  catalog: Array<{ name: string; muscleGroups?: string[] }>,
  tagByExercise: Map<string, string>,
  avoidTerms: string[] = [],
  adjacentPairs: Array<[number, number]> = [],
  maxSwapsPerDay = 2
): { workoutPlan: any[]; findings: FocusAlignmentFinding[] } {
  const terms = (avoidTerms || []).map(norm).filter((t) => t.length >= 3);
  const findings: FocusAlignmentFinding[] = [];

  const musclesOf = (name: string): string[] =>
    muscleByExercise.get(norm(name)) || [];
  const tagOf = (name: string): string | undefined =>
    tagByExercise.get(norm(name));

  // [GQ-11] Which NON-FOCUS muscles each day should shed because they overlap a
  // calendar-adjacent day (only where the muscle isn't that day's focus — we
  // never fight a legitimate back-to-back focus, that's a planning concern).
  const initialLoads = workoutPlan.map((d) =>
    computeDayMuscleLoad(d, muscleByExercise)
  );
  const overlapTargets = new Map<number, Set<string>>();
  for (const o of findConsecutiveMuscleOverlap(initialLoads, adjacentPairs)) {
    for (const dn of [o.firstDay, o.secondDay]) {
      const f = new Set((dayFocus.get(dn) || []).map(norm));
      if (!f.has(o.muscle)) {
        if (!overlapTargets.has(dn)) overlapTargets.set(dn, new Set());
        overlapTargets.get(dn)!.add(o.muscle);
      }
    }
  }

  const repaired = workoutPlan.map((day) => {
    const focus = new Set((dayFocus.get(day.day) || []).map(norm));
    if (focus.size === 0) return day; // no focus to align to

    // Copy blocks/exercises before any mutation.
    const blocks = (day.blocks || []).map((b: any) => ({
      ...b,
      exercises: (b.exercises || []).map((e: any) => ({ ...e })),
    }));
    const newDay = { ...day, blocks };

    const usedNames = new Set<string>();
    for (const b of blocks)
      for (const e of b.exercises || []) usedNames.add(norm(e.exerciseName));

    const compliantPool = catalog.filter((c) => !matchedAvoidTerm(c.name, terms));
    const dayOverlap = overlapTargets.get(day.day) || new Set<string>();
    const attempted = new Set<string>(); // muscles we couldn't fix — don't retry

    for (let swap = 0; swap < maxSwapsPerDay; swap++) {
      const dayLoad = computeDayMuscleLoad(newDay, muscleByExercise);

      // Problem non-focus muscles: either dominating this day, or heavy AND
      // overlapping an adjacent day. Highest load first.
      const problems = new Map<string, number>();
      for (const f of findNonFocusDominance(dayLoad, focus)) {
        problems.set(f.muscle, f.load);
      }
      for (const m of dayOverlap) {
        problems.set(m, Math.max(problems.get(m) || 0, dayLoad.load.get(m) || 0));
      }
      const ranked = [...problems.entries()]
        .filter(([m]) => !attempted.has(m))
        .sort((a, b) => b[1] - a[1]);
      if (ranked.length === 0) break;
      const overloaded = ranked[0][0];

      // Find a victim exercise that loads the overloaded muscle. Prefer pure
      // off-focus filler (safe to drop entirely), then a focus-doing exercise
      // (we'll preserve its focus contribution in the replacement). Only
      // consider victims whose style tag is known, so we can hold the swap to
      // the SAME modality.
      let victimBlock: any = null;
      let victimIdx = -1;
      let victimFocus: string[] = [];
      let victimTag: string | undefined;
      for (const preferFiller of [true, false]) {
        for (const b of blocks) {
          const list = b.exercises || [];
          for (let i = 0; i < list.length; i++) {
            const m = musclesOf(list[i].exerciseName);
            if (!m.includes(overloaded)) continue;
            const tag = tagOf(list[i].exerciseName);
            if (!tag) continue; // unknown modality — don't risk a bad swap
            const fm = m.filter((x) => focus.has(x));
            const isFiller = fm.length === 0;
            if (preferFiller !== isFiller) continue;
            victimBlock = b;
            victimIdx = i;
            victimFocus = fm;
            victimTag = tag;
            break;
          }
          if (victimBlock) break;
        }
        if (victimBlock) break;
      }
      if (!victimBlock) {
        attempted.add(overloaded);
        continue;
      }

      // Replacement: SAME modality (style tag) as the victim, must NOT reload the
      // overloaded muscle, must preserve the victim's focus contribution (or, for
      // pure filler, hit any focus muscle), compliant + not already used. The
      // same-tag rule prevents a strength lift being "balanced" into a recovery /
      // mobility item that merely matches the muscle filter.
      const wantFocus = victimFocus.length > 0 ? victimFocus : [...focus];
      const replacement = compliantPool.find((c) => {
        const cm = (c.muscleGroups || []).map(norm);
        return (
          tagOf(c.name) === victimTag &&
          !usedNames.has(norm(c.name)) &&
          !cm.includes(overloaded) &&
          cm.some((x) => wantFocus.includes(x))
        );
      });
      if (!replacement) {
        attempted.add(overloaded);
        continue;
      }

      const removed = victimBlock.exercises[victimIdx];
      usedNames.delete(norm(removed.exerciseName));
      usedNames.add(norm(replacement.name));
      victimBlock.exercises[victimIdx] = {
        ...removed,
        exerciseName: replacement.name,
        // Different movement — drop the old load/format numbers (see GQ-07).
        weight: 0,
        duration: 0,
        distanceM: 0,
        reps: removed.reps && removed.reps > 0 ? removed.reps : 10,
        notes: "Adjusted to keep the day focused and avoid overtraining one area.",
      };
      findings.push({
        dayNumber: day.day,
        removed: removed.exerciseName,
        replacement: replacement.name,
        overloadedMuscle: overloaded,
      });
    }

    return findings.some((f) => f.dayNumber === day.day) ? newDay : day;
  });

  return { workoutPlan: repaired, findings };
}
