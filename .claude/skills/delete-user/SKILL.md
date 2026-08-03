---
name: delete-user
description: Use to HARD-DELETE a user account and all of its data from the database by email — the throwaway/demo/reviewer accounts left over after a demo, dry-run, or test cycle. Triggers "/delete-user", "delete this test account", "clean up the demo accounts", "remove user X from the DB", "purge that throwaway account". IRREVERSIBLE and writes to the LIVE db when run against prod — always preflight + dry-run + confirm the exact emails first, and NEVER delete a real customer or a protected account. For rewinding one workout day use reset-workout-*; for rebuilding the marketing demo user use reseed-dave-*.
---

# Delete User — hard delete an account + all its data

Permanently removes one or more users (by email) and every row they own, in the tested
teardown order, wrapped in a **transaction** so any unexpected foreign key rolls the whole
thing back instead of leaving orphans. Backed by `src/scripts/delete-users.ts`, with a
read-only impact preview in `src/scripts/preflight-user-fk.ts`.

> ⛔ **This is irreversible.** Unlike `reset-workout-*` (recoverable by re-logging) or
> `reseed-dave-*` (recreates the user), a delete is **gone** — there is no undo, and on prod
> the row is gone from the live Neon database. Treat every prod run as a one-way door.

## Non-negotiable guardrails

1. **Only delete accounts the user has named explicitly and unambiguously.** Never infer a
   target. If the request is vague ("clean up the test accounts"), list the candidates you
   found and get an explicit go on each email.
2. **Protected accounts — refuse unless the user overrides in the same breath, twice:**
   - `rtp+demo@mastersfit.ai` — Dave, the marketing/demo user (use `reseed-dave-*` instead)
   - `rtp+applereview@mastersfit.ai` — Apple reviewer login
   - `rtp+qa@mastersfit.ai` — the QA/test account
   - **prod admin ids** (e.g. prod id `3` — see `ADMIN_USER_IDS`)
   - **any real customer.** If an email doesn't look like a `rtp+…@mastersfit.ai` throwaway,
     stop and confirm it's genuinely disposable before going near it.
3. **Always run the two read-only steps first** (preflight, then `--dry-run`) and **show the
   user the exact ids + workout counts** that would be deleted. Only apply after they confirm.
4. **On prod, name the Neon host back to the user** from the dry-run output before applying.
5. Deleting a currently-active user is fine data-wise, but their app session will 401 on the
   next request — expected.

## Where it runs

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

Local is the default. The active `DATABASE_URL` in `backend/.env` is **local**; the prod Neon
URL is the **commented** line. Extract it inline for prod. **Note:** macOS/BSD `sed` does not
support `\s` — use `[[:space:]]`, or the `# DATABASE_URL=` prefix silently stays on the value.

```bash
PROD_URL=$(grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL=' .env | head -1 \
  | sed -E 's/^[[:space:]]*#[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')
```

## The safe workflow (do all four, in order)

### 1. Preflight (read-only) — know the full blast radius
Enumerates every table with a foreign key to `users(id)` and each FK's `ON DELETE` rule, and
resolves the emails to ids. If a new `NO ACTION` table has been added to the schema since this
script was written, it shows up here — add it to the teardown in `delete-users.ts` before you
proceed.

```bash
# local
npm run preflight-user-fk -- test-a@example.com test-b@example.com
# prod
DATABASE_URL="$PROD_URL" npm run preflight-user-fk -- test-a@example.com
```

### 2. Dry-run — confirm exactly who/what would go
Prints each resolved account (`id`, workout count) and `WOULD DELETE`, and skips any email not
found. **No writes.** Show this output to the user and get explicit sign-off.

```bash
# local
npm run delete-user -- test-a@example.com --dry-run
# prod
DATABASE_URL="$PROD_URL" npm run delete-user -- test-a@example.com --dry-run
```

### 3. Apply — the real, transactional delete
```bash
# local
npm run delete-user -- test-a@example.com
# prod  (irreversible — you have the user's explicit go and named the Neon host)
DATABASE_URL="$PROD_URL" npm run delete-user -- test-a@example.com
```
Expect `APPLYING`, the Neon host, and a `✓ deleted id=<n> and all associated data` per account.

### 4. Verify — prove it's gone
Re-run the preflight; a deleted account reports `target users (0/1)` + `NOT FOUND`.

```bash
DATABASE_URL="$PROD_URL" npm run preflight-user-fk -- test-a@example.com
```

## What gets deleted

The full ownership graph, children first: exercise set/exercise/day/workout/block logs →
plan-day exercises, blocks, plan days → share links, ai_operations, background_jobs, workouts
→ app_feedback, plan_day_feedback, trial_usage, subscriptions, profile, prompts,
impersonation_audit → the `users` row. FK-`CASCADE` tables (`refresh_tokens`,
`llm_generation_logs`, `exercise_exclusions`, …) are cleaned up automatically by the final
`users` delete. Everything runs in one transaction — all or nothing.

## Related

- **reset-workout-prod / -local** — rewind ONE workout day (recoverable), not a delete.
- **reseed-dave-prod / -local** — delete + recreate the marketing demo user Dave.
- **comp-user** (`grant-comp-single.ts`) — grant complimentary access instead of deleting.
- **test-emails** (`add-test-emails.ts`) — add/remove the `9876` OTP allowlist.
