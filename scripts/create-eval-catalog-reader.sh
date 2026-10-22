#!/usr/bin/env bash
# One-time setup: create the catalog-only eval role on PROD and store its URL as
# the EVAL_CATALOG_DATABASE_URL GitHub secret (and in the Keychain as
# mastersfit-eval-catalog-url, for local probes). See
# src/scripts/sql/create-eval-catalog-reader.sql for what the role can see.
#
# The password is generated here and only ever reaches psql's variable and the
# stdin of `gh secret set` — never stdout, a file, or the transcript.
set -euo pipefail
cd "$(dirname "$0")/.."

PW="$(openssl rand -hex 24)" exec scripts/with-prod-url.sh sh -c '
  set -eu
  psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -q \
    -v eval_pw="$PW" -f src/scripts/sql/create-eval-catalog-reader.sql
  # Same host, database and params as prod; only the credentials differ.
  URL="postgresql://eval_catalog_reader:$PW@${DATABASE_URL#*@}"
  printf "%s" "$URL" | gh secret set EVAL_CATALOG_DATABASE_URL
  security add-generic-password -U -a "$USER" -s mastersfit-eval-catalog-url -w "$URL"
  echo "created eval_catalog_reader; URL stored in GitHub secret EVAL_CATALOG_DATABASE_URL + Keychain mastersfit-eval-catalog-url"
'
