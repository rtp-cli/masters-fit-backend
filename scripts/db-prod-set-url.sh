#!/usr/bin/env bash
# Store the production Render Postgres connection string in the macOS Keychain.
#
# Reads the URL from the CLIPBOARD on purpose: the secret never appears in a
# command line, in ~/.zsh_history, on screen, or in a Claude Code transcript.
# (A plaintext prod URL leaked into 6 transcripts + 15 history lines in Sep 2026
# because one `grep DATABASE_URL .env` printed it and it got reused inline from
# context. Keeping it out of every greppable file is the fix.)
#
# Usage: Render dashboard -> masters-fit-db -> Connect -> copy the EXTERNAL
# Database URL, then:
#   scripts/db-prod-set-url.sh
# It checks the host + database, appends sslmode=require if missing, stores it,
# and verifies it connects.
#
# This store is for LOCAL ops tools only (db-prod-read.sh, with-prod-url.sh).
# The backend service on Render uses the INTERNAL url, which only resolves inside
# Render's network — do not paste this external URL into Render's DATABASE_URL.
set -euo pipefail

SERVICE="mastersfit-prod-database-url"

# Non-secret connection coordinates for the prod Render Postgres instance
# (masters-fit-db, Oregon, PostgreSQL 17). The USER is deliberately not pinned:
# Render generates it, and unlike the old Neon setup there is no "reset password"
# dialog that hands back a bare password to rebuild a URL around — Render always
# gives a full connection string. So only the full-URL path is accepted, and the
# host + database are what we check to refuse the wrong instance.
PROD_HOST="dpg-db4gi6e7bikc73elosm0-a.oregon-postgres.render.com"
PROD_DB="masters_fit_db"

CLIP="$(pbpaste)"
CLIP="${CLIP//$'\n'/}"
CLIP="${CLIP//$'\r'/}"
CLIP="${CLIP#"${CLIP%%[![:space:]]*}"}"
CLIP="${CLIP%"${CLIP##*[![:space:]]}"}"

[[ -n "$CLIP" ]] || { echo "clipboard is empty — copy the External Database URL first" >&2; exit 1; }

# Validate without ever echoing the value.
case "$CLIP" in
  postgresql://*|postgres://*)
    URL="$CLIP"
    echo "clipboard: full connection string" ;;
  *://*)
    echo "clipboard is a URL but not postgres:// — refusing" >&2; exit 1 ;;
  *)
    echo "clipboard is not a postgres:// URL — copy the full External Database URL from Render" >&2
    exit 1 ;;
esac
[[ "$URL" == *:*@* ]] || {
  echo "clipboard URL has no password component — copy the full connection string" >&2; exit 1; }

# Parse host + database out of the URL (the credential part is discarded).
HOST="${URL##*@}"; HOST="${HOST%%/*}"; HOST="${HOST%%\?*}"; HOST="${HOST%%:*}"
DB="${URL##*@}"; DB="${DB#*/}"; DB="${DB%%\?*}"

[[ "$HOST" == "$PROD_HOST" ]] || {
  echo "clipboard URL host is '$HOST', not the prod Render host $PROD_HOST — refusing." >&2
  echo "(A bare 'dpg-...-a' host is Render's INTERNAL url; copy the EXTERNAL one.)" >&2
  exit 1; }
[[ "$DB" == "$PROD_DB" ]] || {
  echo "clipboard URL database is '$DB', not $PROD_DB — refusing" >&2; exit 1; }

# src/config/database.ts only enables SSL when the URL says sslmode=require, and
# Render's external endpoint requires SSL — so make sure it's there.
if [[ "$URL" != *sslmode=* ]]; then
  if [[ "$URL" == *\?* ]]; then URL="${URL}&sslmode=require"; else URL="${URL}?sslmode=require"; fi
  echo "appended sslmode=require"
fi

# -U updates in place if it already exists; -T /usr/bin/security lets the reader
# fetch it with no access dialog. The value goes through argv here, which is a
# brief local-only exposure to `ps` — acceptable, and far better than a file.
security add-generic-password -U -a "$USER" -s "$SERVICE" -T /usr/bin/security -w "$URL"

echo "stored in Keychain: service=$SERVICE account=$USER host=$HOST (${#URL} chars)"

# Prove it round-trips and actually connects, still without printing it.
if "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-prod-read.sh" -tAc 'select 1;' >/dev/null 2>&1; then
  echo "verified: read-only connection to prod succeeds"
else
  echo "WARNING: stored, but db-prod-read.sh could not connect with it — check the value" >&2
  exit 1
fi

# This script never writes the clipboard; it still holds the URL you copied.
echo "Now clear the clipboard:  pbcopy </dev/null" >&2
