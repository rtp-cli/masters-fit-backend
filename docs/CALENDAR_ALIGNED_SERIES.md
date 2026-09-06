# Calendar-Aligned Workout Series

**Status:** Spec — ready to build. Written 2026-09-06, on hold until the fresh Wendler
generation (2026-09-07) is evaluated.
**Origin:** the 2026-09-06 generation-forensics thread (PRs #53–#57). A Thursday-started
series spilled into the following week and had to be manually cleaned up; the follow-up
question was how a series created mid-week should relate to calendar weeks at all.

## The rule

> **Every new series spans from its start date through the next Sunday that is at least
> 7 days away.**

One rule, no tier branches, no special cases. Weeks are **Monday–Sunday** in the
**user's profile timezone**.

| Signup / new-program day | Series span | Length |
|---|---|---|
| Monday | Mon → Sun | 7 days |
| Thursday | Thu → *next* Sun | 10 days |
| Saturday | Sat → *next* Sun | 8 days |
| Sunday | Sun → *next* Sun | 8 days |

Every series ends on a Sunday, so **from the second series onward everything is
naturally Mon–Sun aligned** — the invariant holds forever with no migration.

## Why this shape (and not "clamp to this Sunday")

Free allowances are **lifetime**, not recurring (`access-policy.ts`): 1 `INITIAL_PLAN`,
1 `WEEK_ADJUSTMENT`, 3 `DAY_ADJUSTMENT`s; a second program is PLUS-only. A free user
gets exactly one series generation, ever. A naive "partial week, then align" rule makes
that one trial 1–7 days long depending on signup weekday — up to ~4× unfairness — and
drops the paywall mid-first-weekend.

Under this rule:
- **Free trial is ≥7 days for everyone** (7–13), on average ~3 days MORE than today's
  rolling week. The paywall moment becomes a *completed, Sunday-terminated week* — the
  natural "want next week?" conversion prompt.
- Ledger/entitlements are **untouched** — still exactly one `INITIAL_PLAN` op.
- Cost is bounded: up to ~12 parallel Haiku day-calls instead of ~6 on that one
  generation (~1.5–2× tokens for the single most funnel-critical generation;
  wall-clock barely moves since day calls run in parallel).

## What changes

### Backend (the whole behavioral change)

1. **`src/utils/plan-schedule.ts`** — the single source of truth for day→date mapping
   (prompts and persistence both consume it, per GQ-01). `buildPlanDaySchedule` gains
   an end-boundary: walk available weekdays forward from `startDate` and stop at the
   next Sunday ≥ 7 days away (instead of stopping at a fixed day count). The window
   boundary is computed in the profile timezone (the evening-US "today" bug family —
   never UTC).
2. **`expectedDayCount`** in `workout-agent.service.generateWeeklyWorkout` already
   derives from the schedule length — no change needed, but it will now range up to
   ~11–12 (e.g. 6 available days over a 13-day window).
3. **Planning prompt** (`fanout-prompt-generator.ts`): the "THIS WEEK'S TRAINING DATES"
   section already lists real dates per slot; retitle/reword so a >7-day first series
   is framed as "rest of this week + next week" and the planner balances muscle groups
   across the whole window (the consecutive-day overload check is sequence-based and
   works unchanged).
4. **GQ-02 interplay (must keep winning):** an explicit schedule override in the user's
   request ("start me Monday", "only 3 days", named weekdays) resolves first via
   `resolveEffectiveSchedule`; the next-Sunday-≥7 boundary then applies from the
   *overridden* start. "Start me Monday" therefore yields a clean 7-day Mon–Sun week.
5. **`endDate`** already extends past `today+6` when the schedule requires it (the
   start-next-Monday shift uses this) — verify, no change expected.
6. **Unchanged:** `WEEK_ADJUSTMENT` (regenerates the current series in place),
   `DAY_ADJUSTMENT`/rest-day generation, the repeat-past flow, the ai_operations
   ledger, all entitlements. **No schema change.**

### Frontend

- Calendar: a first series spanning two calendar weeks renders with a **week divider**
  ("This week" / "Next week"), not as an undifferentiated 10-day run.
- Post-generation copy sells the runway: "Your plan runs through Sunday, Sep 14."
- Dashboard "days per week" goal: **prorate the partial first calendar week** (a
  Thursday signup with a 6-day/week goal shouldn't see a broken completion ring on
  their first Sunday). Decision recorded here; implementation lives with the dashboard
  week logic — which must also use profile-tz Mondays.

## Edge cases

- **Sunday signup:** "next Sunday ≥7 days away" = 8-day series (today + full Mon–Sun).
- **Available days ∩ window:** the schedule only places days on the user's available
  weekdays inside the window; a 10-day window with 3 available days/week yields ~4–5
  plan days. That's correct — the window bounds dates, availability bounds count.
- **User asks for more days than the window allows:** existing GQ-04 clamp conflict
  surfaces it in the in-app banner, unchanged.
- **Existing active series:** unaffected. They run out on their old rolling window;
  alignment applies from each user's next generation. No migration, no backfill.
- **DST weeks:** boundary math is date arithmetic on YYYY-MM-DD in profile tz (as
  plan-schedule already does), not epoch millis — no DST hazard.

## Test plan

- **Unit (`plan-schedule.test.ts`):** boundary table above, each start weekday ×
  available-day sets (incl. Sunday-excluded and 3-day profiles); profile-tz boundary
  (US evening case); GQ-02 override + boundary combined ("start me Monday" mid-week).
- **Eval (`npm run eval-generation`):** add 8-, 10-, and 13-day-window scenarios —
  long windows are untested planner shape, exactly as short weeks were before EW-1
  (the 8/12 eval's weak spot was non-7-day schedules; PR#49 retries + PR#56 weekday
  compliance + Sonnet-planning-on-override all apply, but measure before shipping).
- **Manual:** fresh signup on a Thu (local), confirm series ends next Sunday, calendar
  divider renders, per-day dates in `plan_days` match the prompt's date labels
  (`prompt_snapshot`), and one `INITIAL_PLAN` ledger row.

## Rollout

Single contained change behind the existing generation pipeline; no flag strictly
needed, but `CALENDAR_ALIGNED_SERIES=true` env-gating the plan-schedule clamp is cheap
insurance and lets prod A/B against the eval results. Ship backend first (behavior is
correct without UI), frontend divider/copy in the next build or OTA.
