---
name: reseed-dave-prod
description: Use ONLY when intentionally reseeding the MastersFit demo user "Dave Walker" (rtp+demo@mastersfit.ai) on PRODUCTION (Render Postgres) — rebuild the live demo account's workout history anchored to today, e.g. for a live demo or an app-store review login. Destructive on prod (deletes + recreates the demo user). "reseed Dave on prod", "refresh the production demo user". For local use reseed-dave-local instead.
---

# Reseed Dave Walker — PRODUCTION (Render Postgres)

Rebuilds the **live** demo account (`rtp+demo@mastersfit.ai`, "Dave Walker") on the Render
Postgres production database via `src/scripts/seed-demo-user.ts --remote`. The script only ever
touches the demo user — but it runs against the real database, so treat this like a prod DB
operation and **do it deliberately**. For local, use **reseed-dave-local**.

> ⚠️ This **deletes the prod demo user and all his data, then recreates him with a new id.** Any
> device logged into that account (a reviewer, a live demo) must re-authenticate afterward.
>
> The new id also drops Dave out of the model canary: Render's `MODEL_CANARY_USER_IDS` env var
> (currently `3,41,103,158`; Dave is `158`) lists him by id. After a prod reseed, tell the user
> his new id so they can swap it into that env var in the Render dashboard, or he silently stops
> getting canary models.

## Guardrails (do not skip)

- **Never handle the connection string.** Prefix the command with `scripts/with-prod-url.sh`,
  which injects `DATABASE_URL` from the macOS Keychain into the child process only. Do not fetch
  it from the Render dashboard or `.env`, and never let it reach a command line or the screen.
- **Confirm you're hitting prod, not local.** The script prints `local=false` and a
  `⚠️ --remote: seeding NON-LOCAL database "<host>"` warning, and the host must look like
  `*.oregon-postgres.render.com`. **If you don't see that warning and host, stop** — you may be
  about to wipe the wrong DB.
- **Exercise-library prerequisite.** The seed references hardcoded exercise IDs verified against
  the **local** exercises table. Production must have those same IDs present, or the reseed will
  fail (FK errors) or attach the wrong exercises. If unsure, verify the prod `exercises` table
  before running.
- **Confirm intent with the user** before running — this is destructive on prod.

## Reseed

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
scripts/with-prod-url.sh npx tsx src/scripts/seed-demo-user.ts --remote
```

Watch for `local=false` + the non-local warning, then the per-week seed log and the final
`Done. Demo user "Dave Walker" <rtp+demo@mastersfit.ai> id=<n>`.

To **delete** the prod demo user only (no reseed):

```bash
scripts/with-prod-url.sh npx tsx src/scripts/seed-demo-user.ts --remote --delete
```

## Timing note

The script anchors "today" using the **UTC** date at run time, while the app shows the device's
**local** date (demo profile tz is `America/Chicago`); they align during the **daytime** (before
~7pm Central). Reseed during the day if you need the active-workout card and streak to agree for
a demo/review.

## Verify

```bash
scripts/db-prod-read.sh -c "select u.id, u.email, count(pd.id) as plan_days
  from users u
  left join workouts w on w.user_id = u.id
  left join plan_days pd on pd.workout_id = w.id
  where u.email = 'rtp+demo@mastersfit.ai'
  group by u.id, u.email;"
```

Or log into the production app as Dave and confirm the dashboard shows the 🔥 streak chip and an
active workout for today.
