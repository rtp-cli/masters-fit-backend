---
name: comp-user
description: Use to grant (or revoke) a COMPLIMENTARY subscription — free, no-paywall access — to one or more existing users by email. Triggers "/comp-user", "comp this user", "give X free access", "upgrade these testers to complimentary", "skip the paywall for Y", "revoke someone's comp". Writes to the LIVE db when run against prod, but is fully reversible with --revoke. For deleting a throwaway account use delete-user; for resetting the free-workout meter use reset-user-trial.
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
6. **A signed-in user may need to restart the app** (or hit any authed endpoint) for the new access
   tier to take effect client-side.

## Where it runs

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

Local is the default — the active `DATABASE_URL` in `backend/.env` is **local**; the prod Neon URL
is the **commented** line. Extract it inline for prod. **Note:** macOS/BSD `sed` has no `\s` — use
`[[:space:]]`, or the `# DATABASE_URL=` prefix silently stays on the value.

```bash
PROD_URL=$(grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL=' .env | head -1 \
  | sed -E 's/^[[:space:]]*#[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')
```

## The workflow (all three, in order)

### 1. Dry-run — resolve the emails, see current state
Takes any number of emails in one invocation. No writes.

```bash
# local
npm run comp-user -- a@example.com b@example.com --dry-run
# prod
DATABASE_URL="$PROD_URL" npm run comp-user -- a@example.com b@example.com --dry-run
```

Show the output to the user: one `user <id> (<email>)` + `current subscription row` per address,
then `would set access_override = COMPLIMENTARY`. Get sign-off.

### 2. Apply
```bash
DATABASE_URL="$PROD_URL" npm run comp-user -- a@example.com b@example.com
```
Expect `APPLYING`, the Neon host, and per user
`✅ applied: [ { userId: <n>, accessOverride: 'COMPLIMENTARY' } ]`.

### 3. Verify — read the rows back
```bash
DATABASE_URL="$PROD_URL" npx tsx src/scripts/diag-user-access.ts a@example.com b@example.com
```
Read-only. Confirm `"access_override":"COMPLIMENTARY"` and
`"access_override_expires_at":null` on each subscription row, and report that back — don't call it
done off the apply output alone.

## Revoking

```bash
# preview, then apply
DATABASE_URL="$PROD_URL" npm run comp-user -- a@example.com --revoke --dry-run
DATABASE_URL="$PROD_URL" npm run comp-user -- a@example.com --revoke
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
- **test-emails** (`add-test-emails.ts`) — the `9876` bypass-OTP allowlist, unrelated to access tier.
