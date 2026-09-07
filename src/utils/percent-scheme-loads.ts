/**
 * Deterministic loads for percentage-based set schemes.
 *
 * 2026-09-07, workout 846 (user 3): the request stated a 1RM per lift
 * ("Wendler 531 Week 1 bench press … 1RM of 235#"). The day model (Haiku) got
 * the bench ladder right but unrounded (106, 127, 137 lb), computed the squat
 * ladder off a ~380 lb training max (341 lb "85%" against a 285 lb 1RM), and
 * for the deadlift copied Monday's bench TM ("211, 211, 211") and stopped after
 * two entries. Six-step percentage arithmetic is exactly what an LLM should
 * not be trusted with, so when the request gives us the numbers we compute the
 * ladder ourselves and overwrite whatever the model produced.
 *
 * Two pure passes, both applied after the repeat cap in
 * applyPostGenerationValidation:
 *   - applyPercentSchemeLoads: for a recognised program (Wendler 5/3/1 today)
 *     with a stated 1RM for a lift, rebuild that lift's ladder in its
 *     traditional block — canonical warm-up + working percentages of
 *     TM = 90% × 1RM, rounded UP to 5 lb, expanded to the full set count.
 *   - roundBarbellLoads: every barbell load anywhere becomes plate math
 *     (ceil to 5 lb). Dumbbells/kettlebells are fixed sizes and untouched.
 */
import type { EnforcementCatalogItem } from "./constraint-enforcement";

export type MainLift = "bench" | "squat" | "deadlift" | "press";

export interface PercentSchemeStep {
  pct: number;
  reps: number;
  /** "5+" style AMRAP last working set. */
  amrap?: boolean;
  warmup?: boolean;
}

export interface PercentScheme {
  program: "wendler";
  week: 1 | 2 | 3 | 4;
  /** Fraction of the stated 1RM that the percentages apply to. */
  trainingMaxFactor: number;
  steps: PercentSchemeStep[];
}

export const PLATE_INCREMENT_LB = 5;

/** Round UP to the nearest plate increment — 106 → 110, 137 → 140, 85 → 85. */
export function roundUpToPlate(weight: number, increment = PLATE_INCREMENT_LB): number {
  return Math.ceil(weight / increment - 1e-9) * increment;
}

const WENDLER_WARMUPS: PercentSchemeStep[] = [
  { pct: 0.4, reps: 5, warmup: true },
  { pct: 0.5, reps: 5, warmup: true },
  { pct: 0.6, reps: 3, warmup: true },
];
const WENDLER_WORKING: Record<1 | 2 | 3 | 4, PercentSchemeStep[]> = {
  1: [{ pct: 0.65, reps: 5 }, { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 5, amrap: true }],
  2: [{ pct: 0.7, reps: 3 }, { pct: 0.8, reps: 3 }, { pct: 0.9, reps: 3, amrap: true }],
  3: [{ pct: 0.75, reps: 5 }, { pct: 0.85, reps: 3 }, { pct: 0.95, reps: 1, amrap: true }],
  // Deload: 40/50/60 × 5, no separate warm-ups.
  4: [{ pct: 0.4, reps: 5 }, { pct: 0.5, reps: 5 }, { pct: 0.6, reps: 5 }],
};

/**
 * Which recognised percentage program (and week) the request names, if any.
 * "Wendler", "5/3/1", "531"; week from "Week N" / "deload" (defaults to 1).
 */
export function detectPercentScheme(text: string | null | undefined): PercentScheme | null {
  if (!text) return null;
  if (!/\bwendler\b|\b5\s*\/\s*3\s*\/\s*1\b|\b531\b/i.test(text)) return null;
  let week: 1 | 2 | 3 | 4 = 1;
  if (/\bdeload\b/i.test(text)) week = 4;
  else {
    const m = /\bweek\s*(\d)\b/i.exec(text);
    if (m && ["1", "2", "3", "4"].includes(m[1])) week = Number(m[1]) as 1 | 2 | 3 | 4;
  }
  const steps = week === 4 ? WENDLER_WORKING[4] : [...WENDLER_WARMUPS, ...WENDLER_WORKING[week]];
  return { program: "wendler", week, trainingMaxFactor: 0.9, steps };
}

const LIFT_PATTERNS: Array<[MainLift, RegExp]> = [
  ["bench", /\bbench(?:\s*press)?\b/i],
  ["deadlift", /\bdead\s*-?\s*lifts?\b/i],
  ["press", /\b(?:overhead|shoulder|strict|military|push)\s*press\b|\bohp\b/i],
  ["squat", /\bsquats?\b/i],
];

