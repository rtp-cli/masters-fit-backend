# Ticket: Subscription renewal reminder email

**Status:** Scoped, not started · **Owner:** TBD · **Effort:** ~0.5 day backend-only · **Created:** 2026-07-31

## Why

Competitive analysis flagged **silent auto-renewal** as a top complaint across competitors in
this space. Proactively emailing members a few days before their subscription auto-renews is a
trust/differentiator move: no surprise charges, no dark patterns. Apple/Google send their own
receipts inconsistently and after the fact — a clear, branded heads-up before the charge is the
courtesy users say they want.

## Scope

**In:** A daily backend job that finds subscriptions about to auto-renew and sends a branded,
transparent reminder email via Resend.

**Out (v1):** In-app notification/UI, push reminder, dunning/billing-issue emails (that path
already fires a push via `sendBillingIssueNotification`), digest/marketing content.

Backend-only. No app build, no frontend change. Ships via the normal Render deploy + one DB push.

## What we already have (no new integration needed)

- **Renewal date:** `user_subscriptions.subscription_end_date` — set from every RevenueCat
  `INITIAL_PURCHASE` / `RENEWAL` webhook (`expiration_at_ms`). For an auto-renewing sub this
  period-end **is** the date of the next charge. (`subscription.controller.ts` handlers.)
- **Renewal intent:** `status = 'active'` ⇒ auto-renew on. When a user turns off auto-renew the
  webhook flips them to `'cancelled'` (access kept until period end). So `active` + upcoming
  end-date = "about to be silently charged" = our exact target.
- **Monthly vs annual:** join `user_subscriptions.plan_id` → `subscription_plans.billing_period`.
- **Price:** `subscription_plans.price_usd`.
- **Email address:** join `user_subscriptions.user_id` → `users.email` (+ `users.firstName` for
  greeting, if present).
- **Email pipeline:** Resend, wired in `src/services/email.service.ts`; email-client-safe HTML
  template pattern in `src/templates/otp-email.ts`.
- **Scheduling:** Bull + Redis already run in-process (`workoutGenerationQueue`).

## Data model change (the only schema work)

Add one column to `user_subscriptions` (`src/models/subscription.schema.ts`):

```ts
renewalReminderSentAt: timestamp("renewal_reminder_sent_at", { withTimezone: true }),
// The subscription_end_date this reminder was sent FOR. Prevents re-sending on the
// daily scan and across renewal periods. Reset to null on RENEWAL (new period = new reminder).
renewalReminderForPeriodEnd: timestamp("renewal_reminder_for_period_end", { withTimezone: true }),
```

Push with `npm run db:push` (local first, then prod — see [[project_db_schema_sync]]).

In `handleRenewal` (and `handleInitialPurchase`), clear these two fields when we write the new
`subscription_end_date`, so the next period gets its own reminder.

## Job design (multi-instance-safe by construction — see [[project_backend_scaling_intent]])

A **Bull repeatable job** `renewal-reminder`, registered in `src/index.ts` alongside the existing
processors, scheduled via `queue.add('renewal-reminder', {}, { repeat: { cron: '0 15 * * *' } })`
(15:00 UTC ≈ mid-morning US; tune later). New handler `src/jobs/renewal-reminder.job.ts`.

Redis-coordinated schedule (not a raw `setInterval`), so N instances still enqueue once per day.

**Per-run logic:**
1. Select candidate subscriptions (see query below).
2. For each candidate, **atomically claim** it before sending — a check-then-act would double-send
   under concurrent instances:

   ```sql
   UPDATE user_subscriptions
     SET renewal_reminder_sent_at = now(),
         renewal_reminder_for_period_end = subscription_end_date
   WHERE id = $1
     AND status = 'active'
     AND renewal_reminder_for_period_end IS DISTINCT FROM subscription_end_date
   RETURNING *;
   ```
   Only the worker whose UPDATE returns a row sends the email. Racers get zero rows and skip.
3. Send via a new `emailService.sendRenewalReminderEmail(...)`.
4. If the Resend send throws, roll the claim back (set the two fields to null) so a later run retries.

**Candidate query:**
```
status = 'active'
AND access_override IS NULL            -- comped/BYPASS users are never charged
AND subscription_end_date IS NOT NULL
AND subscription_end_date BETWEEN now() AND now() + <window>
AND renewal_reminder_for_period_end IS DISTINCT FROM subscription_end_date
```
Join `subscription_plans` for `billing_period` + `price_usd`, and `users` for `email` / name.

## Timing rules (recommended)

| Billing period | Send reminder |
|---|---|
| Annual  | **7 days** before `subscription_end_date` (the big-ticket "silent" charge people complain about most) |
| Monthly | **3 days** before |

