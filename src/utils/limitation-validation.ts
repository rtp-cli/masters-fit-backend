import { Profile } from "@/models";
import { PhysicalLimitations } from "@/constants/profile";
import { PhysicalLimitation } from "@/types";
import { logger } from "@/utils/logger";
import type { ExerciseMetadata } from "@/services/exercise.service";

/**
 * [LR-013] `limitations`/`medicalNotes` were only ever passed into the prompt as an
 * instruction — nothing checked whether the LLM actually respected them. Decision (2026-07-09):
 * rule-based filter as the fast deterministic layer (this file), plus a log-and-allow LLM
 * self-report for borderline cases the rules can't catch (see the `limitationConcerns` field on
 * WORKOUT_DAY_SCHEMA and where it's logged in workout-agent.service.ts) — same "both" pattern
 * already used for LR-015's exercise validation.
 *
 * Deliberately conservative and name-keyword-based, not muscle-group-based: excluding a whole
 * muscle group (e.g. all "knees"-tagged exercises for knee_pain) would gut the plan and remove
 * plenty of exercises that are actually fine or even beneficial for that limitation. Instead this
 * targets specific, well-established high-risk MOVEMENT PATTERNS per limitation — the kind of
 * guidance a certified trainer would give, not an exhaustive medical review.
 *
 * Only limitations with a clear, broadly-agreed-upon set of contraindicated movements get a rule
 * here. The rest (LIMITED_RANGE_OF_MOTION, POST_SURGERY_RECOVERY, CHRONIC_FATIGUE,
 * BREATHING_ISSUES) are too context-dependent to safely hard-filter by keyword alone — e.g.
 * "post-surgery recovery" contraindications are entirely different for a knee replacement vs. a
 * shoulder repair — so those rely solely on the LLM self-report signal for now, not a rule filter.
 * This is a judgment call, not a completeness guarantee; documented here so it's easy to revisit.
 */
const CONTRAINDICATION_RULES: Partial<Record<PhysicalLimitation, RegExp>> = {
  [PhysicalLimitations.KNEE_PAIN]:
    /\b(jump|plyo|box jump|jumping jack|burpee|pistol squat|deep squat|sprint)\b/i,
  [PhysicalLimitations.SHOULDER_PAIN]:
    /\b(overhead press|military press|behind[- ]the[- ]neck|push press|snatch|dip|kipping)\b/i,
  [PhysicalLimitations.LOWER_BACK_PAIN]:
    /\b(deadlift|good morning|russian twist|sit-?up|back extension|superman|straight[- ]leg)\b/i,
  [PhysicalLimitations.NECK_PAIN]:
    /\b(neck bridge|shoulder stand|headstand|behind[- ]the[- ]neck)\b/i,
  [PhysicalLimitations.WRIST_PAIN]:
    /\b(push-?up|handstand|front rack|clean|snatch|plank)\b/i,
  [PhysicalLimitations.ELBOW_PAIN]:
    /\b(tricep dip|skull crusher|close[- ]grip|hammer curl)\b/i,
  [PhysicalLimitations.OSTEOPOROSIS]:
    /\b(russian twist|sit-?up|toe touch|forward fold|spinal flexion|twist)\b/i,
  [PhysicalLimitations.SCIATICA]:
    /\b(deadlift|good morning|sit-?up|toe touch)\b/i,
  [PhysicalLimitations.ANKLE_INSTABILITY]:
    /\b(box jump|jump rope|sprint|plyo)\b/i,
  [PhysicalLimitations.BALANCE_ISSUES]:
    /\b(bosu|single[- ]leg.*(jump|hop)|eyes closed)\b/i,
};

function matchedLimitation(
  exerciseName: string,
  limitations: PhysicalLimitation[]
): PhysicalLimitation | null {
  for (const limitation of limitations) {
    const rule = CONTRAINDICATION_RULES[limitation];
    if (rule && rule.test(exerciseName)) return limitation;
  }
  return null;
}

/**
 * Filters the pre-generation exercise catalog (getFilteredExercises) so contraindicated
 * exercises are never shown to the LLM as an option in the first place — the primary
 * enforcement point, since most exercises come from this catalog rather than exercisesToAdd.
 */
export function filterExercisesByLimitations(
  exercises: ExerciseMetadata[],
  profile: Profile
): ExerciseMetadata[] {
  const limitations = profile.limitations ?? [];
  if (limitations.length === 0) return exercises;

  return exercises.filter((exercise) => {
    const hit = matchedLimitation(exercise.name, limitations);
    if (hit) {
      logger.debug("Excluding exercise from catalog — limitation contraindication", {
        operation: "filterExercisesByLimitations",
        metadata: { exerciseName: exercise.name, limitation: hit },
      });
      return false;
    }
    return true;
  });
}

/**
 * Same rule set, applied post-generation to exercisesToAdd (new exercises the LLM introduces
 * that never went through the catalog pre-filter above) — mirrors validateEquipmentAndFilter's
 * exact pattern (LR-012).
 */
export function validateLimitationsAndFilter(
  exercisesToAdd: any[],
  workoutPlan: any[],
  profile: Profile
): { exercisesToAdd: any[]; workoutPlan: any[] } {
  const limitations = profile.limitations ?? [];
  if (limitations.length === 0) {
    return { exercisesToAdd, workoutPlan };
  }

  const invalidNames = new Set<string>();
  const filteredExercisesToAdd = exercisesToAdd.filter((exercise) => {
    const hit = matchedLimitation(exercise.name ?? "", limitations);
    if (!hit) return true;

    logger.warn("Dropping generated exercise — limitation contraindication", {
      operation: "validateLimitationsAndFilter",
      exerciseName: exercise.name,
      limitation: hit,
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
