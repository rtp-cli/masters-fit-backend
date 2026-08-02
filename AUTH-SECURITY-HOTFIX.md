# Auth security hotfix — parallel work brief

**Status:** confirmed findings, not yet fixed. **Owner:** backend session (this repo).
**Do NOT touch the frontend repo or trigger any EAS/mobile build** — a separate session is
doing a frontend auth-flow redesign in parallel. Your job is backend-only.

## Why this exists (decoupling decision)

A passwordless-auth security review (by "Claude Design", cross-checked against source) found
three real vulnerabilities. All three are **backend** bugs. The frontend redesign cannot close
any of them — even after the app stops calling `check-email`, the endpoint is still live and
exploitable by `curl`. The backend deploys to **Render on merge to `main`** (auto-deploy), a
*different pipeline* from the frozen EAS mobile builds, so these fixes can and should ship
independently and sooner.

**Prod deploy (merge to main → Render) requires explicit user confirmation. Test locally first.**

## The three findings (all verified against source)

### #1 — SEV0/1: `check-email` mints a full session with no code. ✅ SHIPPED 2026-08-02.
> **DONE:** PR #18 (`fix/auth-check-email-hotfix`) merged to `main` → Render deployed.
> `check-email` now returns only existence/onboarding/waiver flags — no `token`, no
> `refreshToken`. FE traced read-only: shipped client only stored those tokens `if (token)`
> (now a no-op) and never persisted the user object, so nothing broke. Verified in prod:
> `check-email` returns no tokens; email→OTP→login still works.

