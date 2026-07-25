---
name: reset-workout-local
description: Use to replay/test workout logging on the LOCAL database by rewinding ONE plan day back to not-started — deletes that day's logs and un-completes it so you can log it again, without rebuilding the account. Triggers "/reset-workout-local", "reset today's workout", "reset the workout day so I can test logging again", "reset my QA workout locally", "let me redo today's session". Defaults to the QA account rtp+qa@mastersfit.ai and today in the account's profile timezone. For production use reset-workout-prod; for a full account rebuild use reseed-dave-local.
---

# Reset Workout Day — LOCAL

Rewinds **one plan day** back to "not started" so you can replay workout logging on a stable QA
account without regenerating a plan or making a throwaway account. It's the surgical opposite of
finishing a workout: it deletes that day's set / exercise / block / day logs, flips
`plan_days.is_complete` and `plan_day_exercises.completed` back to false, un-completes the parent
workout, and rebuilds the `workout_logs` rollup (`completedDays` / `completedExercises` /
`completedBlocks` / `daysCompleted`) so the dashboard and streak stay consistent.

Backed by `src/scripts/reset-workout-day.ts` (npm script `reset-workout-day`).

**Scoped + safe:** only the one day for the one account you name is touched — the plan, profile,
subscription, and every other day's history are left intact. The default `DATABASE_URL` in
`backend/.env` is **local**, and the script refuses a non-local DB unless `--remote` is passed
(that's the separate **reset-workout-prod** skill).

## Which account + day

- **Account:** `rtp+qa@mastersfit.ai` (the dedicated QA/test account; local id 55). Don't use the
  marketing demo user `rtp+demo@mastersfit.ai` for logging tests — keep its data clean for
  screenshots (see **reseed-dave-local**).
- **Day:** defaults to **today in the account's profile timezone** (matches the app/streak's
  notion of "today"). Pass `--date YYYY-MM-DD` to target a different day. It resolves the plan day
  whose `date` equals that date in the account's **active** workout — so it resets whatever the
  currently-generated plan has scheduled for that date.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

## Reset

Always preview first, then run for real:

```bash
# Preview — writes nothing:
npm run reset-workout-day -- --email rtp+qa@mastersfit.ai --dry-run

# Reset today's session:
npm run reset-workout-day -- --email rtp+qa@mastersfit.ai

# Reset a specific date:
npm run reset-workout-day -- --email rtp+qa@mastersfit.ai --date 2026-07-25
```

Expect output that prints the DB host + `local=true`, the resolved target day, a count of logs
cleared, `✓` lines, and `daysCompleted -> N`. If it prints **"No plan day found … on <date>"**,
the account's active plan doesn't cover that date — generate a workout for that day first, then
reset it (see the FAQ below).

## Verify

1. The script prints `✓` lines and `Done. Day <date> ... is reset to not-started`.
2. **Reload the app's JS bundle** (press `r` in the Metro terminal, or shake → Reload). The app
   holds completion state in its in-memory React Query cache for the session, so after a DB reset
   the app keeps showing the workout as **completed** until the bundle reloads — pull-to-refresh
   alone often isn't enough. This is the #1 "it didn't work" gotcha; always reload after a reset.
   (The cache is not persisted to disk, so a reload fully clears it.)
3. After the reload: today's session is back to **not-started** (Start button, no logged sets),
   the dashboard "completed" count is decremented, and the streak reflects the removal.

## Sim login (if the QA session is stale)

Pre-insert a 4-digit code so you don't wait on an email — in the local DB:

```sql
DELETE FROM auth_codes WHERE code = '2468' OR email = 'rtp+qa@mastersfit.ai';
INSERT INTO auth_codes (email, code, expires_at, used)
VALUES ('rtp+qa@mastersfit.ai', '2468', now() + interval '120 minutes', false);
```

Then in the app: enter `rtp+qa@mastersfit.ai`, request a code, and type `2468`.

## FAQ — "I generated a fresh workout for today and completed it; will this reset it?"

Yes. The reset targets the plan day whose `date` matches the date you give (default = today), in
the account's **active** workout. When you generate a new workout, it becomes the active one and
its plan days carry real calendar dates — so completing today's session and then running this
reset (same calendar day, or `--date` for another) finds and clears it. The only time the default
fails is when the active plan has **no** day dated for that date (e.g. stale seed data that
doesn't extend to today) — generate a workout for that day first, then reset.

## Related

- **reset-workout-prod** — the same reset against production (Neon).
- **reset-user-trial** — un-block generation (trial/subscription) on an account.
- **reseed-dave-local** — full rebuild of the marketing demo user, locally.
