---
name: weekly-usage-report
description: Build or send the internal weekly MastersFit usage report — people who trained, sessions, activities, signups, paying/comped counts, revenue, who's new, who went quiet — for the last full Monday–Sunday week vs the week before. It is EMAILED to the owner automatically every Monday 08:00 Central by a Render cron; use this skill to preview it, send a test copy, re-send it, or look at a past week. Triggers "/weekly-usage-report", "usage report", "weekly report", "how did last week go", "send me the usage report", "re-send the weekly email", "what would Monday's report say". Backed by src/scripts/send-usage-report.ts. Read-only against the database in every mode.
---

# Weekly usage report

An internal email to the owner, sent automatically **every Monday at 08:00 Central** by the
`usage report` Bull queue on Render. It covers the last full Monday–Sunday week (America/Chicago)
against the week before. Code: `src/services/usage-report.service.ts` (queries),
`src/templates/usage-report-email.ts` (email), `src/jobs/usage-report.job.ts` (cron).

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

**Every mode only reads.** All queries run inside one `read only` Postgres transaction, so even
against prod nothing can be written.

## Modes

```bash
# 1. Preview (default): print the text version, write HTML to ~/Desktop/mastersfit-usage-report.html. Sends nothing.
npm run send-usage-report

# 2. Test send to one address
npm run send-usage-report -- --to rtp@mastersfit.ai

# 3. Send for real to the configured owner inbox (what the cron does; respects the kill switch)
npm run send-usage-report -- --send

# Any week in the past: the report covers the full Mon–Sun week BEFORE --date
npm run send-usage-report -- --to rtp@mastersfit.ai --date 2026-10-12
```

Against **production**, prefix with `scripts/with-prod-url.sh` (injects the Keychain URL into the
child process only — never grep it out of a file) and add `--remote`:

```bash
scripts/with-prod-url.sh npm run send-usage-report -- --remote
scripts/with-prod-url.sh npm run send-usage-report -- --remote --to rtp@mastersfit.ai
```

`--to` and `--send` need `RESEND_API_KEY` (present in local `.env`). `--send` also needs
`SIGNUP_NOTIFY_ENABLED=true`.

If you only need a number and not the email, a read through `scripts/db-prod-read.sh` is fine.

## What the numbers mean

- **Trained** — real users with at least one exercise logged or one activity (manual or
  health-import) in the week.
- **Session** — a plan day with at least one exercise logged, dated by its first log.
  Uses `exercise_logs`, never the stale `plan_days.is_complete` / `pde.completed` flags.
- **Paying now** — a RevenueCat subscription, no comp override, status active or cancelled, period
  not yet ended. "Set to renew" = still active. Comped = COMPLIMENTARY override, unexpired.
  These are as of the moment the report runs (no history table).
- **Revenue / Money** — PRODUCTION RevenueCat webhook events only (SANDBOX is our own testing).
- **Real users** — excludes `@mastersfit.ai` (owner, demo, reviewer, QA, rtp+<n> tests),
  `@conradlabs.com`, reserved test domains, and anything in `SIGNUP_NOTIFY_SUPPRESS[_DOMAINS]`
  or `USAGE_REPORT_EXCLUDE` (comma-separated emails).

## Settings (Render env)

| Var | Default | Effect |
|---|---|---|
| `SIGNUP_NOTIFY_ENABLED` | — | Must be `true` (already is on prod) |
| `USAGE_REPORT_ENABLED` | on | `false` turns only this report off |
| `SIGNUP_NOTIFY_EMAIL` | rtp@mastersfit.ai | Recipients, comma-separated |
| `USAGE_REPORT_CRON` | `0 8 * * 1` | Send time, evaluated in `OWNER_TIMEZONE` |
| `OWNER_TIMEZONE` | America/Chicago | Week boundaries and dates |
| `USAGE_REPORT_EXCLUDE` | — | Extra emails to leave out |

## Verify

- Preview prints sane counts; spot-check one with `scripts/db-prod-read.sh`.
- Monday after 08:00 Central: the email `[MastersFit] Weekly usage, <week>: N trained` is in the
  owner inbox. Missing → check Render logs for `Usage report job` / `Failed to send usage report`.
