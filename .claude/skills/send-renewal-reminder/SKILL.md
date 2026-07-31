---
name: send-renewal-reminder
description: Manually fire the subscription renewal-reminder email — either a safe TEST SEND of one rendered email to an address you name (no DB writes, real Resend delivery, to preview it in an inbox), or RUN THE REAL SCAN now (same as the daily 15:00-UTC cron) against the local or production database. Triggers "/send-renewal-reminder", "send a test renewal email", "preview the renewal reminder in my inbox", "fire/trigger the renewal reminder", "run the renewal reminder scan now", "email due subscribers now". Backed by src/scripts/send-renewal-reminder.ts. The real scan against prod emails REAL customers — confirm first.
---

# Send Renewal Reminder — manual trigger

Fires the subscription renewal-reminder email on demand instead of waiting for the daily
15:00-UTC cron. Backed by `src/scripts/send-renewal-reminder.ts` (npm script
`send-renewal-reminder`). See the feature ticket at `docs/renewal-reminder-email.md` and the
[[project_renewal_reminder_email]] memory for the full design.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

Two modes — pick based on what the user is asking for:

## Mode 1 — Test send (default; safe)

Send ONE rendered reminder to an address, to preview it in a real inbox. **Touches no database
rows** (no claim, no real subscribers), so it's always safe to run. Price and renewal date default
to the plan's real values; override any field.

```bash
# Annual (default):
npm run send-renewal-reminder -- --to you@example.com

# Monthly:
npm run send-renewal-reminder -- --to you@example.com --plan monthly

# Override any field:
npm run send-renewal-reminder -- --to you@example.com --plan annual \
  --name "Ada" --price '$89.99' --date "August 12, 2026"
```

Expect a `Sending TEST renewal reminder to …` line and `✓ Sent (no database rows touched).`
Needs `RESEND_API_KEY` in `.env` (present locally); it sends through the same Resend sender as the
OTP email. If the user just wants to "see the email," this is the mode.

## Mode 2 — Run the real scan now

The exact thing the cron does: find every ACTIVE subscriber due within their window (annual 7d /
monthly 3d), email each once (idempotent via the atomic claim), and write the claim to the DB.

```bash
# Local db:
npm run send-renewal-reminder -- --run
```

Against **production**, this emails REAL customers. The script refuses a non-local `DATABASE_URL`
unless you also pass `--remote`. The active `DATABASE_URL` in `.env` is local; the prod Neon URL is
the **commented** line — extract it inline (see [[reference_prod_db_access]]).

> ⚠️ **`--run --remote` emails real subscribers.** Only run it when the user explicitly asks to
> trigger the real send on prod. Confirm intent first. It's idempotent — a second run skips anyone
> already reminded for this period — but the emails have gone out.

**Note:** macOS/BSD `sed` does NOT support `\s` — use `[[:space:]]`, or the `# DATABASE_URL=`
prefix silently stays on the value and `new URL()` throws "Invalid URL".

```bash
PROD_URL=$(grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL=' .env | head -1 \
  | sed -E 's/^[[:space:]]*#[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')

DATABASE_URL="$PROD_URL" npm run send-renewal-reminder -- --run --remote
```

Expect a `Running the real renewal-reminder scan now against LOCAL|REMOTE db…` line and
`✓ Scan complete: {"candidates":N,"sent":N,"skipped":N,"failed":N}`.
- `candidates` = subscribers in-window this run; `sent` = emails delivered.
- `skipped` = already reminded for this period (idempotency working).
- `failed` = send threw; the claim was released so a later run retries.

## Verify

- **Test send:** the named inbox receives the email — Manrope type, logo, the renewal date in the
  opening sentence, the price under the date, and the "Manage your subscription" button opening
  `https://mastersfit.ai/manage-subscription`.
- **Real scan:** the printed counts are sane; re-running immediately shows the same people under
  `skipped` (not `sent`) — proof the atomic claim is holding.

## Related

- [[project_renewal_reminder_email]] — the shipped feature (schema, cron, architecture).
- **reset-workout-prod / reset-workout-local** — the sibling operational scripts this mirrors.
