---
name: reseed-dave-local
description: Use when reseeding/refreshing the MastersFit demo user "Dave Walker" (rtp+demo@mastersfit.ai) on the LOCAL database — rebuild the demo account's workout history so the dashboard, streak, and active workout are anchored to today (for marketing screenshots from the simulator or local dev). "reseed Dave locally", "refresh the demo user", "demo data is stale". For production/Neon use reseed-dave-prod instead.
---

# Reseed Dave Walker — LOCAL

The demo user is **Dave Walker** (`rtp+demo@mastersfit.ai`), seeded by
`src/scripts/seed-demo-user.ts`. He has 12 weeks of realistic workout history anchored to
**today** (11 prior weeks fully completed + the active week with today's session pending), so
the dashboard shows a live streak and an active workout. Over time the dates go stale — rerun
this to re-anchor them to today.

The script is **idempotent and scoped**: it wipes the existing demo user first, then recreates
him, and only ever touches that one user. The default `DATABASE_URL` in `backend/.env` is
**local**, so no extra flags are needed; the script also refuses to touch a non-local DB unless
`--remote` is passed (that's the separate **reseed-dave-prod** skill).

> ⚠️ Reseeding **deletes and recreates** the demo user, so his **user id changes**. Any
> logged-in session for that account (e.g. the simulator) becomes stale and must log in again.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

## Reseed

```bash
npx tsx src/scripts/seed-demo-user.ts
```

Expect output that prints the DB host + `local=true`, deletes the old demo user, logs each week
as it seeds, and ends with `Done. Demo user "Dave Walker" <rtp+demo@mastersfit.ai> id=<n>`.

To **remove** the demo user without reseeding:

```bash
npx tsx src/scripts/seed-demo-user.ts --delete
```

## Timing note (for screenshots)

The script anchors "today" using the **UTC** date at run time, while the app's dashboard shows
the device's **local** date. They only line up during the **daytime** (before ~7pm Central). If
you reseed in the evening, the dashboard's "today" can land on a rest/gap day even though the
streak is correct. **Reseed + capture during the day** so the active-workout card and streak
agree. (The demo profile timezone is `America/Chicago`.)

## Log in on the simulator after a reseed

Because the user id changed, log in fresh. Fastest path: pre-insert a 4-digit login code so you
don't wait on an email — in the local DB:

```sql
DELETE FROM auth_codes WHERE code = '2468' OR email = 'rtp+demo@mastersfit.ai';
INSERT INTO auth_codes (email, code, expires_at, used)
VALUES ('rtp+demo@mastersfit.ai', '2468', now() + interval '60 minutes', false);
```

Then in the app: enter `rtp+demo@mastersfit.ai`, request a code, and type `2468`.

## Verify

The final `Done.` line confirms success. To double-check, open the app as Dave and confirm the
**dashboard shows the 🔥 streak chip** and an active workout for today, or query the DB:

```bash
psql "$DATABASE_URL" -c "select u.id, u.email, count(pd.id) as plan_days
  from users u
  left join workouts w on w.user_id = u.id
  left join plan_days pd on pd.workout_id = w.id
  where u.email = 'rtp+demo@mastersfit.ai'
  group by u.id, u.email;"
```
