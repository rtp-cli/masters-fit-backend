#!/usr/bin/env bash
# Mint and print a login OTP for a LOCAL dev account, so simulator sign-in
# doesn't need an inbox. Talks only to the local API + local database.
#
#   scripts/dev-otp.sh rtp+qa@mastersfit.ai
#
set -euo pipefail

EMAIL="${1:-rtp+qa@mastersfit.ai}"
API="${LOCAL_API:-http://localhost:5001/api}"
LOCAL_URL="postgresql://localhost:5432/mastersfit"

curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\"}" >/dev/null

psql "$LOCAL_URL" -t -A -c \
  "select code || '  (expires ' || to_char(expires_at, 'HH24:MI') || ')'
     from auth_codes where email = '$EMAIL' order by id desc limit 1;"
