-- Record the movement the plan originally prescribed when a user swaps an
-- exercise (before, during, or after the workout), so the generator can learn
-- "she always swaps push press out". Additive only: one nullable FK column.
-- Mirrors src/models/workout.schema.ts (planDayExercises.substitutedFromExerciseId).
--
-- A SQL file rather than `drizzle-kit push` because push currently cannot
-- introspect the expression index idx_exercises_owner_name_unique (it dies in
-- a ZodError before diffing).
--
-- MUST be applied to a database BEFORE the backend code that declares the
-- column runs against it: Drizzle selects every declared column, so plan-day
-- reads would 500 until it exists.
--
-- Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- Re-runnable (IF NOT EXISTS everywhere).

ALTER TABLE plan_day_exercises
  ADD COLUMN IF NOT EXISTS substituted_from_exercise_id integer
    REFERENCES exercises(id) ON DELETE SET NULL;
