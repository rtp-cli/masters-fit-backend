import { z } from "zod";

/**
 * Validation for the SERIAL generation path (weekly fallback, weekly/daily
 * regeneration, standalone single-day). The fan-out weekly path enforces a
 * JSON Schema via withStructuredOutput; this path was previously a bare
 * JSON.parse with no shape guarantees, so a hallucinated or truncated
 * response only surfaced as a confusing persistence failure (or silent
 * exercise drops) later.
 *
 * Philosophy: STRUCTURE fails hard, SCALARS heal. A response with no
 * blocks/exercises is unusable and should throw (the generation job's
 * retry/failure handling takes over). A block whose `rounds` came back as
 * a string or null is fine — coerce/default it, matching what the DB
 * mapping in workout.service tolerates today. Unknown extra keys pass
 * through untouched.
 */

// Number that heals: coerces "3" -> 3, defaults null/undefined/garbage.
const healedNumber = (fallback: number) =>
  z.coerce.number().finite().catch(fallback);

// String that heals: defaults null/undefined/non-strings.
const healedString = (fallback = "") => z.string().catch(fallback);

const generatedExerciseSchema = z
  .object({
    exerciseName: z.string().min(1),
    sets: healedNumber(1),
    reps: healedNumber(0),
    weight: healedNumber(0),
    duration: healedNumber(0),
    restTime: healedNumber(0),
    notes: healedString(),
    order: healedNumber(1),
  })
  .passthrough();

const generatedBlockSchema = z
  .object({
    // Deliberately NOT an enum: the prompt constrains blockType, and an
    // off-list value should persist (frontend falls back to traditional
    // rendering) rather than fail the whole generation.
    blockType: healedString("traditional"),
    blockName: healedString(),
    blockDurationMinutes: healedNumber(0),
    timeCapMinutes: healedNumber(0),
    rounds: healedNumber(1),
    instructions: healedString(),
    order: healedNumber(1),
    exercises: z.array(generatedExerciseSchema).min(1),
  })
  .passthrough();

// exercisesToAdd is optional enrichment — if the model mangles it, drop it
// rather than fail the generation.
const exercisesToAddSchema = z
  .array(
    z
      .object({
        name: z.string().min(1),
        description: healedString(),
        equipment: z.array(z.string()).catch([]),
        muscleGroups: z.array(z.string()).catch([]),
        difficulty: healedString("moderate"),
        instructions: healedString(),
        link: healedString(),
        tag: healedString(),
      })
      .passthrough()
  )
  .catch([]);

export const generatedDaySchema = z
  .object({
    day: healedNumber(1),
    name: healedString(),
    description: healedString(),
    instructions: healedString(),
    blocks: z.array(generatedBlockSchema).min(1),
    exercisesToAdd: exercisesToAddSchema.optional(),
  })
  .passthrough();

export const generatedWeeklyPlanSchema = z
  .object({
    name: healedString("Workout Plan"),
    description: healedString(),
    workoutPlan: z.array(generatedDaySchema).min(1),
    exercisesToAdd: exercisesToAddSchema.optional(),
  })
  .passthrough();

const summarizeIssues = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");

export function validateWeeklyGenerationResponse(raw: unknown) {
  const result = generatedWeeklyPlanSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `LLM weekly workout response failed validation: ${summarizeIssues(result.error)}`
    );
  }
  return result.data;
}

export function validateDailyGenerationResponse(raw: unknown) {
  const result = generatedDaySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `LLM daily workout response failed validation: ${summarizeIssues(result.error)}`
    );
  }
  return result.data;
}
