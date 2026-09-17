import { isProtectedEmail } from "@/constants/protected-accounts";

/**
 * Configuration for the activation nudge — one email to someone who finished
 * onboarding, got a plan generated, and never started it.
 *
 * Why this exists alongside the onboarding nudge: the onboarding nudge targets
 * `users.needs_onboarding = true`, and on production that set is EMPTY (0 of
 * 25 accounts). It was built for a drop-off that does not happen. The real one
 * is one step later -- 21 of 21 users get a plan, 9 have ever logged an
 * exercise -- and nothing currently reaches those people.
 *
 * Same conventions as onboarding-nudge.ts, for the same reasons: every value is
 * read from `process.env` at CALL time so the kill switch is honest and tests
 * can flip a setting without re-importing.
 */

/**
 * Master kill switch, checked before ANY work happens — including before the
 * first database read. Unset means off, so merging this code mails nobody until
 * the env var is deliberately set in Render.
 */
export function isActivationNudgeEnabled(): boolean {
  return process.env.ACTIVATION_NUDGE_ENABLED === "true";
}

/**
 * How long after their first plan someone counts as stalled.
 *
 * 24h, not the onboarding nudge's 48h, and the difference is evidenced: of the
 * 9 users who ever activated, 6 did so within 22 hours of their plan being
 * generated (3 of those within the hour). A 48-hour window would arrive after
 * the moment had passed for two thirds of the people it could still reach.
 */
export function activationNudgeMinHours(): number {
  return positiveNumber(process.env.ACTIVATION_NUDGE_MIN_HOURS, 24);
}

/**
 * How far back the scan looks.
 *
 * Stops the FIRST run after the flag is switched on from mass-mailing every
 * never-activated account in history. Someone whose plan is five weeks old has
 * moved on; that email is a spam complaint, not a re-engagement. Clamped to 30
 * days regardless of the override, matching the onboarding nudge.
 */
export function activationNudgeMaxDays(): number {
  return Math.min(positiveNumber(process.env.ACTIVATION_NUDGE_MAX_DAYS, 14), 30);
}

/**
 * Postal address for the CAN-SPAM footer.
 *
 * REQUIRED, and shared with the onboarding nudge. Commercial email must carry a
 * valid physical address and there is no safe default — a wrong address is
 * worse than no email. Unset returns null and the job refuses to send, so the
 * compliance check lives in code rather than in someone's memory.
 */
export function companyPostalAddress(): string | null {
  const raw = process.env.COMPANY_POSTAL_ADDRESS?.trim();
  return raw ? raw : null;
}

/**
 * Where the "Start your first workout" button points.
 *
 * NOT a `masters-fit://` deep link — the app registers the custom scheme but
 * has no associated domains, and mail clients (Gmail especially) strip or
 * refuse to linkify custom schemes. This points at a web page that attempts the
 * deep link and falls back to the store.
 */
export function activationStartUrl(): string {
  return (
    process.env.ACTIVATION_START_URL || "https://www.mastersfit.ai/continue"
  ).replace(/\/$/, "");
}

/** Public origin of this API, used to build the unsubscribe link. */
export function publicApiUrl(): string {
  return (
    process.env.PUBLIC_API_URL || "https://masters-fit-backend.onrender.com"
  ).replace(/\/$/, "");
}

/**
 * Who must never receive a nudge.
 *
 * Reuses the same suppression set as every other email feature (the owner, the
 * nightly-reseeded demo user, QA and reviewer logins), plus the shared env
 * lists, plus its own ACTIVATION_NUDGE_SUPPRESS for adding an address without a
 * deploy. One place governs "don't mail this account".
 */
export function isSuppressedNudgeEmail(
  email: string | null | undefined
): boolean {
  if (!email) return true; // No address to judge → don't send.

  const normalized = email.trim().toLowerCase();
  if (!normalized) return true;

  if (isProtectedEmail(normalized)) return true;

  // Internal plus-addressed test accounts (rtp+qa01@, rtp+qatester01@, and
  // every future one) must never get customer lifecycle mail.
  //
  // PROTECTED_EMAILS deliberately does NOT cover these — it answers "never hard
  // delete", and a disposable test account SHOULD be deletable. But "safe to
  // delete" and "safe to email" are different questions, and reusing one list
  // for both silently opts every throwaway account into a real customer email.
  // Verified against the local database: rtp+qa01@ and rtp+qatester01@ both
  // passed suppression and appeared as live nudge candidates.
  if (isInternalTestAddress(normalized)) return true;

  const envAccounts = [
    ...envList("TEST_ACCOUNT_NEW"),
    ...envList("TEST_ACCOUNT_EXISTING"),
    ...envList("SIGNUP_NOTIFY_SUPPRESS"),
    ...envList("ONBOARDING_NUDGE_SUPPRESS"),
    ...envList("ACTIVATION_NUDGE_SUPPRESS"),
  ];

  return envAccounts.includes(normalized);
}

/**
 * Any plus-addressed variant of the owner's own mailbox, e.g.
 * `rtp+anything@mastersfit.ai`. These are all internal by construction — the
 * owner's address is `rtp@mastersfit.ai` and everything after the `+` is his
 * own tagging, so none of them is a real customer.
 */
function isInternalTestAddress(normalized: string): boolean {
  return /^rtp\+[^@]*@mastersfit\.ai$/.test(normalized);
}

/** Comma-separated env var -> lowercased, trimmed, non-empty entries. */
function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
