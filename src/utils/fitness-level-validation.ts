import { Profile } from "@/models";
import { FitnessLevels, IntensityLevels } from "@/constants/profile";
import { logger } from "@/utils/logger";

/**
 * [LR-073] Beginner guardrails.
 *
 * `fitnessLevel` reached the model as a bare label — `- Fitness Level: beginner`
 * in the profile block — with no semantics attached anywhere in either prompt
 * generator and no enforcement at all. The model mostly self-regulated (prod
 * 2026-09-18: beginners' prescriptions were 66% low / 32% moderate / 2% high),
 * but "mostly" is measured per-prescription, and a plan is experienced per-user:
 * 5 of 6 beginner accounts had been handed at least one `high`-difficulty
 * movement, three of them Burpees. For a 40+ audience that is the movement
 * people quit over, and the whole point of catering from walking upward is that
 * the bottom of the ladder has to be survivable.
 *
 * Deliberately mirrors the two-tier model established for limitations in
 * limitation-validation.ts, because the failure mode and the fix are the same
 * shape:
 *
 *   TIER 1 — catalog pre-filter (primary). A beginner never SEES a
 *   `high`-difficulty exercise, so it can't be chosen. Cheap, deterministic,
 *   and it consumes no menu slots. On prod this removes 182 of 1,686 exercises
 *   (10.8%; 33 of 575 for bodyweight-only users), which leaves the generator
 *   plenty to work with — this is a trim, not a gutting.
 *
 *   TIER 2 — name-keyword screen (the net). The catalog filter can't help when
 *   the model invents an exercise that was never in the catalog, or on the
 *   daily/regen path where the plan body may name any exercise it likes. Same
 *   lesson as the 2026-09-04 Box Jump incident that forced the plan-body screen
 *   in validateLimitationsAndFilter. Keyword rules work on a name alone, so
 *   they cover both.
 *
 * Only `beginner` is constrained. Intermediate and advanced are returned
 * untouched: their `high` share (9.3% and 19.6%) is the system working, and a
 * null/absent fitnessLevel is treated as unconstrained rather than assumed
 * fragile — guessing "beginner" for an unanswered profile would quietly
 * de-load every plan that predates the field.
 */

/**
 * Movement patterns a self-reported beginner should not be handed regardless of
 * what the catalog says the difficulty is — either because the catalog row is
 * mis-rated, or because the model invented the name and there is no row at all.
 *
 * Scoped to high-skill or high-impact patterns with broad coaching consensus
 * that they are *progressions*, not entry points. Not a fitness opinion about
 * the movement: a beginner can absolutely earn a burpee, just not in week one
 * from a standing start. Anything that merely wants careful programming is left
 * off this list and handled by the prompt's level semantics instead.
 */
// Two things this pattern learned from the real catalog (2026-09-18):
//   - `plyo\w*` is NOT usable: "Plyo Box" is a piece of EQUIPMENT, so it matched
//     "Plyo Box Step Down" and "Plyo Box Step Ups" — both rated `low` and both
//     fine for a beginner. The genuinely explosive ones ("Plyo Box Jump Squats",
//     "Modified Plyo Box Jump") are already caught by `box jump` / `jump squat`.
//     Narrowed to `plyometric`.
//   - Scaled burpee regressions ("Modified Burpee", "Knee-Friendly Burpees",
//     "Shoulder-Safe Burpee", "Burpee March") are excluded too, deliberately.
//     A beginner plan does not need a burpee in any form: there is no quality a
//     scaled burpee gives that an incline push-up or a squat-to-stand doesn't,
//     and it is the movement people quit over. Revisit if that reads as too
//     strict — it is a coaching call, not a technical constraint.
// NOTE the trailing `(?:e?s)?`: the prod catalog names these in the PLURAL
// ("Burpees", "Mountain Climbers"), so a bare `\bburpee\b` matches nothing that
// actually exists. A unit test caught that before it shipped.
const BEGINNER_EXCLUDED_MOVEMENTS =
  /\b(?:burpee|mountain[- ]climber|pistol[- ]squat|box[- ]jump|depth[- ]jump|broad[- ]jump|tuck[- ]jump|jump[- ]squat|muscle[- ]up|handstand|clean and jerk|sprint|snatch)(?:e?s)?\b|\b(?:plyometric\w*|kipping)\b/i;

function isBeginner(profile: Profile): boolean {
  return profile.fitnessLevel === FitnessLevels.BEGINNER;
}

/** True when this exercise NAME is off-limits for a beginner. */
function isExcludedForBeginner(name: string | null | undefined): boolean {
  return BEGINNER_EXCLUDED_MOVEMENTS.test(name ?? "");
}

/**
 * TIER 1. Filters the pre-generation exercise catalog (getFilteredExercises) so
 * a beginner is never shown a `high`-difficulty movement as an option.
 *
 * NOTE for callers: the result depends on the profile, so `fitnessLevel` MUST be
 * part of the generation catalog's cache key — otherwise a beginner's trimmed
 * catalog is served to the next intermediate user with the same
 * environment/equipment/limitations/styles, and vice versa. Same trap LR-013
 * documented for limitations.
 */
