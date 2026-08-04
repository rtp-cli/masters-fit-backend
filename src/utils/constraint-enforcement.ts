/**
 * [GQ-07] Deterministic post-generation enforcement of the user's AVOID
 * constraints. Phase 1 (GQ-03/05) made the prompt honor "no deadlifts" MOST of
 * the time, but a fan-out day call still occasionally slips a banned movement
 * back in (e.g. a "Single-Leg Deadlift Reach" survives a "no deadlifts of any
 * kind" request). This is the backstop that makes AVOID compliance reliable
 * instead of probabilistic: any generated exercise whose name matches a banned
 * term is swapped for a compliant catalog exercise (preferred) or dropped.
 *
 * Runs only when there are avoid terms AND a violation is present, so compliant
 * generations (the common case) are untouched — zero cost on the happy path.
 * Mirrors the drop-and-rewrite shape of the equipment/limitation/repetition
 * filters in post-generation-validation.ts.
 */

export interface EnforcementCatalogItem {
  name: string;
  muscleGroups?: string[];
}

export interface ConstraintViolationFinding {
  dayNumber: number;
  exerciseName: string;
  matchedTerm: string;
  action: "swapped" | "dropped";
  replacement?: string;
}

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

/** Returns the first avoid term contained in the exercise name, or null. */
function matchedAvoidTerm(
  name: string | undefined,
  terms: string[]
): string | null {
  const n = norm(name);
  if (!n) return null;
  for (const t of terms) {
    if (t && n.includes(t)) return t;
  }
  return null;
}

/**
 * Enforces avoid-terms against a generated week. Returns the repaired plan +
 * exercisesToAdd and a list of what was changed (for logging). Pure and
 * deterministic. `catalog` is the already equipment/limitation-filtered
 * exercise list the generation drew from — swap candidates come only from here,
 * so a swapped-in exercise is guaranteed valid for the user and known to the
 * persistence layer.
 */
export function enforceAvoidConstraints(
  workoutPlan: any[],
  exercisesToAdd: any[],
  avoidExerciseTerms: string[] | undefined,
  catalog: EnforcementCatalogItem[]
): {
  workoutPlan: any[];
  exercisesToAdd: any[];
  findings: ConstraintViolationFinding[];
} {
  const terms = (avoidExerciseTerms || [])
    .map((t) => norm(t))
    .filter((t) => t.length > 0);
  if (terms.length === 0) {
    return { workoutPlan, exercisesToAdd, findings: [] };
  }

  // Muscle-group lookup for choosing a like-for-like swap.
  const muscleByName = new Map<string, string[]>();
  for (const item of catalog) {
    muscleByName.set(norm(item.name), item.muscleGroups || []);
  }
  for (const added of exercisesToAdd || []) {
    if (added?.name) muscleByName.set(norm(added.name), added.muscleGroups || []);
  }

  // Compliant swap pool: catalog exercises that violate no avoid term.
  const compliantPool = catalog.filter(
    (item) => matchedAvoidTerm(item.name, terms) === null
  );

  const findings: ConstraintViolationFinding[] = [];

  const repairedPlan = workoutPlan.map((day: any) => {
    // Names already present on this day (so a swap doesn't duplicate) — seed
    // with the compliant exercises we keep.
    const usedNames = new Set<string>();
    for (const block of day.blocks || []) {
      for (const ex of block.exercises || []) {
        if (matchedAvoidTerm(ex.exerciseName, terms) === null) {
          usedNames.add(norm(ex.exerciseName));
        }
      }
    }

    const newBlocks = (day.blocks || [])
      .map((block: any) => {
        const newExercises: any[] = [];
        for (const ex of block.exercises || []) {
          const term = matchedAvoidTerm(ex.exerciseName, terms);
          if (term === null) {
            newExercises.push(ex);
            continue;
          }
          // Violation — try a like-for-like swap first.
          const removedMuscles = new Set(
            (muscleByName.get(norm(ex.exerciseName)) || []).map((m) => norm(m))
          );
          const replacement =
            // Prefer a compliant, not-yet-used exercise sharing a muscle group.
            compliantPool.find(
              (c) =>
                !usedNames.has(norm(c.name)) &&
                (c.muscleGroups || []).some((m) => removedMuscles.has(norm(m)))
            ) ||
            // Otherwise any compliant, not-yet-used exercise.
            compliantPool.find((c) => !usedNames.has(norm(c.name))) ||
            // Last resort before dropping: any compliant exercise sharing a
            // muscle group, even if already on the day. A 1:1 swap preserves the
            // day's exercise count / duration; a drop shortens it. Re-use is
            // bounded downstream by the >2×-per-day repetition cap.
            compliantPool.find((c) =>
              (c.muscleGroups || []).some((m) => removedMuscles.has(norm(m)))
            );

          if (replacement) {
            usedNames.add(norm(replacement.name));
            findings.push({
              dayNumber: day.day,
              exerciseName: ex.exerciseName,
              matchedTerm: term,
              action: "swapped",
              replacement: replacement.name,
            });
            newExercises.push({ ...ex, exerciseName: replacement.name });
          } else {
            // No compliant candidate — drop it (guarantees compliance).
            findings.push({
              dayNumber: day.day,
              exerciseName: ex.exerciseName,
              matchedTerm: term,
              action: "dropped",
            });
          }
        }
        return { ...block, exercises: newExercises };
      })
      // Remove blocks left with no exercises after drops.
      .filter((block: any) => (block.exercises || []).length > 0);

    return { ...day, blocks: newBlocks };
  });

  // Drop any invented exercises that themselves match an avoid term.
  const repairedExercisesToAdd = (exercisesToAdd || []).filter(
    (added: any) => matchedAvoidTerm(added?.name, terms) === null
  );

  return {
    workoutPlan: repairedPlan,
    exercisesToAdd: repairedExercisesToAdd,
    findings,
  };
}