- [src/routes/auth.routes.ts:11](src/routes/auth.routes.ts#L11) — `/check-email` is mounted with
  **no `expressAuthentication`** → fully public.
- [src/controllers/auth.controller.ts:76-105](src/controllers/auth.controller.ts#L76-L105) — for any
  existing email it signs a 7-day JWT `{id,email}` **and** mints a refresh token, returning both in
  the body. One request with a known address = full account takeover.
- Worse than `/verify`: the verify route strips `refreshToken` from its HTTP response
  ([auth.routes.ts:79-85](src/routes/auth.routes.ts#L79-L85)); `check-email` returns the raw
  controller object *including* `refreshToken` → persistent access.
- **Recommended fix:** `check-email` must return only existence/onboarding/waiver flags — no
  `token`, no `refreshToken`. The real session is minted at `/verify` after the OTP.
- **BLOCKER to check before shipping:** does the *currently shipped* app depend on those tokens?
  Trace `auth-context.checkEmail` in the **frontend** repo (read-only — do not edit it) to confirm
  stripping them won't break live users mid-login. If the shipped client treats the presence of a
  SecureStore token as "authenticated", we need a compatible rollout. Report findings before deploy.

### #2 — SEV1: verify code not bound to email + no rate limit.
- [src/services/auth.service.ts:46-60](src/services/auth.service.ts#L46-L60) — `getValidAuthCode`
  filters on `code + used=false + not-expired` only, **no email predicate**.
- Codes are 4-digit (`1000 + random*9000`, [auth.service.ts:122](src/services/auth.service.ts#L122))
  → 9000 values; no attempt cap anywhere on `/verify`.
- **Recommended fix:** bind lookup on `code + email`; add per-code attempt cap (expire after ~5
  failures); keep the short TTL. Requires `email` on the verify request (coordinate with FE).

### #3 — SEV2: account created before verification + `9876` bypass.
- [src/controllers/auth.controller.ts:173](src/controllers/auth.controller.ts#L173) — `signup` calls
  `createUser` immediately, unauthenticated → anyone can squat any email.
- [src/controllers/auth.controller.ts:432](src/controllers/auth.controller.ts#L432) — `authCode === "9876"`
  branch does `getValidAuthCode("9876")` with no email gate, so anyone submitting `9876` logs in as
  whatever test account currently holds it. And `9876` is **inside** the normal generator range
  (1000–9999), so ~1/9000 real logins mint `9876` legitimately and the bypass hands that real
  user's account to anyone who submits `9876`.
- Context: `9876` is the Apple-reviewer/test bypass, gated at *generation* time to
  `system_config.test_email` allowlisted addresses — but *verification* isn't email-gated, which is
  the bug. See the "Apple Reviewer Account" note; the bypass was always meant to be removed post-review.
- **Recommended fix:** move OTP-vs-token issuance so a user row isn't created until verification;
  remove the hardcoded `9876` constant (replace with the same allowlist check on *both* generate and
  verify, or drop it entirely if review is done).

## Batch 2 — SPEC §4/§5 hardening (BUILT + locally verified 2026-08-02, branch `feat/auth-hardening-batch`)

Implements the full SPEC (`SPEC.md`) backend scope beyond #1, backward-compatible so it can
deploy ahead of the new mobile build. **Not yet merged — awaiting user go-ahead + prod DB push.**

- **§4.2/4.3/4.4 (was #2):** `authService.verifyCode(code, email?)` — email-bound lookup with a
  per-code attempt cap (`auth_codes.attempts`, invalidate at 5) and distinct statuses. `verify`
  returns `errorCode` ∈ `INVALID_CODE | EXPIRED_CODE | CODE_EXHAUSTED` + `attemptsLeft`. **Soft**:
  when the client sends no `email` it falls back to the legacy code-only lookup (shipped client
  keeps working); Work E flips `email` to required and deletes the fallback.
- **§4.5 (was #3):** `9876` bypass is now **email-gated** on verify to `system_config.test_email`
  (keeps the Apple reviewer working; closes the take-any-account hole). Not deleted — see the
  Apple Reviewer note.
- **§4.6:** `login`/`signup`/`generateAuthCode` now return `success:false` on a send failure
  instead of swallowing it.
- **§4.7:** `login` no longer returns `userExists`/`needsOnboarding` (enumeration). Verified the
  shipped client ignores them.
- **§4.8:** `auth.middleware.ts` rejects `isOnboarding` tokens (401) on every guarded route and
  never sets `userId = NaN`; onboarding token lifetime `7d → 1h`.
- **§5 / Work C:** `signup` takes the request. **Authenticated path** (onboarding token) derives
  the email from the token, mints a real access+refresh session, sends no OTP. **Unauthenticated
  path** (shipped client) keeps create-user + send-OTP and returns **no tokens** — so it never
  mints a session for an anonymous caller. Route wiring passes `req` to `controller.signup`.

**DB:** adds `auth_codes.attempts integer not null default 0`. Pushed to **local** only. Prod Neon
push is pending (`/deploy-db`), must land with this code.

### ⚠️ Work E cutover gates (do NOT drop — gated on new-build adoption)
1. Make `email` **required** on `/verify`; delete the legacy code-only branch in `verifyCode`.
2. Delete the **unauthenticated** `signup` path (leave only the onboarding-token path).
3. Delete `/check-email` entirely (already returns no tokens since #1).
4. Re-evaluate the `9876` bypass once Apple review is done (delete vs keep email-gated).

## Suggested sequence
1. Trace the FE `auth-context.checkEmail` dependency (read-only) → decide if #1 is safe to strip.
2. Implement + locally test the #1 fix on a branch. Get user go-ahead → merge → Render.
3. Harden #2 and #3 (these change the verify contract → coordinate the request shape with the FE
   redesign session so client and server land together).

## Repo facts you'll need
- Run backend: `npm run dev`. Auth code is logged in dev (`NODE_ENV=development`).
- **Prod deploy = merge to `main`** (Render auto-deploys). No manual deploy step. Confirm with user.
- Prod DB (Neon) is the **commented** `DATABASE_URL` line in `.env`; active one is localhost. Override
  inline to query prod for troubleshooting — do not point local dev at prod.
- Frontend login flow for reference: `login-screen.tsx` calls `checkEmail` → `login` (sends OTP) →
  routes to `/verify`. Session should come from `/verify`, not `check-email`.
