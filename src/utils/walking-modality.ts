import { Profile } from "@/models";
import { PreferredStyles } from "@/constants/profile";
import { logger } from "@/utils/logger";

/**
 * [LR-085] Walking & Movement catalog guardrail.
 *
 * The Walking & Movement prompt block has said since LR-084: "NEVER prescribe
 * jogging, running, jumping, or 'in place' cardio for this style. 'Light jog in
 * place' and 'High Knees' are not scaled walking — they are higher-impact
 * movements that a walker specifically did not ask for."
 *
 * That was a prompt assertion with no enforcement behind it, and the eval run
 * that accompanied this change scored it: with real walks finally on the menu
 * (see WALKING_BASICS in requested-exercises.ts) the generator correctly made
 * the session a walk — and then still reached for "Walking in Place" seven
 * times across a five-day week. A rule the model breaks seven times in one plan
 * is not a rule, it is a suggestion.
 *
 * So this is TIER 1 for the same reason limitations (LR-013) and beginner
 * guardrails (LR-073) are: the cheapest way to stop a movement being chosen is
 * for it never to appear on the menu. 20 of 643 bodyweight rows, 3.1%.
 *
 * SCOPED TO SOLE-STYLE USERS ON PURPOSE. The same prompt block says a combined
 * user "gets its own sessions on its own days; the other style gets the
 * remaining days" — so a Walking+HIIT user genuinely needs jumping jacks for
 * their HIIT days, and stripping them from the shared catalog would break the
 * other half of their week to protect the walking half. Only someone whose
 * ENTIRE stated modality is walking can safely lose these.
 */

/**
 * In-place, jogging and jumping cardio — the movements a walker did not ask
 * for. Matched on name because that is all the catalog reliably gives us, and
 * because the model can invent a name that was never a catalog row.
 *
 * Measured against the real bodyweight catalog (2026-09-21) — every one of the
 * 20 matches is genuinely one of these, no false positives:
 *   Walking in Place, Gentle Walking in Place, Marching on the Spot,
 *   Jogging in Place, Light jog in place, Slim Jog in Place,
 *   High Knees (+ March / Sprint in Place / Toe Touch / with Arm Swing / Walking),
 *   Jumping Jacks (+ Bodyweight / Chair / Modified / Lower Body Only / Squat),
 *   Arm Pump High Knees, Squat to High Knee.
 *
 * "Walking High Knees" is deliberately included: it is a high-knee drill, which
 * the prompt names explicitly, not a way of walking.
 */
const NON_WALKING_CARDIO =
  /\b(?:in[- ]place|on the spot)\b|\bjog(?:ging)?\b|\brunning\b|\bhigh[- ]knees?\b|\bjumping[- ]jacks?\b|\bjump[- ]rope\b/i;

/** True when Walking & Movement is this user's ONLY stated style. */
export function isWalkingOnlyUser(profile: Profile): boolean {
  const styles = (profile.preferredStyles as string[] | null) ?? [];
  return (
    styles.length > 0 &&
    styles.every((s) => s?.toLowerCase() === PreferredStyles.WALKING_MOVEMENT)
  );
}

/** True when this exercise NAME is off-limits for a walking-only user. */
export function isNonWalkingCardio(name: string | null | undefined): boolean {
  return NON_WALKING_CARDIO.test(name ?? "");
}

/**
 * TIER 1. Filters the pre-generation catalog so a walking-only user is never
 * shown in-place/jogging/jumping cardio as an option. No-op for every other
 * user, including Walking + something else.
 */
export function filterExercisesForWalkingModality<T extends { name: string }>(
  exercises: T[],
  profile: Profile
): T[] {
  if (!isWalkingOnlyUser(profile)) return exercises;

  return exercises.filter((exercise) => {
    if (isNonWalkingCardio(exercise.name)) {
      logger.debug("Excluding exercise from catalog — walking modality guardrail", {
        operation: "filterExercisesForWalkingModality",
        metadata: { exerciseName: exercise.name },
      });
      return false;
    }
    return true;
  });
}
