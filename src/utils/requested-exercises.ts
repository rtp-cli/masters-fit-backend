/**
 * Request-aware generation menu.
 *
 * The LLM picks exercises from a 200-item menu (`stratifyCatalog`) that
 * round-robins muscle-group buckets ~13 deep, ranking style-tagged rows first.
 * Untagged canonical movements lose that race — on 2026-09-07 a home-gym menu
 * had no Strict Pull-Up (rank 66/72 in "back"), no Barbell Bench Press (37/64
 * in "chest") and no Barbell Conventional Deadlift (98/169 in "glutes") while
 * the user's request named all three, so the model substituted the nearest
 * menu items (Band-Assisted Pull-Up, Decline Push-Up, ...). Raising the menu
 * size would not help (the cut would have to reach ~1,000 rows).
 *
 * Two deterministic pins, applied AFTER equipment + limitation filtering (they
 * only ever draw from the already-allowed pool) and BEFORE per-user exclusions:
 *   - `findRequestedExercises`: catalog rows the request text names, plus the
 *     fully-qualified aliases it uses ("bench press" → Barbell Bench Press);
 *   - `selectCanonicalBasics`: a short list of the lifts and bodyweight staples
 *     any strength/CrossFit/HIIT/functional coach expects on the menu.
 * Pins take menu slots (the limit is unchanged) so the token budget is flat.
 * Pure and exported for tests.
 */
import type { ExerciseMetadata } from "@/services/exercise.service";
import {
  EXERCISE_NAME_ALIASES,
  normalizeExerciseName,
  singularizeNormalizedName,
} from "./exercise-name-resolution";

/** Upper bound on pinned rows so a movement-heavy essay can't crowd the menu. */
export const MAX_PINNED_EXERCISES = 24;

/**
 * Staples reserved on the menu for lifting/conditioning users. Exact catalog
 * names; a name missing from the pool (equipment, limitation, or simply not in
 * the catalog) is skipped silently, so this list is safe to extend.
 */
export const CANONICAL_BASICS: readonly string[] = [
  // Bodyweight staples
  "Strict Pull-Up",
  "Push-Up",
  "Air Squat",
  "Sit-Up",
  "Burpees",
  "Hollow Hold",
  "Mountain Climbers",
  "Russian Twist",
  // Barbell canon (Wendler / Starting Strength / StrongLifts main lifts)
  "Barbell Bench Press",
  "Barbell Back Squat",
  "Barbell Front Squat",
  "Barbell Conventional Deadlift",
  "Push Press",
  "Power Clean",
  // Kettlebell / dumbbell staples
  "Kettlebell Swing",
  "Kettlebell Deadlift",
  "Goblet Squat",
  "Thruster",
  "Dumbbell Bench Press",
  "Bent-Over Dumbbell Row",
  "Box Step-Up",
];

/** Styles whose users get CANONICAL_BASICS reserved; yoga/pilates/mobility-only users don't. */
export const CANONICAL_BASICS_STYLES: ReadonlySet<string> = new Set([
  "strength",
  "crossfit",
  "hiit",
  "functional",
]);

/**
 * [LR-085] The walking staples, reserved for Walking & Movement users the same
 * way the barbell canon is reserved for lifters.
 *
 * Walking needs a pin more than the lifts ever did. stratifyCatalog buckets the
 * pool by `muscleGroups[0]` and round-robins across buckets, so a movement's
 * odds of reaching the menu depend on how crowded its bucket is — and every
 * real walk sat in `quads` (95 deep for a bodyweight-only user) while "Walking
 * in Place" sat in `cardio` (4 deep) and was drawn on the first pass. A
 * walking-modality beginner's menu therefore contained exactly one walk-shaped
 * movement: marching on the spot. The model then prescribed 25 continuous
 * minutes of it, twice, in direct violation of the prompt's own "NEVER
 * prescribe ... 'in place' cardio for this style" rule — it had no compliant
 * option to choose. Bucket depth is not a training judgement, so the fix is to
 * stop leaving this to the round-robin.
 *
 * Ordered easiest first: pins are capped at MAX_PINNED_EXERCISES, so for a
 * walking+strength user the entry-level walks must be the ones that survive.
 * `Hill Walk Repeats` is `high` and is dropped upstream for beginners by
 * filterExercisesByFitnessLevel; pins only ever draw from the already-filtered
 * pool, so it simply won't be found for them.
 */
