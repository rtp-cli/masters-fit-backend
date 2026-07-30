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
/**
 * Two-tier model (2026-07-30, product-approved): HARD BANS below strip an
 * exercise from the catalog entirely — reserved for movements with broad
 * consensus contraindication. Everything that a trainer would PROGRAM
 * CAUTIOUSLY rather than avoid lives in CAUTION_RULES instead: those
 * exercises stay available, and the system prompt requires conservative
 * programming for them. The original single-tier list banned whole movement
 * families (all 45 deadlift variants for lower_back_pain, bike sprints for
 * knee_pain, forearm planks for wrist_pain) that modern rehab practice
 * actively uses — making reasonable user requests silently unsatisfiable.
 */
const CONTRAINDICATION_RULES: Partial<Record<PhysicalLimitation, RegExp>> = {
  [PhysicalLimitations.KNEE_PAIN]: /\b(pistol squat|box jump|plyo)\b/i,
  [PhysicalLimitations.SHOULDER_PAIN]:
    /\b(behind[- ]the[- ]neck|kipping|snatch)\b/i,
  [PhysicalLimitations.LOWER_BACK_PAIN]:
    /\b(good morning|russian twist|sit-?up)\b|(stiff|straight)[- ]?leg(ged)?[- ]deadlift/i,
  [PhysicalLimitations.NECK_PAIN]:
    /\b(neck bridge|shoulder stand|headstand|behind[- ]the[- ]neck)\b/i,
  [PhysicalLimitations.WRIST_PAIN]: /\b(handstand|snatch)\b/i,
  [PhysicalLimitations.ELBOW_PAIN]: /\b(skull crusher)\b/i,
  [PhysicalLimitations.OSTEOPOROSIS]:
    /\b(russian twist|sit-?up|toe touch|forward fold|spinal flexion|twist)\b/i,
  // Sciatica is nerve-root territory: heavier hinges stay banned; only
  // light-implement hinge variants (kettlebell/dumbbell/single-leg/banded)
  // drop to caution.
  [PhysicalLimitations.SCIATICA]:
    /\b(good morning|sit-?up|toe touch)\b|^(?=.*deadlift)(?!.*(kettlebell|dumbbell|single[- ]leg|band|stability)).*$/i,
  [PhysicalLimitations.ANKLE_INSTABILITY]: /\b(box jump|jump rope|plyo)\b/i,
  [PhysicalLimitations.BALANCE_ISSUES]:
    /\b(bosu|single[- ]leg.*(jump|hop)|eyes closed)\b/i,
};

/**
 * Caution tier: permitted, but the system prompt requires conservative
 * programming (light-to-moderate load, RPE <= 7, controlled tempo, never in
 * an AMRAP/max-effort circuit, safety cue in the notes). Checked against the
 * post-hard-ban catalog, so overlap with CONTRAINDICATION_RULES is fine —
 * e.g. a stiff-leg deadlift never reaches the lower-back caution check.
 */
const CAUTION_RULES: Partial<Record<PhysicalLimitation, RegExp>> = {
  [PhysicalLimitations.KNEE_PAIN]:
    /\b(jump|jumping jack|burpee|deep squat|sprint)\b/i,
  [PhysicalLimitations.SHOULDER_PAIN]:
    /\b(overhead press|military press|push press|dip)\b/i,
  [PhysicalLimitations.LOWER_BACK_PAIN]:
    /\b(deadlift|back extension|superman)\b/i,
  [PhysicalLimitations.WRIST_PAIN]:
    /\b(push-?up|plank|front rack|clean)\b/i,
  [PhysicalLimitations.ELBOW_PAIN]:
    /\b(tricep dip|close[- ]grip|hammer curl)\b/i,
  [PhysicalLimitations.SCIATICA]: /\bdeadlift\b/i,
  [PhysicalLimitations.ANKLE_INSTABILITY]: /\b(sprint|jump)\b/i,
};

