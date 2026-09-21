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
 *
 * [#109] Widened from `\brunning\b` to `\brun(?:s|ning)?\b` plus `sprints?`
 * after the replace-suggestion audit surfaced "Driveway Hill Run" as the second
 * movement offered to a walking-only beginner. The old pattern matched the
 * gerund only, so a noun-form name sailed through. Measured against the real
 * catalog this adds exactly 12 rows and every one is genuinely a run or a
 * sprint — Driveway Hill Run, Incline Driveway Run, and ten bike/rower/ski-erg
 * sprints. Note the word boundary keeps "Runner's Lunge"-style names safe:
 * `\brun\b` does not match inside "Runner".
 */
const NON_WALKING_CARDIO =
  /\b(?:in[- ]place|on the spot)\b|\bjog(?:ging)?\b|\brun(?:s|ning)?\b|\bsprints?\b|\bhigh[- ]knees?\b|\bjumping[- ]jacks?\b|\bjump[- ]rope\b/i;

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

/**
 * [#102] Catalog rows that exist ONLY as a user-chosen swap and must never be
 * generated, for anybody.
 *
 * "Indoor Walk" is the walk you do when you cannot get outside. That is a
 * CONSTRAINT answer, not a difficulty answer — twenty minutes of marching on
 * the spot is not easier than a fifteen-minute stroll, it is just the only
 * thing available — and nothing in the profile says who is in that situation.
 * There is no indoor/outdoor field; `environment` is equipment-only. So the
 * generator would have to guess, and its demonstrated bias is to over-reach
 * for in-place cardio: given `Walking` AND `Brisk Walk` pinned at the top of
 * its menu it still chose "Walking in Place" seven times in one five-day week.
 *
 * Note this is NOT covered by NON_WALKING_CARDIO: the name contains no "in
 * place", no "jog", no "run". Without an explicit exclusion the generator
 * would prescribe it freely and we would have rebuilt LR-085 under a nicer
 * name. Applied unconditionally in getSharedGenerationCatalog — not scoped to
 * walking-only users, because a strength user has even less business being
 * handed it.
 *
 * The escape hatch is rankReplacements, which pins it deliberately when a
 * walking-only user is replacing a walk. Matched lower-cased, mirroring the
 * catalog's case-insensitive unique index.
 */
/** The exact catalog name, so the pin and the exclusion cannot drift apart. */
export const INDOOR_WALK_NAME = "Indoor Walk";

export const SWAP_ONLY_EXERCISES: ReadonlySet<string> = new Set([
  INDOOR_WALK_NAME.toLowerCase(),
]);

/** True when this row may only reach a plan through a deliberate user swap. */
export function isSwapOnly(name: string | null | undefined): boolean {
  return SWAP_ONLY_EXERCISES.has((name ?? "").trim().toLowerCase());
}

/**
 * Removes swap-only rows from a generation catalog. Unconditional: no profile,
 * no exceptions — if it is on the list, the model never sees it.
 */
export function filterOutSwapOnly<T extends { name: string }>(pool: T[]): T[] {
  return pool.filter((exercise) => !isSwapOnly(exercise.name));
}
