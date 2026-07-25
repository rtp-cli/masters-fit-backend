---
name: reset-workout-prod
description: Use to replay/test workout logging on PRODUCTION (Neon) by rewinding ONE plan day back to not-started — deletes that day's logs and un-completes it so you can log it again on the live database. Triggers "/reset-workout-prod", "reset today's workout on prod", "reset the prod QA workout", "reset production workout so I can test logging". Writes to the LIVE db — confirm the account + date first. Defaults to the QA account rtp+qa@mastersfit.ai and today in the account's profile timezone. For local use reset-workout-local; for a full account rebuild use reseed-dave-prod.
---

# Reset Workout Day — PRODUCTION (Neon)

Same surgical reset as **reset-workout-local**, but against the **live production database**. It
rewinds one plan day back to not-started: deletes that day's set / exercise / block / day logs,
flips `plan_days.is_complete` and `plan_day_exercises.completed` false, un-completes the parent
workout, and rebuilds the `workout_logs` rollup so the dashboard and streak stay consistent.

Backed by `src/scripts/reset-workout-day.ts`, run with `--remote` against the prod `DATABASE_URL`.

> ⚠️ **This writes to production.** Only run when the user explicitly asks to reset on prod, and
> **confirm the account + date first.** Effects are recoverable by simply re-logging the workout
> in the app, but treat it as a real prod change. Only the one day for the one named account is
> touched — the plan, profile, subscription, and every other day's history are left intact.

## Which account + day

- **Account:** `rtp+qa@mastersfit.ai` (the dedicated QA/test account; prod id 103). Never reset a
  real customer's workout on prod unless they've explicitly asked you to.
- **Day:** defaults to **today in the account's profile timezone**. Pass `--date YYYY-MM-DD` for a
  specific day. It resolves the plan day whose `date` equals that date in the account's **active**
  workout.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

## Reset (prod)

The active `DATABASE_URL` in `backend/.env` is **local**; the prod Neon URL is the **commented**
line in that file. Extract it inline and add `--remote`. **Note:** macOS/BSD `sed` does NOT
support `\s` — use `[[:space:]]`, or the `# DATABASE_URL=` prefix silently stays on the value and
`new URL()` throws "Invalid URL".

```bash
PROD_URL=$(grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL=' .env | head -1 \
  | sed -E 's/^[[:space:]]*#[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')

# 1. ALWAYS preview against prod first:
DATABASE_URL="$PROD_URL" npm run reset-workout-day -- \
  --email rtp+qa@mastersfit.ai --remote --dry-run

# 2. Then the real reset:
DATABASE_URL="$PROD_URL" npm run reset-workout-day -- \
  --email rtp+qa@mastersfit.ai --remote
```

Expect a `local=false` line + a `⚠️ --remote` warning naming the Neon host, the resolved target
day, `✓` lines, and `daysCompleted -> N`. If it prints **"No plan day found … on <date>"**, the
active plan doesn't cover that date — generate a workout for that day first, then reset.

## Verify

1. The script prints `✓` lines and `Done. Day <date> ... is reset to not-started`.
2. **Reload the app's JS bundle** (press `r` in Metro, or shake → Reload). Completion state lives
   in the app's in-memory React Query cache for the session, so after a DB reset the app keeps
   showing the workout **completed** until the bundle reloads — pull-to-refresh alone often isn't
   enough. #1 "it didn't work" gotcha; always reload. (Not persisted to disk; a reload clears it.)
3. After the reload: today's session is back to **not-started** (Start button, no logged sets),
   the dashboard "completed" count is decremented, and the streak reflects the removal.

## Prod sim/app login (if the QA session is stale)

The production app points at prod, so pre-insert a login code in the **prod** DB:

```bash
psql "$PROD_URL" -c "DELETE FROM auth_codes WHERE code='2468' OR email='rtp+qa@mastersfit.ai';" \
  -c "INSERT INTO auth_codes (email, code, expires_at, used)
      VALUES ('rtp+qa@mastersfit.ai','2468', now() + interval '120 minutes', false);"
```

Then in the app: enter `rtp+qa@mastersfit.ai`, request a code, and type `2468`. The code expires
in ~2 hours; re-insert whenever you need to log in again.

## Related

- **reset-workout-local** — the same reset against the local DB (the default; use that unless you
  specifically need prod).
- **reset-user-trial** — un-block generation (trial/subscription) on an account.
- **reseed-dave-prod** — full rebuild of the marketing demo user, on prod.