export function filterExercisesByFitnessLevel<
  T extends { name: string; difficulty?: string | null },
>(exercises: T[], profile: Profile): T[] {
  if (!isBeginner(profile)) return exercises;

  return exercises.filter((exercise) => {
    const tooHard = exercise.difficulty === IntensityLevels.HIGH;
    const excludedByName = isExcludedForBeginner(exercise.name);
    if (tooHard || excludedByName) {
      logger.debug("Excluding exercise from catalog — beginner guardrail", {
        operation: "filterExercisesByFitnessLevel",
        metadata: {
          exerciseName: exercise.name,
          difficulty: exercise.difficulty,
          reason: tooHard ? "difficulty" : "movement",
        },
      });
      return false;
    }
    return true;
  });
}

/**
 * TIER 2. Applied post-generation, mirroring validateLimitationsAndFilter's
 * exact shape: screens `exercisesToAdd` (new exercises the model introduces,
 * which never went through the catalog pre-filter) AND the plan body (the
 * daily/serial path never sends its output through a catalog at all).
 *
 * Screens on the model's own declared `difficulty` for exercisesToAdd, and on
 * the name for both — a name is the only thing the plan body carries.
 *
 * Leaves a block with fewer exercises rather than one a beginner will bounce
 * off, which is the same safe-degradation trade validateEquipmentAndFilter
 * made for equipment.
 */
export function validateFitnessLevelAndFilter(
  exercisesToAdd: any[],
  workoutPlan: any[],
  profile: Profile
): { exercisesToAdd: any[]; workoutPlan: any[] } {
  if (!isBeginner(profile)) {
    return { exercisesToAdd, workoutPlan };
  }

  const invalidNames = new Set<string>();
  const filteredExercisesToAdd = (exercisesToAdd ?? []).filter((exercise) => {
    const tooHard = exercise?.difficulty === IntensityLevels.HIGH;
    const excludedByName = isExcludedForBeginner(exercise?.name);
    if (!tooHard && !excludedByName) return true;

    logger.warn("Dropping generated exercise — beginner guardrail", {
      operation: "validateFitnessLevelAndFilter",
      exerciseName: exercise?.name,
      difficulty: exercise?.difficulty,
      reason: tooHard ? "difficulty" : "movement",
    });
    const key = exercise?.name?.toLowerCase();
    if (key) invalidNames.add(key);
    return false;
  });

  const filteredWorkoutPlan = (workoutPlan ?? []).map((day) => ({
    ...day,
    blocks: (day.blocks || []).map((block: any) => ({
      ...block,
      exercises: (block.exercises || []).filter((ex: any) => {
        const name = ex?.exerciseName;
        if (invalidNames.has(name?.toLowerCase())) return false;
        if (!isExcludedForBeginner(name)) return true;
        logger.warn("Dropping plan exercise — beginner guardrail", {
          operation: "validateFitnessLevelAndFilter",
          exerciseName: name,
          day: day.day,
        });
        return false;
      }),
    })),
  }));

  return {
    exercisesToAdd: filteredExercisesToAdd,
    workoutPlan: filteredWorkoutPlan,
  };
}

/**
 * The prompt-side half of the guardrail: what a fitness level actually MEANS
 * for programming. Returns null for levels that need no extra steer, so the
 * caller can omit the section entirely rather than emit an empty heading.
 *
 * This matters more than the filters. The filters stop the worst single
 * movement; this shapes complexity, volume and progression across the whole
 * plan — the difference between a beginner plan and an advanced plan with the
 * scary exercises removed.
 */
export function describeFitnessLevelProgramming(
  fitnessLevel: string | null | undefined
): string | null {
  if (fitnessLevel !== FitnessLevels.BEGINNER) return null;

  return [
    "**THIS USER IS A BEGINNER — PROGRAM FOR WEEK ONE, NOT FOR A TRAINING AGE.**",
    "Assume someone returning to exercise after years away, not a trained person on an easy day.",
    "- Choose SIMPLE, low-skill movements they can perform correctly unsupervised on the first attempt. Machines, bodyweight basics, supported and bilateral variations before free-standing, unilateral or loaded ones.",
    "- NO high-impact or high-skill movements: no burpees, jumping, plyometrics, sprinting, olympic lifts, or anything requiring an existing skill to attempt safely.",
    "- Keep volume conservative: fewer sets, rep ranges they can finish with form intact, and generous rest. A session they complete beats a session that is 'correct'.",
    "- Walking, incline walking and rucking are fully legitimate primary sessions at this level — for someone who has neglected their fitness, a walk may be the only training they can sustain until it improves. Program it as real training, not as a warm-up or a filler.",
    "- Progression is the point: leave obvious room to add minutes, reps or load next week. Do not spend the whole ceiling in week one.",
  ].join("\n");
}

/**
 * Template-literal convenience wrapper: the programming block followed by a
 * blank line, or an empty string when the level needs no steer — so a prompt
 * can interpolate it inline without leaving a stray heading or blank gap.
 */
export function fitnessLevelPromptSection(
  fitnessLevel: string | null | undefined
): string {
  const section = describeFitnessLevelProgramming(fitnessLevel);
  return section ? `${section}\n\n` : "";
}
