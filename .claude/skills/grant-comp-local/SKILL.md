---
name: grant-comp-local
description: Use to grant a tester free / paywall-skip access on the LOCAL database — sets user_subscriptions.access_override=COMPLIMENTARY (no expiry) for one user by email, so they bypass the subscription paywall. Triggers "/grant-comp-local", "comp a tester", "give X free access locally", "skip the paywall for X", "make X complimentary". Defaults to a --dry-run preview first. For production use grant-comp-prod.
---

# Grant Complimentary Access — LOCAL

Grants **COMPLIMENTARY** access to a single user by email so they skip the subscription paywall
(no expiry). It sets `user_subscriptions.access_override = COMPLIMENTARY` on that user's existing
subscription row — nothing else on the account is touched.

Backed by `src/scripts/grant-comp-single.ts`.

**Scoped + safe:** only the one user you name is affected. The default `DATABASE_URL` in
`backend/.env` is **local**, so this skill runs against your local DB. To comp someone on the
live database, use the separate **grant-comp-prod** skill.

## The one gotcha — "no subscription row yet"

`access_override` lives on `user_subscriptions`, and a user has **no row there until they've
opened the app at least once**. If you comp an email that has never launched the app, the UPDATE
matches nothing — the script prints a `⚠️ No user_subscriptions row` warning and no-ops. Have
them open the app once (any screen), then re-run. This is the #1 "it didn't work" reason.

All commands run from the backend repo:

```bash
cd /Users/richpusateri/Projects/MastersFit/backend
```

## Grant

Always preview first, then apply:

```bash
# Preview — writes nothing; shows the current subscription row:
npx tsx src/scripts/grant-comp-single.ts <email> --dry-run

# Apply:
npx tsx src/scripts/grant-comp-single.ts <email>
```

Expect a `db host: localhost` line, the resolved `user <id> (<email>)`, the current subscription
row, and on apply a `✅ applied:` line showing `accessOverride: COMPLIMENTARY`. If it prints
`no user for <email>`, the email isn't registered yet (they need to sign up). If it prints the
`⚠️ No user_subscriptions row` warning, see the gotcha above.

## Verify

1. The script prints `✅ applied:` with `accessOverride: COMPLIMENTARY`.
2. Optional DB check:
   ```bash
   psql "$DATABASE_URL" -c "select u.email, s.status, s.access_override
     from users u join user_subscriptions s on s.user_id = u.id
     where u.email = '<email>';"
   ```
3. In the app, that account should now reach gated features without hitting the paywall (reload
   the JS bundle if it was already open — access is resolved server-side but the client caches it
   for the session).

## Related

- **grant-comp-prod** — the same grant against production (Neon).
- **reset-user-trial** — un-block generation (trial usage) rather than comp full access.
- **comp-a-tester** memory note — background on the COMPLIMENTARY override + the app-first gotcha.