Implement as a per-period window in the query; keep the numbers in a constant
(`RENEWAL_REMINDER_DAYS = { annual: 7, monthly: 3 }`) so they're easy to tune.

## Edge cases

- **Cancelled / expired / trial / grace-period / paused:** excluded by `status = 'active'` filter
  (a cancelled user already knows it's ending — no reminder). Grace-period reuses
  `subscription_end_date`, another reason to filter on status.
- **Comp'd users** (`access_override` set): excluded — they aren't billed.
- **Missing email:** shouldn't happen (`users.email` is NOT NULL), but skip + log if so.
- **Plan lookup miss** (`plan_id` not in `subscription_plans`): send a generic version without the
  price line rather than skipping; log it.
- **Backfill on first deploy:** the scan naturally picks up anyone whose renewal lands in the
  window going forward — no historical backfill needed.

## Decisions (resolved 2026-07-31)

1. **Timing** — ✅ **Both monthly & annual in v1** (7-day annual / 3-day monthly window).
2. **"Manage subscription" CTA** — ✅ **Store-agnostic MastersFit help page** with iOS + Android
   instructions. No `store` column needed for v1. (Store-specific deep links deferred.)
3. **`FROM_EMAIL` in prod** — ✅ Non-issue. It's an env var (local `.env` = `noreply@updates.mastersfit.ai`),
   and the same address already sends OTP/login mail from prod through `email.service.ts`, so the
   sender + Resend domain verification are proven working. Confirm the Render env var at rollout as
   a formality only. (See [[reference_resend_email_infra]].)

## Test plan / verify

- Unit: candidate query returns only active, in-window, unclaimed, non-comped subs; monthly vs
  annual windows; atomic-claim returns a row exactly once for the same period-end.
- Local e2e: seed a sub with `subscription_end_date = now() + 6 days`, `billing_period = annual`,
  trigger the job manually, confirm exactly one Resend send (use Resend test mode / a real inbox),
  re-run and confirm **zero** additional sends. Advance `subscription_end_date` (simulate renewal,
  clear the reminder fields) and confirm a fresh reminder fires.
- Confirm the email renders in Gmail + Apple Mail (template matches `otp-email.ts`).

## Rollout

1. Add columns → `db:push` local, verify, then prod.
2. Merge backend → Render auto-deploys ([[project_render_auto_deploy]]).
3. Confirm `REDIS_URL`, `RESEND_API_KEY`, `FROM_EMAIL` set in prod.
4. Watch logs for the first daily run; confirm sends + idempotency on day two.

---

## Email copy (draft)

Tone matches the existing OTP email: warm, plain, "Train well, The MastersFit team." Transparent,
zero pressure — the entire point is the opposite of a dark pattern.

Merge fields: `{{firstName}}`, `{{planLabel}}` ("annual"/"monthly"), `{{price}}` (e.g. "$49.99"),
`{{renewalDate}}` (e.g. "August 12, 2026"), `{{manageUrl}}`.

### Annual

- **Subject:** `Your MastersFit+ renews on {{renewalDate}}`
- **Preheader:** `A quick heads-up before your annual membership renews — no action needed to continue.`

> Hi {{firstName}},
>
> Just a heads-up: your **MastersFit+ {{planLabel}} membership** renews on **{{renewalDate}}**,
> and your {{price}} subscription will automatically continue for another year.
>
> **Nothing to do if you're staying** — your workouts, history, and streak keep going without
> interruption. We're glad to have you training with us.
>
> If you'd like to make a change before then, you can manage or cancel your subscription anytime:
>
> [ Manage your subscription ]  → {{manageUrl}}
>
> Either way, thanks for being part of MastersFit.
>
> Train well,
> The MastersFit team

### Monthly (same template, tighter)

- **Subject:** `Your MastersFit+ renews on {{renewalDate}}`
- **Preheader:** `A quick heads-up before your monthly membership renews — no action needed to continue.`

> Hi {{firstName}},
>
> Quick heads-up: your **MastersFit+ {{planLabel}} membership** renews on **{{renewalDate}}** for
> {{price}}, and will continue automatically.
>
> **Staying with us? Nothing to do** — everything keeps going. If you'd like to make a change
> first, you can manage or cancel anytime:
>
> [ Manage your subscription ]  → {{manageUrl}}
>
> Train well,
> The MastersFit team

### Plain-text fallback (annual)

```
Hi {{firstName}},

Just a heads-up: your MastersFit+ {{planLabel}} membership renews on {{renewalDate}},
and your {{price}} subscription will automatically continue for another year.

Nothing to do if you're staying — your workouts, history, and streak keep going without
interruption.

If you'd like to make a change before then, you can manage or cancel your subscription
anytime here: {{manageUrl}}

Either way, thanks for being part of MastersFit.

Train well,
The MastersFit team
```
