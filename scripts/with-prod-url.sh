#!/usr/bin/env bash
# Run a command with DATABASE_URL set to the production Neon URL from the Keychain.
#
#   scripts/with-prod-url.sh npm run reset-workout-day -- --email x@y.com --remote --dry-run
#
# Why a runner and not a `print-the-url` helper: anything that writes the URL to
# stdout puts it in the terminal and in the Claude Code transcript, which is
# exactly how it leaked in Sep 2026. Here the secret only ever exists in this
# process's environment, so callers get the credential without ever seeing it.
#
# This path is WRITE-CAPABLE by design — it is for the deliberate prod-write
# scripts (reset-workout-day, comp-user, delete-user, seed-demo-user --remote),
# which confirm before acting. For ad-hoc SQL reads use db-prod-read.sh, which
# pins the connection read-only so Postgres itself refuses writes.
set -euo pipefail

SERVICE="mastersfit-prod-database-url"

[[ $# -gt 0 ]] || { echo "usage: with-prod-url.sh <command> [args...]" >&2; exit 2; }

URL="$(security find-generic-password -a "$USER" -s "$SERVICE" -w 2>/dev/null || true)"

[[ -n "$URL" ]] || {
  echo "no prod URL in the Keychain (service=$SERVICE)." >&2
  echo "Copy the Neon connection string, then run: scripts/db-prod-set-url.sh" >&2
  exit 1; }

# Name the target host (never the credential) so the operator can see, and the
# prod scripts' own --remote guards can confirm, which database is about to be
# written to.
HOST="${URL#*@}"; HOST="${HOST%%/*}"; HOST="${HOST%%\?*}"
echo "with-prod-url: DATABASE_URL -> $HOST" >&2

exec env DATABASE_URL="$URL" "$@"
