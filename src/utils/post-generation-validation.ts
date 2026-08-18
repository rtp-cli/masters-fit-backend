import { Profile } from "@/models";
import { validateEquipmentAndFilter } from "@/utils/equipment-validation";
import { validateLimitationsAndFilter } from "@/utils/limitation-validation";
import {
  capExerciseRepetition,
  ExerciseRepetitionFinding,
} from "@/utils/workout-balance-validation";
import {
  enforceAvoidConstraints,
  EnforcementCatalogItem,
  ConstraintViolationFinding,
} from "@/utils/constraint-enforcement";
import {
  enforceBodyweightOnlyDays,
  BodyweightDayFinding,
} from "@/utils/equipment-per-day-enforcement";
import {
  padDaysToTargetDuration,
  DurationPadFinding,
} from "@/utils/duration-enforcement";
import {
  buildMuscleByExercise,
  buildTagByExercise,
  alignDaysToFocus,
  computeDayMuscleLoad,
  findConsecutiveMuscleOverlap,
  FocusAlignmentFinding,
  ConsecutiveOverlapFinding,
} from "@/utils/muscle-load";
import { sanitizeGeneratedContent } from "@/utils/plan-safety-language";

const DURATION_TOLERANCE_MINUTES = 5;

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
  profile: Profile,
  // [GQ-07] Optional AVOID enforcement: when the planning call extracted
  // avoid-terms from the user's request, deterministically swap/drop any
  // generated exercise that matches one, drawing swaps from the same filtered
  // catalog the generation used. Runs BEFORE the repetition cap so a swapped-in
  // exercise is still subject to the "no >2× per day" rule.
  constraintOptions?: {
    avoidExerciseTerms?: string[];
    catalog?: EnforcementCatalogItem[];
    // [GQ-11] Per-day intended focus (canonical muscle groups, from the plan)
    // and calendar-adjacent day pairs (from the schedule). When present, the
    // pipeline aligns each day's exercises to its focus and logs residual
    // consecutive-day muscle overlap.
    dayFocus?: Map<number, string[]>;
    adjacentPairs?: Array<[number, number]>;
    // [GQ-06] Day numbers that must be bodyweight-only (no equipment). Enforced
    // deterministically after muscle alignment, before the duration pad.
    bodyweightOnlyDays?: number[];
  }
): {
  exercisesToAdd: any[];
  workoutPlan: any[];
  repetitionFindings: ExerciseRepetitionFinding[];
  constraintFindings: ConstraintViolationFinding[];
  durationFindings: DurationPadFinding[];
  muscleAlignmentFindings: FocusAlignmentFinding[];
  muscleOverlapFindings: ConsecutiveOverlapFinding[];
  bodyweightFindings: BodyweightDayFinding[];
} {
  const equipmentFiltered = validateEquipmentAndFilter(
    rawExercisesToAdd,
    rawWorkoutPlan,
    profile
  );

  const limitationFiltered = validateLimitationsAndFilter(
    equipmentFiltered.exercisesToAdd,
    equipmentFiltered.workoutPlan,
    profile
  );

  // [GQ-07] Deterministic AVOID enforcement (no-op when there are no avoid
  // terms or no violation — the common case).
  const enforced = enforceAvoidConstraints(
    limitationFiltered.workoutPlan,
    limitationFiltered.exercisesToAdd,
    constraintOptions?.avoidExerciseTerms,
    constraintOptions?.catalog || []
  );

  const { workoutPlan: cappedPlan, findings: repetitionFindings } =
    capExerciseRepetition(enforced.workoutPlan);

  // [GQ-11] Muscle-load alignment — swap off-focus filler exercises that
  // incidentally overload a non-focus muscle for focus-matching ones (never
  // removes focus work). Runs before the duration pad so the pad tops up any
  // day the swaps left short. No-op without dayFocus/catalog.
  const muscleByExercise = buildMuscleByExercise(
    constraintOptions?.catalog || [],
    enforced.exercisesToAdd
  );
  const tagByExercise = buildTagByExercise(
    constraintOptions?.catalog || [],
    enforced.exercisesToAdd
  );
  const aligned =
    constraintOptions?.dayFocus && (constraintOptions?.catalog?.length || 0) > 0
      ? alignDaysToFocus(
          cappedPlan,
          constraintOptions.dayFocus,
          muscleByExercise,
          constraintOptions.catalog || [],
          tagByExercise,
          constraintOptions.avoidExerciseTerms,
          constraintOptions.adjacentPairs
        )
      : { workoutPlan: cappedPlan, findings: [] as FocusAlignmentFinding[] };

  // [GQ-06] Per-day equipment enforcement — runs AFTER muscle alignment on
  // purpose: alignDaysToFocus can swap in an equipment-requiring catalog exercise
  // to fix focus, which would re-break a bodyweight-only day if we enforced
  // earlier. Swap any equipment-requiring exercise on a flagged day for a
  // bodyweight one (or drop). No-op without bodyweightOnlyDays. The duration pad
  // below only adds sets/rounds to existing exercises, so it can't reintroduce
  // equipment.
  const bodyweightEnforced = enforceBodyweightOnlyDays(
    aligned.workoutPlan,
    enforced.exercisesToAdd,
    constraintOptions?.bodyweightOnlyDays,
    constraintOptions?.catalog || [],
    // Pass the avoid-terms so a bodyweight swap can't reintroduce a banned
    // movement (this step runs after GQ-07 AVOID enforcement).
    constraintOptions?.avoidExerciseTerms
  );

  // [GQ-11] Residual consecutive-day overlap — computed on the final exercise set
  // (post-alignment AND post-bodyweight-swap) so the signal reflects what ships.
  const muscleOverlapFindings = constraintOptions?.adjacentPairs?.length
    ? findConsecutiveMuscleOverlap(
        bodyweightEnforced.workoutPlan.map((d) =>
          computeDayMuscleLoad(d, muscleByExercise)
        ),
        constraintOptions.adjacentPairs
      )
    : [];

  // [Duration] Runs LAST — pads any day still under the target after all the
  // filtering/capping/alignment above. No-op when the target is unknown or all
  // days are in range.
  const target = profile.workoutDuration || 0;
  const { workoutPlan: finalPlan, findings: durationFindings } =
    target > 0
      ? padDaysToTargetDuration(
          bodyweightEnforced.workoutPlan,
          target,
          DURATION_TOLERANCE_MINUTES
        )
      : {
          workoutPlan: bodyweightEnforced.workoutPlan,
          findings: [] as DurationPadFinding[],
        };

  // [safety-language] Strip any medical / absolute-safety / guaranteed-outcome
  // wording the model emitted in user-visible text (day names/focus, block
  // descriptions, exercise notes). Deterministic heal — runs last so it also
  // cleans text on exercises swapped in by the steps above. Mutates in place.
  sanitizeGeneratedContent(finalPlan);
  sanitizeGeneratedContent(enforced.exercisesToAdd);

  return {
    exercisesToAdd: enforced.exercisesToAdd,
    workoutPlan: finalPlan,
    repetitionFindings,
    constraintFindings: enforced.findings,
    durationFindings,
    muscleAlignmentFindings: aligned.findings,
    muscleOverlapFindings,
    bodyweightFindings: bodyweightEnforced.findings,
  };
}
