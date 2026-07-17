import { Profile } from "@/models";
import { validateEquipmentAndFilter } from "@/utils/equipment-validation";
import { validateLimitationsAndFilter } from "@/utils/limitation-validation";
import {
  capExerciseRepetition,
  ExerciseRepetitionFinding,
} from "@/utils/workout-balance-validation";

/**
 * [LR-019] The post-generation validation pipeline used by
 * generateWeeklyWorkout — extracted so the WIRING between these three
 * validators is directly testable, not just each one individually (each
 * already has its own unit tests: equipment-validation.test.ts,
 * limitation-validation.test.ts, workout-balance-validation.test.ts). Those
 * tests wouldn't catch a bug in the pipeline itself — e.g. if the steps ran
 * in a different order, or if repetition-checking ran against the raw
 * (pre-filter) plan instead of the final filtered one, every individual
 * validator would still report "working" while the actual generation flow
 * was broken.
 *
 * Order matters here: equipment filtering runs first, its output feeds
 * limitation filtering, and the repetition cap runs against the fully
 * filtered result — a repeated exercise that equipment/limitation filtering
 * already removed shouldn't still be counted (or capped) as "repeated."
 * [LR-049] The repetition step now ENFORCES (drops over-repeats) in addition
 * to returning findings for logging, mirroring the equipment/limitation filters.
 */
export function applyPostGenerationValidation(
  rawExercisesToAdd: any[],
  rawWorkoutPlan: any[],
  profile: Profile
): {
  exercisesToAdd: any[];
  workoutPlan: any[];
  repetitionFindings: ExerciseRepetitionFinding[];
} {
  const equipmentFiltered = validateEquipmentAndFilter(
    rawExercisesToAdd,
    rawWorkoutPlan,
    profile
  );

  const { exercisesToAdd, workoutPlan } = validateLimitationsAndFilter(
    equipmentFiltered.exercisesToAdd,
    equipmentFiltered.workoutPlan,
    profile
  );

  const { workoutPlan: cappedPlan, findings: repetitionFindings } =
    capExerciseRepetition(workoutPlan);

  return { exercisesToAdd, workoutPlan: cappedPlan, repetitionFindings };
}
