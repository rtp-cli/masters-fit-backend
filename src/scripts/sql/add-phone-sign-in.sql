-- SMS sign-in: an account can now be identified by a phone number instead of,
-- or as well as, an email. Mirrors src/models/user.schema.ts.
--
--   * users.phone   — new, nullable, UNIQUE (E.164, +1 only).
--   * users.email   — NOT NULL dropped (phone-only accounts). Its UNIQUE stays;
--                     Postgres treats NULLs as distinct, so many phone-only
--                     rows never collide.
--   * users_contact_present — every row keeps at least one of the two.
--
-- Safe against existing data: every current row has an email, so the CHECK
-- validates immediately, and nothing is rewritten. Loosening NOT NULL cannot
-- break code that only ever writes an email.
--
-- A SQL file rather than `drizzle-kit push` because push currently cannot
-- introspect the expression index idx_exercises_owner_name_unique (ZodError).
--
-- Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
-- Re-runnable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
  END IF;
END $$;

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_contact_present'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_contact_present
      CHECK (email IS NOT NULL OR phone IS NOT NULL);
  END IF;
END $$;
