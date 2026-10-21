-- Daily workout reminder push: the Settings switch + the once-a-day claim
-- marker. Additive only — one defaulted NOT NULL boolean (existing rows get
-- true) and one nullable text column. Mirrors src/models/user.schema.ts.
--
-- A SQL file rather than `drizzle-kit push` because push currently cannot
-- introspect the expression index idx_exercises_owner_name_unique (it dies in
-- a ZodError before diffing).
--
-- Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- Re-runnable (IF NOT EXISTS everywhere).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workout_reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS workout_reminder_sent_on text;