/**
 * Human-readable versions of CONTRAINDICATION_RULES, used to tell the LLM (and
 * through it, the user) WHICH movements were excluded and WHY. Keep in sync
 * with the regexes above — this is the transparency half of the filter: without
 * it, a user who asks for an excluded movement (e.g. deadlifts with
 * LOWER_BACK_PAIN) gets a workout silently titled after a movement it doesn't
 * contain, with no way to understand why.
 */
const CONTRAINDICATED_MOVEMENTS: Partial<Record<PhysicalLimitation, string>> = {
  [PhysicalLimitations.KNEE_PAIN]: "pistol squats, box jumps, plyometrics",
  [PhysicalLimitations.SHOULDER_PAIN]:
    "behind-the-neck movements, kipping movements, snatches",
  [PhysicalLimitations.LOWER_BACK_PAIN]:
    "good mornings, russian twists, sit-ups, stiff-leg/straight-leg deadlifts",
  [PhysicalLimitations.NECK_PAIN]:
    "neck bridges, shoulder stands, headstands, behind-the-neck movements",
  [PhysicalLimitations.WRIST_PAIN]: "handstands, snatches",
  [PhysicalLimitations.ELBOW_PAIN]: "skull crushers",
  [PhysicalLimitations.OSTEOPOROSIS]:
    "russian twists, sit-ups, toe touches, forward folds, spinal flexion/twisting movements",
  [PhysicalLimitations.SCIATICA]:
    "good mornings, sit-ups, toe touches, barbell/heavier deadlift variants",
  [PhysicalLimitations.ANKLE_INSTABILITY]: "box jumps, jump rope, plyometrics",
  [PhysicalLimitations.BALANCE_ISSUES]:
    "bosu work, single-leg jumps/hops, eyes-closed movements",
};

/**
 * Human-readable caution-tier lists, mirroring CAUTION_RULES the same way
 * CONTRAINDICATED_MOVEMENTS mirrors the hard bans.
 */
const CAUTION_MOVEMENTS: Partial<Record<PhysicalLimitation, string>> = {
  [PhysicalLimitations.KNEE_PAIN]:
    "jumps, jumping jacks, burpees, deep squats, sprints",
  [PhysicalLimitations.SHOULDER_PAIN]:
    "overhead/military presses, push presses, dips",
  [PhysicalLimitations.LOWER_BACK_PAIN]:
    "deadlift variants, back extensions, supermans",
  [PhysicalLimitations.WRIST_PAIN]:
    "push-ups, planks, front-rack positions, cleans",
  [PhysicalLimitations.ELBOW_PAIN]:
    "tricep dips, close-grip movements, hammer curls",
  [PhysicalLimitations.SCIATICA]:
    "light-implement deadlifts (kettlebell/dumbbell/single-leg/banded)",
  [PhysicalLimitations.ANKLE_INSTABILITY]: "sprints, jumps",
};

/**
 * One "<Limitation Label>: <excluded movements>" line per active limitation
 * that actually has a filter rule. Empty array when nothing is filtered, so
 * callers can skip the transparency section entirely.
 */
export function describeContraindications(
  limitations: PhysicalLimitation[] | null | undefined
): string[] {
  return (limitations ?? [])
    .filter((limitation) => CONTRAINDICATION_RULES[limitation])
    .map((limitation) => {
      const label = limitation
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return `${label}: ${CONTRAINDICATED_MOVEMENTS[limitation] ?? "certain high-risk movements"}`;
    });
}

/**
 * One "<Limitation Label>: <caution movements>" line per active limitation
 * with a caution rule — the prompt uses these to require conservative
 * programming instead of exclusion. Empty array when none apply.
 */
export function describeCautions(
  limitations: PhysicalLimitation[] | null | undefined
): string[] {
  return (limitations ?? [])
    .filter((limitation) => CAUTION_RULES[limitation])
    .map((limitation) => {
      const label = limitation
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return `${label}: ${CAUTION_MOVEMENTS[limitation] ?? "certain movements"}`;
    });
}

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
