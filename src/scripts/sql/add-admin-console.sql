-- Admin console (admin.mastersfit.ai): roles + an audit trail for every
-- state-changing console action. Mirrors src/models/admin.schema.ts.
--
--   * admin_users       — one row per console user: analyst | admin | super_admin.
--                         ADMIN_USER_IDS (env) still always means super_admin,
--                         so an empty table locks nobody out.
--   * admin_action_log  — written BEFORE each action runs (status 'started'),
--                         closed out as 'succeeded' / 'failed'. No FKs, so the
--                         trail outlives deleted accounts.
--
-- Additive only: two new tables, nothing existing is touched.
--
-- A SQL file rather than `drizzle-kit push` because push currently cannot
-- introspect the expression index idx_exercises_owner_name_unique (ZodError).
--
-- Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- Re-runnable.

CREATE TABLE IF NOT EXISTS admin_users (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  granted_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_check'
  ) THEN
    ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('analyst', 'admin', 'super_admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_action_log (
  id serial PRIMARY KEY,
  admin_user_id integer NOT NULL,
  action text NOT NULL,
  target_user_id integer,
  reason text,
  params jsonb,
  status text NOT NULL,
  result jsonb,
  error text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_admin_id ON admin_action_log (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_target_id ON admin_action_log (target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created_at ON admin_action_log (created_at);
