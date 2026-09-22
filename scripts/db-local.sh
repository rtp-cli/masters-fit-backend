#!/usr/bin/env bash
# Local dev database only. The connection string is hardcoded to localhost so
# this script can be allowlisted without widening access to prod — the prod
# credential lives in the Keychain and is only reachable through
# db-prod-read.sh (read) / with-prod-url.sh (write).
#
#   scripts/db-local.sh -c 'select count(*) from users;'
#
set -euo pipefail

LOCAL_URL="postgresql://localhost:5432/mastersfit"

if [[ "${1:-}" == "--host" ]]; then
  # Confirm which database you're on without printing anything else.
  echo "localhost:5432/mastersfit"
  exit 0
fi

exec psql "$LOCAL_URL" "$@"