/** The single main lift a request segment talks about, or null when none/ambiguous. */
function liftInSegment(segment: string): MainLift | null {
  const hits = LIFT_PATTERNS.filter(([, re]) => re.test(segment)).map(([lift]) => lift);
  return hits.length === 1 ? hits[0] : null;
}

// "1RM of 235#", "1RM 235", "235# 1RM", "one-rep max of 235 lbs", "max of 235"
const ONE_RM_AFTER = /(?:\b1\s*-?\s*rm\b|\bone[- ]rep(?:etition)?\s+max(?:imum)?\b|\b(?:current\s+)?max\b)\D{0,20}?(\d{2,3}(?:\.\d)?)\s*(?:#|lbs?\b|pounds?\b)?/i;
const ONE_RM_BEFORE = /(\d{2,3}(?:\.\d)?)\s*(?:#|lbs?\b|pounds?\b)?\s*(?:\b1\s*-?\s*rm\b|\bone[- ]rep(?:etition)?\s+max\b)/i;

/**
 * Stated one-rep maxes per main lift. The request is split into segments
 * (lines / sentences / semicolons) and a 1RM is attributed to a lift only
 * when the segment names exactly one lift — so "bench 235, squat 285" on one
 * line without separators is left alone rather than guessed.
 */
export function parseOneRepMaxes(text: string | null | undefined): Map<MainLift, number> {
  const out = new Map<MainLift, number>();
  if (!text) return out;
  // Lines, semicolons, or a sentence end followed by a capital ("… METCON. Wednesday: …").
  // Decimals ("337.5 lb") survive because the dot must be followed by whitespace.
  const segments = text.split(/\r?\n|;|\.\s+(?=[A-Z])/);
  for (const segment of segments) {
    const m = ONE_RM_AFTER.exec(segment) ?? ONE_RM_BEFORE.exec(segment);
    if (!m) continue;
    const lift = liftInSegment(segment);
    if (!lift) continue;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value < 20 || value > 1000) continue;
    if (!out.has(lift)) out.set(lift, value);
  }
  return out;
}

/** Which main lift a catalog exercise name implements (barbell canon only). */
export function liftForExerciseName(name: string): MainLift | null {
  const n = name.toLowerCase();
  if (/bench press/.test(n) && !/dumbbell|incline|decline|close[- ]grip|floor/.test(n)) return "bench";
  if (/deadlift/.test(n) && !/romanian|rdl|sumo|stiff|single|kettlebell|dumbbell|trap bar|hex/.test(n)) return "deadlift";
  if (/(overhead|shoulder|strict|military) press/.test(n) && /barbell|standing/.test(n) && !/dumbbell|band|seated|single/.test(n)) return "press";
  if (/(back squat|barbell squat|^squat$)/.test(n) && !/front|goblet|air|box|split|bulgarian|dumbbell|band/.test(n)) return "squat";
  return null;
}

const isBarbell = (name: string, equipmentByName: Map<string, string[]>): boolean => {
  const eq = equipmentByName.get(name.trim().toLowerCase());
  if (eq) return eq.some((e) => e.toLowerCase() === "barbells");
  // Unknown to the catalog: trust the name.
  return /\bbarbell\b/i.test(name);
};

const buildEquipmentIndex = (catalog: EnforcementCatalogItem[]): Map<string, string[]> =>
  new Map(catalog.map((c) => [c.name.trim().toLowerCase(), c.equipment ?? []]));

export interface PercentSchemeFinding {
  dayNumber: number;
  exerciseName: string;
  lift: MainLift;
  oneRepMax: number;
  trainingMax: number;
  before: number[];
  after: number[];
}

/**
 * Rebuild each main-lift ladder from the stated 1RM. Only touches `traditional`
 * blocks that already contain the lift; the model still chooses WHERE the lift
 * goes, we only own the arithmetic. Entries of that lift in the block are
 * replaced (at the position of the first) by the canonical ladder, so a
 * two-entry stub becomes six and a wrong six becomes right. Pure.
 */
export function applyPercentSchemeLoads(
  workoutPlan: any[],
  requestText: string | null | undefined,
  catalog: EnforcementCatalogItem[]
): { workoutPlan: any[]; findings: PercentSchemeFinding[] } {
  const scheme = detectPercentScheme(requestText);
  const maxes = parseOneRepMaxes(requestText);
  if (!scheme || maxes.size === 0) return { workoutPlan, findings: [] };
  const equipmentByName = buildEquipmentIndex(catalog);
  const findings: PercentSchemeFinding[] = [];

  const plan = workoutPlan.map((day) => ({
    ...day,
    blocks: (day.blocks || []).map((block: any) => {
      if (block.blockType && block.blockType !== "traditional") return block;
      const exercises: any[] = block.exercises || [];
      // First entry per lift we own in this block.
      const firstIdxByLift = new Map<MainLift, number>();
      exercises.forEach((ex, idx) => {
        const lift = ex.exerciseName ? liftForExerciseName(ex.exerciseName) : null;
        if (!lift || !maxes.has(lift) || !isBarbell(ex.exerciseName, equipmentByName)) return;
        if (!firstIdxByLift.has(lift)) firstIdxByLift.set(lift, idx);
      });
      if (firstIdxByLift.size === 0) return block;

      let next: any[] = exercises;
      let instructions: string = block.instructions || "";
      for (const [lift, firstIdx] of firstIdxByLift) {
        const template = exercises[firstIdx];
        const name: string = template.exerciseName;
        const oneRepMax = maxes.get(lift)!;
        const trainingMax = Math.round(oneRepMax * scheme.trainingMaxFactor * 10) / 10;
        const mine = (ex: any) => ex.exerciseName === name;
        const before = next.filter(mine).map((ex) => Number(ex.weight) || 0);
        const ladder = scheme.steps.map((step, i) => ({
          ...template,
          sets: 1,
          reps: step.reps,
          weight: roundUpToPlate(trainingMax * step.pct),
          rpe: Math.min(10, 3 + i),
          notes: `${step.warmup ? "Warm-up" : "Working set"} at ${Math.round(step.pct * 100)}% of training max (${trainingMax} lb = 90% of ${oneRepMax} 1RM)${step.amrap ? " — as many quality reps as possible, leave 1–2 in the tank" : ""}.`,
        }));
        const insertAt = next.findIndex(mine);
        next = [...next.slice(0, insertAt).filter((ex) => !mine(ex)), ...ladder, ...next.slice(insertAt).filter((ex) => !mine(ex))];
        const after = ladder.map((ex) => ex.weight);
        findings.push({ dayNumber: day.day, exerciseName: name, lift, oneRepMax, trainingMax, before, after });
        // The model's prose often carries its own (wrong) numbers — strip them
        // and state the real loads once.
        instructions = instructions
          .replace(/\(?\b\d{2,3}(?:\.\d)?(?:\s*,\s*\d{2,3}(?:\.\d)?)*\s*(?:lbs?|#)\b\)?/gi, "")
          .replace(/\s{2,}/g, " ")
          .replace(/\s+([,.;])/g, "$1")
          .trim();
        const warm = ladder.filter((_, i) => scheme.steps[i].warmup).map((ex) => ex.weight);
        const work = ladder.filter((_, i) => !scheme.steps[i].warmup).map((ex) => ex.weight);
        instructions += `${instructions && !/[.!?]$/.test(instructions) ? "." : ""} ${name} loads (TM ${trainingMax} lb = 90% of ${oneRepMax}): ${warm.length ? `warm-up ${warm.join("/")} lb, ` : ""}working ${work.join("/")} lb.`;
      }
      // Re-sequence so the ladder order is stable for the UI.
      next = next.map((ex, i) => ({ ...ex, order: i + 1 }));
      return { ...block, exercises: next, instructions: instructions.trim() };
    }),
  }));

  return { workoutPlan: plan, findings };
}

export interface BarbellRoundingFinding {
  dayNumber: number;
  exerciseName: string;
  from: number;
  to: number;
}

/** Ceil every barbell load to plate math (5 lb). Non-barbell implements are left alone. */
export function roundBarbellLoads(
  workoutPlan: any[],
  catalog: EnforcementCatalogItem[]
): { workoutPlan: any[]; findings: BarbellRoundingFinding[] } {
  const equipmentByName = buildEquipmentIndex(catalog);
  const findings: BarbellRoundingFinding[] = [];
  const plan = workoutPlan.map((day) => ({
    ...day,
    blocks: (day.blocks || []).map((block: any) => ({
      ...block,
      exercises: (block.exercises || []).map((ex: any) => {
        const w = ex.weight;
        if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) return ex;
        if (!ex.exerciseName || !isBarbell(ex.exerciseName, equipmentByName)) return ex;
        const rounded = roundUpToPlate(w);
        if (rounded === w) return ex;
        findings.push({ dayNumber: day.day, exerciseName: ex.exerciseName, from: w, to: rounded });
        return { ...ex, weight: rounded };
      }),
    })),
  }));
  return findings.length === 0 ? { workoutPlan, findings } : { workoutPlan: plan, findings };
}
