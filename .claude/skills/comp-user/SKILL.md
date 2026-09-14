---
name: comp-user
description: Use to grant (or revoke) a COMPLIMENTARY subscription — free, no-paywall access — to one or more existing users by email. Triggers "/comp-user", "comp this user", "give X free access", "upgrade these testers to complimentary", "skip the paywall for Y", "revoke someone's comp". A first-time grant also EMAILS the user a short personal note from Rich (--no-email to comp silently). Writes to the LIVE db when run against prod, but is fully reversible with --revoke. For deleting a throwaway account use delete-user; for resetting the free-workout meter use reset-user-trial.
---

# Comp a User — grant complimentary (free) access

Sets `user_subscriptions.access_override = 'COMPLIMENTARY'` (no expiry) so the account bypasses
the paywall and the lifetime-FREE `ai_operations` meter entirely. Backed by
`src/scripts/grant-comp-single.ts`, with a read-only view of the result in
`src/scripts/diag-user-access.ts`.

This is the right tool for friends-and-family, beta testers, comped customers, and podcast/demo
guests — anyone who should use the real app for free without a store purchase.

> ✅ **Reversible.** Unlike `delete-user`, a comp is a single nullable column. `--revoke` puts it
> back to `NULL` and the account falls back to whatever its real subscription/trial state says.

## Guardrails

1. **Only comp emails the user named explicitly.** Never infer targets from "the new signups" —
   list who you found and get an explicit go on each address.
2. **Always `--dry-run` first** and show the user the resolved `id` + current subscription row per
   email. A row that already shows `accessOverride: 'COMPLIMENTARY'` is a no-op — say so instead
   of re-applying silently.
3. **On prod, name the Neon host back to the user** from the dry-run output before applying.
4. **The account must have opened the app at least once.** The subscription row is created lazily
   on first load; with no row the `UPDATE` matches nothing. The script detects this and prints
   `⚠️  No user_subscriptions row` — that is *not* success. Ask them to launch the app, re-run.
5. **Comping does not retroactively refund a real purchase.** If the row shows an active paid
   subscription (`status: 'active'` with a `plan_id`), flag that to the user before comping — they
   probably want a store-side refund, not an override.
6. **A signed-in user must fully restart the app** for the new tier to take effect client-side.
   `useEntitlements` (frontend) refetches only on mount and on a RevenueCat customer-info event —
   and a comp is a backend column change, so RevenueCat never fires. Backgrounding and returning
   is NOT reliably enough; a close-and-relaunch is. The email says exactly this.

7. **A first-time grant emails the user.** Short personal note from Rich: you're on MastersFit+,
   nothing to do, restart the app. It is TRANSACTIONAL (reports a change to their own account), so
   it carries no unsubscribe link and deliberately ignores `email_opted_out_at`. It does NOT send
   on `--revoke`, on `--dry-run`, on a re-run of someone already `COMPLIMENTARY`, or to protected
   internal accounts — see `shouldSendCompEmail` in `src/constants/comp-notification.ts`. Pass
   `--no-email` to comp silently. **The email never gates the comp:** access is granted first, and
   a send failure prints `COMP APPLIED, but the email ... failed` rather than failing the run.
   Every lifecycle send is Bcc'd to the owner address (`lifecycleBcc` in `email.service.ts`), so a
   copy landing in Rich's inbox is the real proof it went out.

8. **The email is sent by YOUR CHECKOUT, not by Render.** `assertCheckoutIsCurrent`
   (`src/scripts/lib/checkout-freshness.ts`) fetches `origin/main` and **refuses to run** — exit 1,
   before any write or send — if HEAD is behind, naming the missing commits. So `git pull` before
   comping anyone; a deploy to Render does nothing for this script. It only warns (and continues)
   on `--dry-run`, and where git can't answer (no repo, offline, no `origin/main`). `--stale-ok`
   overrides it everywhere — use that only when you deliberately mean to run the old code.
   This guard exists because on 2026-09-14 a comp email went out missing its just-shipped owner
   Bcc: the send looked perfectly successful, it was simply the previous commit's code.

## Where it runs

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
git pull        # required — the comp email ships from this checkout (guardrail 8)
```

Local is the default. For prod, **never handle the connection string yourself** — no `grep`ing it
out of `.env`, no pasting it into a command. Prefix the command with `scripts/with-prod-url.sh`,
which injects `DATABASE_URL` from the macOS Keychain into the child process only. It prints the
target host, never the credential.


## The workflow (all three, in order)

### 1. Dry-run — resolve the emails, see current state
Takes any number of emails in one invocation. No writes.

```bash
# local
npm run comp-user -- a@example.com b@example.com --dry-run
# prod
scripts/with-prod-url.sh npm run comp-user -- a@example.com b@example.com --dry-run
```

Show the output to the user: one `user <id> (<email>)` + `current subscription row` per address,
then `would set access_override = COMPLIMENTARY`. Get sign-off.

### 2. Apply
```bash
scripts/with-prod-url.sh npm run comp-user -- a@example.com b@example.com
```
Expect `APPLYING`, the Neon host, and per user
`✅ applied: [ { userId: <n>, accessOverride: 'COMPLIMENTARY' } ]`.

### 3. Verify — read the rows back
```bash
scripts/with-prod-url.sh npx tsx src/scripts/diag-user-access.ts a@example.com b@example.com
```
Read-only. Confirm `"access_override":"COMPLIMENTARY"` and
`"access_override_expires_at":null` on each subscription row, and report that back — don't call it
done off the apply output alone.

## Revoking

```bash
# preview, then apply
scripts/with-prod-url.sh npm run comp-user -- a@example.com --revoke --dry-run
scripts/with-prod-url.sh npm run comp-user -- a@example.com --revoke
```
Sets `access_override` back to `NULL`. The account reverts to its real trial/paid state — it does
**not** delete anything they created while comped.

## Notes on the access model

- `AccessTier.COMPLIMENTARY` lives in `src/constants/access-policy.ts`; the column pair is
  `access_override` / `access_override_expires_at` on `user_subscriptions`.
- This script deliberately grants **no expiry** (`expires_at = NULL`) — a permanent comp. For a
  time-boxed grant, set the expiry column directly; the script doesn't expose it.
- The override sits *above* `status` — a comped user can still show `status: 'trial'`, and that's
  fine. Access is decided by the override.

## Related

- **delete-user** — hard-delete a throwaway account (irreversible).
- **reset-user-trial** (`reset-user-trial.ts`) — clear the free-workout meter instead of comping.
- **diag-user-access** — read-only "what happens if they log in right now?".
- **test-emails** (`add-test-emails.ts`) — the reviewer OTP-bypass allowlist (the code itself is
  `REVIEWER_BYPASS_CODE` in Render, no longer the old hardcoded `9876`). Unrelated to access tier.