export const WALKING_BASICS: readonly string[] = [
  "Walking",
  "Brisk Walk",
  "Incline Walk",
  "Hiking",
  "Rucking",
  "Hill Walk Repeats",
];

/** Styles whose users get WALKING_BASICS reserved. */
export const WALKING_BASICS_STYLES: ReadonlySet<string> = new Set([
  "walking_movement",
]);

/** Single-token names shorter than this are too generic to pin from prose ("row", "run", "curl"). */
const MIN_SINGLE_TOKEN_NAME_LENGTH = 5;
const MAX_ALIAS_NGRAM = 4;

/** "6x strict pull-ups, 15x push-ups" → ["6x","strict","pull","up","15x","push","up"] (plural-folded). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => singularizeNormalizedName(t));
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Same-movement key: "Air Squat" and "Air Squats" collapse to one pin. */
const movementKey = (ex: ExerciseMetadata) =>
  singularizeNormalizedName(normalizeExerciseName(ex.name));

/** Prefer a row with a demo video, then the shorter/alphabetical name — deterministic. */
function dedupeByMovement(rows: ExerciseMetadata[]): ExerciseMetadata[] {
  const byKey = new Map<string, ExerciseMetadata>();
  for (const row of rows) {
    const key = movementKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const better =
      Number(row.hasDemo ?? false) - Number(existing.hasDemo ?? false) ||
      existing.name.localeCompare(row.name);
    if (better > 0) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/**
 * Catalog rows the request names outright ("strict pull-ups" → Strict Pull-Up)
 * or via a fully-qualified alias n-gram ("bench press" → Barbell Bench Press).
 * Matching is token-sequence based (plural- and punctuation-insensitive), so
 * "Wendler 531 bench press" finds the alias but a scattered "bench ... press"
 * does not. Returns rows from `pool` only — never invents anything.
 */
export function findRequestedExercises(
  requestText: string | null | undefined,
  pool: ExerciseMetadata[]
): ExerciseMetadata[] {
  const text = requestText?.trim();
  if (!text || pool.length === 0) return [];
  const requestTokens = tokenize(text);
  if (requestTokens.length === 0) return [];

  const poolByExactLower = new Map(pool.map((ex) => [ex.name.trim().toLowerCase(), ex]));
  const hits: ExerciseMetadata[] = [];

  // 1. Names that appear verbatim (as a token sequence) in the request.
  for (const ex of pool) {
    const nameTokens = tokenize(ex.name);
    if (nameTokens.length === 0) continue;
    if (nameTokens.length === 1 && nameTokens[0].length < MIN_SINGLE_TOKEN_NAME_LENGTH) continue;
    if (containsSequence(requestTokens, nameTokens)) hits.push(ex);
  }

  // 2. Alias n-grams ("bench press", "pull ups") → their canonical row, if present in the pool.
  for (let n = 1; n <= MAX_ALIAS_NGRAM; n++) {
    for (let i = 0; i + n <= requestTokens.length; i++) {
      const gram = requestTokens.slice(i, i + n).join("");
      const canonical = EXERCISE_NAME_ALIASES[gram] ?? EXERCISE_NAME_ALIASES[`${gram}s`];
      if (!canonical) continue;
      const row = poolByExactLower.get(canonical.toLowerCase());
      if (row) hits.push(row);
    }
  }

  return dedupeByMovement(hits);
}

/**
 * The staple rows present in `pool` for this user's styles: WALKING_BASICS for
 * Walking & Movement users, CANONICAL_BASICS for lifting/conditioning users (or
 * users with no styles set). Yoga-, pilates- or mobility-only users get none —
 * their menu stays theirs.
 *
 * A user can hold both styles, and then gets both lists. Walking leads, because
 * pinExercises caps the total at MAX_PINNED_EXERCISES (24) and CANONICAL_BASICS
 * alone is 21 rows — appending walking would let the barbell canon crowd out the
 * walks for a walking+strength user, which is the exact failure this pin exists
 * to prevent.
 */
export function selectCanonicalBasics(
  pool: ExerciseMetadata[],
  preferredStyles: string[] | null | undefined
): ExerciseMetadata[] {
  if (pool.length === 0) return [];
  const styles = (preferredStyles ?? []).map((s) => s.toLowerCase());

  const names: string[] = [];
  if (styles.some((s) => WALKING_BASICS_STYLES.has(s))) names.push(...WALKING_BASICS);
  if (styles.length === 0 || styles.some((s) => CANONICAL_BASICS_STYLES.has(s))) {
    names.push(...CANONICAL_BASICS);
  }
  if (names.length === 0) return [];

  const poolByExactLower = new Map(pool.map((ex) => [ex.name.trim().toLowerCase(), ex]));
  const out: ExerciseMetadata[] = [];
  for (const name of names) {
    const row = poolByExactLower.get(name.toLowerCase());
    if (row) out.push(row);
  }
  return out;
}

/**
 * Put `pins` at the front of `menu` (marked so the prompt can label them),
 * drop menu rows that duplicate a pin, and trim to `limit` so the token budget
 * does not grow. `requested` pins outrank `canonical` ones and both are capped
 * at MAX_PINNED_EXERCISES.
 */
export function pinExercises(
  menu: ExerciseMetadata[],
  pins: { requested: ExerciseMetadata[]; canonical: ExerciseMetadata[] },
  limit: number
): ExerciseMetadata[] {
  // Dedupe on the movement key, not the exact name: a requested "Strict
  // Pull-Ups" and the canonical "Strict Pull-Up" are one pin, and the menu's
  // own "Air Squats" steps aside for a pinned "Air Squat".
  const seen = new Set<string>();
  const pinned: ExerciseMetadata[] = [];
  const take = (rows: ExerciseMetadata[], kind: NonNullable<ExerciseMetadata["pinned"]>) => {
    for (const row of rows) {
      if (pinned.length >= MAX_PINNED_EXERCISES) return;
      const key = movementKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      pinned.push({ ...row, pinned: kind });
    }
  };
  take(pins.requested, "requested");
  take(pins.canonical, "canonical");
  if (pinned.length === 0) return menu;

  const rest = menu.filter((row) => !seen.has(movementKey(row)));
  return [...pinned, ...rest].slice(0, Math.max(limit, pinned.length));
}

const renderRow = (exercise: ExerciseMetadata): string => {
  const muscleGroups =
    exercise.muscleGroups && exercise.muscleGroups.length > 0
      ? exercise.muscleGroups.join(", ")
      : "general";
  const equipmentList =
    exercise.equipment && exercise.equipment.length > 0 ? exercise.equipment.join(", ") : "bodyweight";
  const difficulty = exercise.difficulty || "moderate";
  return `- **${exercise.name}** (muscle groups: ${muscleGroups}; equipment: ${equipmentList}; difficulty: ${difficulty})\n`;
};

/**
 * The AVAILABLE EXERCISES block. One flat line per exercise ([PERF-06]); when
 * any row is pinned, those rows lead under their own heading so the model can
 * tell "the user asked for this by name" from "this is on the menu".
 */
export function formatGenerationMenu(exercises: ExerciseMetadata[]): string {
  if (exercises.length === 0) {
    return "No exercises available for the specified constraints.";
  }
  const pinned = exercises.filter((e) => e.pinned);
  if (pinned.length === 0) return exercises.map(renderRow).join("");

  const rest = exercises.filter((e) => !e.pinned);
  const requested = pinned.filter((e) => e.pinned === "requested");
  const canonical = pinned.filter((e) => e.pinned === "canonical");
  let out = "";
  if (requested.length > 0) {
    out +=
      "### NAMED IN THE USER'S REQUEST — when the request or the day's plan calls for one of these movements, use this exact entry (not a band-assisted / decline / incline / knee-tuck variant) unless a listed limitation forbids it:\n";
    out += requested.map(renderRow).join("");
    out += "\n";
  }
  if (canonical.length > 0) {
    out += "### STAPLE MOVEMENTS FOR THIS USER'S STYLE — always available; prefer these over obscure variants when a plan names the movement generically:\n";
    out += canonical.map(renderRow).join("");
    out += "\n";
  }
  out += "### FULL MENU:\n";
  out += rest.map(renderRow).join("");
  return out;
}
