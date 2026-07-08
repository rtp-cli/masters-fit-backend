import { Profile } from "@/models";
import { getEquipmentForEnvironment } from "@/constants";
import { logger } from "@/utils/logger";

/**
 * Drops generated exercises the user can't actually perform given their
 * equipment/environment, and removes any block-exercise references to them.
 * [LR-012] The LLM structured-output schema constrains equipment values to a
 * valid enum, but never checks them against THIS user's actual
 * environment/equipment — a home-gym user with only dumbbells could still
 * get a squat-rack exercise. Leaves a day with fewer exercises rather than
 * one prescribing equipment the user doesn't have — a safe degradation.
 */
export function validateEquipmentAndFilter(
  exercisesToAdd: any[],
  workoutPlan: any[],
  profile: Profile
): { exercisesToAdd: any[]; workoutPlan: any[] } {
  const userEquipment = new Set<string>(
    profile.environment === "commercial_gym"
      ? getEquipmentForEnvironment("commercial_gym")
      : profile.environment === "bodyweight_only"
        ? []
        : Array.isArray(profile.equipment)
          ? profile.equipment
          : profile.equipment
            ? [profile.equipment]
            : []
  );

  const invalidNames = new Set<string>();
  const filteredExercisesToAdd = exercisesToAdd.filter((exercise) => {
    const required: string[] = Array.isArray(exercise.equipment)
      ? exercise.equipment
      : [];
    const isBodyweightCompatible =
      required.length === 0 || required.every((e) => e === "bodyweight");
    const hasAllRequired = required.every(
      (e) => e === "bodyweight" || userEquipment.has(e)
    );
    if (isBodyweightCompatible || hasAllRequired) {
      return true;
    }

    logger.warn("Dropping generated exercise — equipment mismatch", {
      operation: "validateEquipmentAndFilter",
      exerciseName: exercise.name,
      requiredEquipment: required,
      userEnvironment: profile.environment,
      userEquipment: Array.from(userEquipment),
    });
    const key = exercise.name?.toLowerCase();
    if (key) invalidNames.add(key);
    return false;
  });

  if (invalidNames.size === 0) {
    return { exercisesToAdd: filteredExercisesToAdd, workoutPlan };
  }

  const filteredWorkoutPlan = workoutPlan.map((day) => ({
    ...day,
    blocks: (day.blocks || []).map((block: any) => ({
      ...block,
      exercises: (block.exercises || []).filter(
        (ex: any) => !invalidNames.has(ex.exerciseName?.toLowerCase())
      ),
    })),
  }));

  return {
    exercisesToAdd: filteredExercisesToAdd,
    workoutPlan: filteredWorkoutPlan,
  };
}
