#!/usr/bin/env bash
# Read-only query runner against the production Neon DB.
# Read-only is enforced at the CONNECTION level (default_transaction_read_only=on),
# so Postgres itself refuses any write. Do NOT add a --write mode to this script.
# Usage:  db-prod-read.sh -tAc 'select id, email from users limit 5;'
set -euo pipefail

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
[[ -f "$ENV_FILE" ]] || { echo "no .env at $ENV_FILE" >&2; exit 1; }

RAW="$(grep -E '^# *DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's/^# *DATABASE_URL=//; s/^"//; s/"$//')"
[[ -n "$RAW" ]] || { echo "no commented prod DATABASE_URL found in .env" >&2; exit 1; }

# Neon's connection POOLER rejects the `options` startup parameter outright
# ("unsupported startup parameter in options"), so force the UNPOOLED host by
# dropping the "-pooler" suffix. Neon documents this as the required workaround.
# This matters for safety, not just connectivity: because an unsupported
# parameter makes the connection FAIL rather than be ignored, this scheme is
# fail-closed -- it can never silently connect without the read-only pin.
RAW="${RAW/-pooler./.}"

RO_OPT='options=-c%20default_transaction_read_only%3Dtrue'
if [[ "$RAW" == *\?* ]]; then URL="${RAW}&${RO_OPT}"; else URL="${RAW}?${RO_OPT}"; fi

[[ $# -gt 0 ]] || { echo "usage: db-prod-read.sh -tAc '<sql>'" >&2; exit 2; }

exec psql "$URL" -v ON_ERROR_STOP=1 --single-transaction "$@"
