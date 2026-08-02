---
name: grant-comp-prod
description: Use to grant a tester free / paywall-skip access on PRODUCTION (Neon) — sets user_subscriptions.access_override=COMPLIMENTARY (no expiry) for one real user by email so they bypass the subscription paywall on the live app. Triggers "/grant-comp-prod", "comp a tester on prod", "give X free access in production", "skip the paywall for X on prod". Writes to the LIVE db — confirm the email first, and always --dry-run before applying. For local use grant-comp-local.
---

# Grant Complimentary Access — PRODUCTION (Neon)

Same grant as **grant-comp-local**, but against the **live production database**. It sets
`user_subscriptions.access_override = COMPLIMENTARY` (no expiry) on one real user's subscription
row so they skip the paywall on the production app. Nothing else on the account is touched.

Backed by `src/scripts/grant-comp-single.ts`, run against the prod Neon `DATABASE_URL`.

> ⚠️ **This writes to production** — it changes a real customer's access. Only run when the user
> explicitly asks to comp someone on prod, **confirm the exact email first**, and **always
> `--dry-run` before applying**. The effect is reversible (clear `access_override` back to NULL),
> but treat it as a real prod change.

## The one gotcha — "no subscription row yet"

`access_override` lives on `user_subscriptions`, and a user has **no row there until they've
opened the app at least once**. If you comp an email that has never launched the app, the UPDATE
matches nothing — the script prints a `⚠️ No user_subscriptions row` warning and no-ops. Have
them open the production app once, then re-run. This is the #1 "it didn't work" reason.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

## Grant (prod)

The active `DATABASE_URL` in `backend/.env` is **local**; the prod Neon URL is the **commented**
line in that file. Extract it inline. **Note:** macOS/BSD `sed` does NOT support `\s` — use
`[[:space:]]`, or the `# DATABASE_URL=` prefix silently stays on the value and `new URL()` throws
"Invalid URL". Confirm the host looks like `*.neon.tech` before applying.

```bash
PROD_URL=$(grep -E '^[[:space:]]*#[[:space:]]*DATABASE_URL=' .env | head -1 \
  | sed -E 's/^[[:space:]]*#[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')

# 1. ALWAYS preview against prod first — writes nothing, shows the current row:
DATABASE_URL="$PROD_URL" npx tsx src/scripts/grant-comp-single.ts <email> --dry-run

# 2. Then apply:
DATABASE_URL="$PROD_URL" npx tsx src/scripts/grant-comp-single.ts <email>
```

Expect a `db host: <...>.neon.tech` line (confirm it's Neon, not localhost), the resolved
`user <id> (<email>)`, the current subscription row, and on apply a `✅ applied:` line showing
`accessOverride: COMPLIMENTARY`. If it prints `no user for <email>`, the email isn't registered
in prod. If it prints the `⚠️ No user_subscriptions row` warning, see the gotcha above.

## Verify

1. The script prints `✅ applied:` with `accessOverride: COMPLIMENTARY`.
2. DB check against prod:
   ```bash
   psql "$PROD_URL" -c "select u.email, s.status, s.access_override
     from users u join user_subscriptions s on s.user_id = u.id
     where u.email = '<email>';"
   ```
3. On their device (production app), that account should now reach gated features without the
   paywall. Access is resolved server-side, so no rebuild is needed — they may need to reload /
   relaunch the app to pick up the change if it was already open.

## Related

- **grant-comp-local** — the same grant against the local DB (the default; use that unless you
  specifically need prod).
- **reset-user-trial** — un-block generation (trial usage) rather than comp full access.
- **comp-a-tester** memory note — background on the COMPLIMENTARY override + the app-first gotcha.
