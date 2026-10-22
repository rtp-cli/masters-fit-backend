/**
 * What `plan_day_exercises.substituted_from_exercise_id` should hold after a
 * swap: the movement the plan FIRST prescribed, so repeated swaps
 * (Push Press -> Landmine Press -> Floor Press) still point at Push Press, and
 * null once the user swaps back to it (nothing was substituted after all).
 */
export function nextSubstitutedFrom(
  current: { exerciseId: number; substitutedFromExerciseId: number | null },
  newExerciseId: number
): number | null {
  const original = current.substitutedFromExerciseId ?? current.exerciseId;
  return newExerciseId === original ? null : original;
}
