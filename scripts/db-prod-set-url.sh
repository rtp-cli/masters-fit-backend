#!/usr/bin/env bash
# Store the production Neon connection string in the macOS Keychain.
#
# Reads the URL from the CLIPBOARD on purpose: the secret never appears in a
# command line, in ~/.zsh_history, on screen, or in a Claude Code transcript.
# (A plaintext prod URL leaked into 6 transcripts + 15 history lines in Sep 2026
# because one `grep DATABASE_URL .env` printed it and it got reused inline from
# context. Keeping it out of every greppable file is the fix.)
#
# Usage: copy EITHER the full connection string OR just the password from Neon's
# "Reset password" dialog (that dialog only gives a bare password), then:
#   scripts/db-prod-set-url.sh
# It assembles the pooled URL, stores it, verifies it, and leaves the full URL on
# the clipboard so it can be pasted into Render's DATABASE_URL.
set -euo pipefail

SERVICE="mastersfit-prod-database-url"

# Non-secret connection coordinates for the prod Neon endpoint. Only the password
# is secret, so Neon's "Reset password" dialog (which hands you a bare password,
# never a connection string) is enough to rebuild the whole pooled URL here.
PROD_USER="neondb_owner"
PROD_HOST="ep-mute-dream-adfq9mi7-pooler.c-2.us-east-1.aws.neon.tech"
PROD_DB="neondb"
PROD_PARAMS="sslmode=require&channel_binding=require"

CLIP="$(pbpaste)"
CLIP="${CLIP//$'\n'/}"
CLIP="${CLIP//$'\r'/}"
CLIP="${CLIP#"${CLIP%%[![:space:]]*}"}"
CLIP="${CLIP%"${CLIP##*[![:space:]]}"}"

[[ -n "$CLIP" ]] || { echo "clipboard is empty — copy the password (or full URL) first" >&2; exit 1; }

# Accept EITHER a full connection string or a bare password, so the value can come
# straight from Neon's reset dialog. Validate without ever echoing it.
case "$CLIP" in
  postgresql://*|postgres://*)
    URL="$CLIP"
    echo "clipboard: full connection string" ;;
  *://*)
    echo "clipboard is a URL but not postgres:// — refusing" >&2; exit 1 ;;
  *)
    # Bare password path. Reject anything needing percent-encoding rather than
    # silently building a URL that parses wrong.
    case "$CLIP" in
      *[/:@?\#\[\]]*)
        echo "password contains a character that needs URL-encoding (/ : @ ? # [ ])." >&2
        echo "Copy the full connection string from Neon instead, then re-run." >&2
        exit 1 ;;
    esac
    [[ ${#CLIP} -ge 12 ]] || { echo "clipboard is only ${#CLIP} chars — that is not the password" >&2; exit 1; }
    URL="postgresql://${PROD_USER}:${CLIP}@${PROD_HOST}/${PROD_DB}?${PROD_PARAMS}"
    echo "clipboard: bare password (${#CLIP} chars) — assembled pooled URL for ${PROD_HOST}" ;;
esac
[[ "$URL" == *neon.tech* ]] || {
  echo "clipboard URL is not a neon.tech host — refusing; this store is for prod Neon only" >&2; exit 1; }
[[ "$URL" == *:*@* ]] || {
  echo "clipboard URL has no password component — copy the full connection string" >&2; exit 1; }

# -U updates in place if it already exists; -T /usr/bin/security lets the reader
# fetch it with no access dialog. The value goes through argv here, which is a
# brief local-only exposure to `ps` — acceptable, and far better than a file.
security add-generic-password -U -a "$USER" -s "$SERVICE" -T /usr/bin/security -w "$URL"

echo "stored in Keychain: service=$SERVICE account=$USER (${#URL} chars)"

# Prove it round-trips and actually connects, still without printing it.
if "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-prod-read.sh" -tAc 'select 1;' >/dev/null 2>&1; then
  echo "verified: read-only connection to prod succeeds"
else
  echo "WARNING: stored, but db-prod-read.sh could not connect with it — check the value" >&2
  exit 1
fi

# Leave the full URL on the clipboard for the one place that still needs a paste:
# Render's DATABASE_URL env var. Never printed, only copied.
#
# This REPLACES what the operator just copied from Neon, which is surprising
# enough that it has to be said loudly and up front (it confused a real rotation
# in Sep 2026: "the value I copied is not a URL, it's a key"). Do not make this
# quieter.
printf '%s' "$URL" | pbcopy
cat >&2 <<'BANNER'

┌──────────────────────────────────────────────────────────────────────────┐
│  YOUR CLIPBOARD HAS BEEN REPLACED                                        │
│                                                                          │
│  It no longer holds the bare password you copied from Neon. It now       │
│  holds the FULL pooled connection string, assembled around it — that     │
│  is what Render wants. (Never displayed, only copied.)                   │
└──────────────────────────────────────────────────────────────────────────┘

NEXT: Render -> backend service -> Environment -> DATABASE_URL -> paste -> Save.
Then clear the clipboard:  pbcopy </dev/null

Clipboard clobbered before you pasted? You do NOT need to reset the password
again — put it back from the Keychain:
  security find-generic-password -a "$USER" -s mastersfit-prod-database-url -w | tr -d '\n' | pbcopy
BANNER
