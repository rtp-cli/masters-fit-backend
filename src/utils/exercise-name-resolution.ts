/**
 * Name-matching helpers for resolving LLM-emitted exercise names against the
 * catalog at persist time.
 *
 * Background (2026-09-07 forensics, workout 845): 3.6% of generated exercises
 * were silently dropped because `lower(name)` had to match exactly — 57 of the
 * last 84 misses were nothing but a straight vs curly apostrophe ("Farmer's
 * Carry" vs "Farmer’s Carry"), and a Wendler deadlift block persisted EMPTY
 * because the model wrote "Barbell Deadlift" while the catalog row is
 * "Barbell Conventional Deadlift". These helpers are pure; the DB passes live
 * in ExerciseService.resolveExercisesByNames.
 */

/** Lowercase, strip everything but a-z0-9 — "Farmer’s Carry" == "farmers carry" == "farmerscarry". */
export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Drop a single trailing plural "s" from an already-normalized name so
 * "kettlebellswings" meets "kettlebellswing". Leaves "ss" endings ("press")
 * and very short tokens alone.
 */
export function singularizeNormalizedName(normalized: string): string {
  if (normalized.length > 3 && normalized.endsWith("s") && !normalized.endsWith("ss")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Fully-qualified aliases only (normalized alias → exact catalog name). Bare
 * family words are deliberately absent: "deadlift" alone must NOT resolve to a
 * specific variant (RDL vs sumo vs conventional are different lifts).
 *
 * Keep the right-hand side an exact, existing catalog `name` — the resolver
 * looks it up with the same exact-match pass it uses for everything else, so a
 * stale alias degrades to "unresolved" (logged), never to a wrong row.
 */
export const EXERCISE_NAME_ALIASES: Readonly<Record<string, string>> = {
  // Wendler / powerlifting canon (rule 7 makes the model write these)
  barbelldeadlift: "Barbell Conventional Deadlift",
  conventionaldeadlift: "Barbell Conventional Deadlift",
  benchpress: "Barbell Bench Press",
  flatbenchpress: "Barbell Bench Press",
  backsquat: "Barbell Back Squat",
  // Calisthenics canon
  pullup: "Strict Pull-Up",
  pullups: "Strict Pull-Up",
  strictpullup: "Strict Pull-Up",
  pushups: "Push-Up",
  situps: "Sit-Up",
};

/** The exact catalog name an alias points at, or undefined when `name` is not an alias. */
export function canonicalNameForAlias(name: string): string | undefined {
  return EXERCISE_NAME_ALIASES[normalizeExerciseName(name)];
}
