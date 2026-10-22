#!/usr/bin/env bash
# Build the generation eval's throwaway database: schema from the code under
# test, shared exercise catalog from prod, one synthetic eval user. Run by
# .github/workflows/eval-generation.yml against its Postgres service container;
# runnable locally against any EMPTY database.
#
#   DATABASE_URL           target (empty) database — gets written
#   CATALOG_SOURCE_URL     the eval_catalog_reader URL (can only run eval_catalog())
#   EVAL_USER_ID           users.id the eval attributes generations to (default 1)
#
# No prod user data is copied: the catalog function excludes users' custom
# exercises, and the eval user is invented here.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?target DATABASE_URL required}"
: "${CATALOG_SOURCE_URL:?CATALOG_SOURCE_URL required}"
EVAL_USER_ID="${EVAL_USER_ID:-1}"
CSV="$(mktemp)"; PUSH_LOG="$(mktemp)"
trap 'rm -f "$CSV" "$PUSH_LOG"' EXIT

# Schema from the code, not a prod dump: a dump would need SELECT on every prod
# table (see src/scripts/sql/create-eval-catalog-reader.sql), and this way a PR
# that changes the schema is scored against its own schema. Push only chokes on
# idx_exercises_owner_name_unique when introspecting a DB that already has it;
# into an empty DB it creates it fine.
npx drizzle-kit push --force > "$PUSH_LOG" 2>&1 || { cat "$PUSH_LOG"; exit 1; }
echo "schema: pushed from src/models"

psql "$CATALOG_SOURCE_URL" -v ON_ERROR_STOP=1 -q \
  -c "\\copy (SELECT * FROM eval_catalog()) TO '$CSV' WITH (FORMAT csv, HEADER)"

# The CSV header names the columns, so the copy follows whatever columns prod's
# exercises table has (as long as the code's schema has them too).
COLS="$(head -1 "$CSV")"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
\\o /dev/null
\\copy exercises ($COLS) FROM '$CSV' WITH (FORMAT csv, HEADER)
-- Generation can add exercises; keep new ids clear of the copied ones.
SELECT setval('exercises_id_seq', (SELECT max(id) FROM exercises));
INSERT INTO users (id, name, email) VALUES ($EVAL_USER_ID, 'Eval Bot', 'eval@invalid.local');
SELECT setval('users_id_seq', greatest($EVAL_USER_ID, 1));
SQL

psql "$DATABASE_URL" -Atc "SELECT 'seeded: ' || count(*) || ' catalog exercises (max id ' || max(id) || '), eval user $EVAL_USER_ID' FROM exercises"
