import { EnforcementCatalogItem } from "./constraint-enforcement";

/**
 * [GQ-06] Deterministic post-generation enforcement of PER-DAY equipment rules —
 * specifically "bodyweight-only" days (the travel-day case: "make Wednesday
 * bodyweight since I'm on the road"). The whole-plan equipment filter
 * (validateEquipmentAndFilter) only knows the user's overall equipment set; it
 * has no notion that ONE day must be equipment-free. Before this, a bodyweight-
 * only day was honored only if the model happened to comply. This is the backstop
 * that makes it reliable: any exercise on a flagged day that needs equipment is
 * swapped for a bodyweight catalog exercise (preferred, like-for-like muscle) or
 * dropped.
 *
 * Runs only when there are flagged days AND a violation is present, so the common
 * case (no equipment-free day requested) is untouched. Mirrors the drop-and-swap
 * shape of enforceAvoidConstraints.
 */

const BODYWEIGHT_TOKENS = new Set(["bodyweight", "none", "body weight", ""]);

const norm = (s: string | undefined): string => (s || "").trim().toLowerCase();

/** True when an exercise needs no equipment (empty list, or all bodyweight tokens). */
export function isBodyweightEquipment(
  equipment: string[] | undefined | null
): boolean {
  if (!equipment || equipment.length === 0) return true;
  return equipment.every((e) => BODYWEIGHT_TOKENS.has(norm(e)));
}

export interface BodyweightDayFinding {
  dayNumber: number;
  exerciseName: string;
  action: "swapped" | "dropped";
  replacement?: string;
}

/**
 * Enforces bodyweight-only days against a generated week. Equipment metadata for
 * each exercise comes from `catalog` (the equipment/limitation-filtered list the
 * generation drew from) and inline from `exercisesToAdd`; an exercise not found
 * in either is treated as bodyweight (no equipment known → don't fabricate a
 * violation). Swap candidates are drawn only from the bodyweight subset of the
 * catalog, so a swapped-in exercise is valid for the user and known to
 * persistence. Pure and deterministic.
 */
export function enforceBodyweightOnlyDays(
  workoutPlan: any[],
  exercisesToAdd: any[],
  bodyweightOnlyDays: number[] | undefined,
  catalog: EnforcementCatalogItem[]
): {
  workoutPlan: any[];
  findings: BodyweightDayFinding[];
} {
  const flagged = new Set(
    (bodyweightOnlyDays || []).filter((d) => Number.isFinite(d))
  );
  if (flagged.size === 0) {
    return { workoutPlan, findings: [] };
  }

  // Equipment + muscle lookups by exercise name (catalog first, then inline
  // invented exercises which carry their own equipment).
  const equipmentByName = new Map<string, string[] | undefined>();
  const muscleByName = new Map<string, string[]>();
  for (const item of catalog) {
    equipmentByName.set(norm(item.name), item.equipment);
    muscleByName.set(norm(item.name), item.muscleGroups || []);
  }
  for (const added of exercisesToAdd || []) {
    if (added?.name) {
      equipmentByName.set(norm(added.name), added.equipment);
      muscleByName.set(norm(added.name), added.muscleGroups || []);
    }
  }

  // An exercise is a violation on a bodyweight-only day when we KNOW it needs
  // equipment. Unknown equipment (not in either map) is treated as compliant so
  // we never swap out a legitimately-bodyweight movement we simply lack data for.
  const needsEquipment = (name: string | undefined): boolean => {
    const key = norm(name);
    if (!equipmentByName.has(key)) return false;
    return !isBodyweightEquipment(equipmentByName.get(key));
  };

  // Bodyweight swap pool: catalog exercises that need no equipment.
  const bodyweightPool = catalog.filter((c) =>
    isBodyweightEquipment(c.equipment)
  );

  const findings: BodyweightDayFinding[] = [];

  const repairedPlan = workoutPlan.map((day: any) => {
    if (!flagged.has(day.day)) return day;

    // Names already on this day that are compliant (bodyweight) — so a swap
    // doesn't duplicate.
    const usedNames = new Set<string>();
    for (const block of day.blocks || []) {
      for (const ex of block.exercises || []) {
        if (!needsEquipment(ex.exerciseName)) {
          usedNames.add(norm(ex.exerciseName));
        }
      }
    }

    const newBlocks = (day.blocks || [])
      .map((block: any) => {
        const newExercises: any[] = [];
        for (const ex of block.exercises || []) {
          if (!needsEquipment(ex.exerciseName)) {
            newExercises.push(ex);
            continue;
          }
          const removedMuscles = new Set(
            (muscleByName.get(norm(ex.exerciseName)) || []).map((m) => norm(m))
          );
          const replacement =
            // Prefer a bodyweight, not-yet-used exercise sharing a muscle group.
            bodyweightPool.find(
              (c) =>
                !usedNames.has(norm(c.name)) &&
                (c.muscleGroups || []).some((m) => removedMuscles.has(norm(m)))
            ) ||
            // Otherwise any bodyweight, not-yet-used exercise.
            bodyweightPool.find((c) => !usedNames.has(norm(c.name)));

          if (replacement) {
            usedNames.add(norm(replacement.name));
            findings.push({
              dayNumber: day.day,
              exerciseName: ex.exerciseName,
              action: "swapped",
              replacement: replacement.name,
            });
            newExercises.push({
              ...ex,
              exerciseName: replacement.name,
              // Different movement — its load/format numbers don't transfer, and
              // a bodyweight move has no external load. Keep structure; zero
              // weight/duration/distance and ensure a sane rep target.
              weight: 0,
              duration: 0,
              distanceM: 0,
              reps: ex.reps && ex.reps > 0 ? ex.reps : 10,
              notes:
                "Substituted with a bodyweight movement for your equipment-free day.",
            });
          } else {
            // No bodyweight candidate left — drop it (guarantees compliance).
            findings.push({
              dayNumber: day.day,
              exerciseName: ex.exerciseName,
              action: "dropped",
            });
          }
        }
        return { ...block, exercises: newExercises };
      })
      // Remove blocks left empty after drops.
      .filter((block: any) => (block.exercises || []).length > 0);

    return { ...day, blocks: newBlocks };
  });

  return { workoutPlan: repairedPlan, findings };
}
