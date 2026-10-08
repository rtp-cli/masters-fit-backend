-- Health activity import: watch workouts (Apple Health / Health Connect) land in
-- logged_activities. Additive only — new nullable columns, one defaulted column,
-- one new unique index. Mirrors src/models/logged-activity.schema.ts.
--
-- Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- Re-runnable (IF NOT EXISTS everywhere).

ALTER TABLE logged_activities
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS distance_meters integer,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- Nulls are distinct in Postgres, so manual rows (external_id NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_logged_activities_user_external
  ON logged_activities (user_id, external_id);
