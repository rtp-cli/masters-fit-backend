-- A login role that can read the SHARED exercise catalog and nothing else, so
-- the generation eval (.github/workflows/eval-generation.yml) can seed its
-- throwaway Postgres from prod at the start of each run.
--
-- Why a function and not a GRANT on exercises or a view:
--   - exercises also holds users' custom exercises (owner_user_id IS NOT NULL),
--     which are user data. The function returns only owner_user_id IS NULL.
--   - A view would be introspected by `drizzle-kit push`, which could drop it
--     (it isn't in our schema) or trip over it when a column changes. Push
--     ignores functions.
--   - RETURNS SETOF exercises follows the table's row type, so a new catalog
--     column reaches the eval with no change here. A view freezes its columns.
-- Why not `pg_dump -s` with a read-only role: pg_dump takes ACCESS SHARE locks
-- on every table, which needs SELECT on every table — i.e. read access to all
-- user data. The eval builds its schema from the code under test instead
-- (drizzle-kit push into the empty container), so it needs no schema access.
--
-- Apply (generates the password, never prints it, stores the URL as the
-- EVAL_CATALOG_DATABASE_URL GitHub secret): see scripts/create-eval-catalog-reader.sh.
-- To rotate: ALTER ROLE eval_catalog_reader PASSWORD '...'; then re-set the secret.
-- To remove: DROP FUNCTION eval_catalog(); DROP ROLE eval_catalog_reader;

CREATE FUNCTION eval_catalog() RETURNS SETOF exercises
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT * FROM exercises WHERE owner_user_id IS NULL ORDER BY id $$;

-- New functions are executable by PUBLIC by default; only the eval role may run this.
REVOKE ALL ON FUNCTION eval_catalog() FROM PUBLIC;

CREATE ROLE eval_catalog_reader LOGIN PASSWORD :'eval_pw' CONNECTION LIMIT 3;
ALTER ROLE eval_catalog_reader SET default_transaction_read_only = on;
ALTER ROLE eval_catalog_reader SET statement_timeout = '60s';
-- Prod's public schema grants PUBLIC no USAGE, so without this the role can't
-- even resolve eval_catalog(). USAGE only allows name lookup; every table still
-- needs its own SELECT, which this role has nowhere.
GRANT USAGE ON SCHEMA public TO eval_catalog_reader;
GRANT EXECUTE ON FUNCTION eval_catalog() TO eval_catalog_reader;
