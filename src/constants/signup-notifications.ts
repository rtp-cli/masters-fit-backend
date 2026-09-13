import { isProtectedEmail } from "@/constants/protected-accounts";

/**
 * Configuration for the two internal signup notifications:
 *
 *   1. New-user alert — one email the moment someone finishes onboarding.
 *   2. Stalled-signup digest — a daily list of people who signed up and never
 *      finished, sent ONLY on days when at least one new name joins the list.
 *
 * Both are internal ops mail to the owner, never to the user.
 *
 * Every value is read from `process.env` at CALL time, not module load. That
 * keeps the kill switch honest (no stale capture) and lets tests flip a setting
 * without re-importing the module.
 */

/** Where the notifications go when SIGNUP_NOTIFY_EMAIL isn't set. */
const DEFAULT_RECIPIENT = "rtp@mastersfit.ai";

/**
 * Master kill switch, checked before ANY work happens — including before the
 * first database read. Unset means off, so merging this code changes nothing
 * anywhere until the env var is deliberately set in Render.
 */
export function isSignupNotifyEnabled(): boolean {
  return process.env.SIGNUP_NOTIFY_ENABLED === "true";
}

/** Recipients for both emails. Comma-separated env, trimmed, empties dropped. */
export function signupNotifyRecipients(): string[] {
  const raw = process.env.SIGNUP_NOTIFY_EMAIL ?? DEFAULT_RECIPIENT;
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Internal accounts that must never generate a notification.
 *
 * The list is PROTECTED_EMAILS — the owner, the demo user Dave (reseeded by
 * cron every morning), and the QA/reviewer logins. That set already exists and
 * is already maintained for the delete guard, and it is exactly the set of
 * addresses that would otherwise produce recurring noise.
 *
 * Deliberately NOT a rule about the @mastersfit.ai domain: the disposable
 * rtp+<n>@mastersfit.ai accounts are how this feature gets tested, and a
 * domain-wide rule silently swallows those tests. PROTECTED_EMAILS says as much
 * in its own comment.
 *
 * Reserved test domains (RESERVED_EMAIL_DOMAINS) are suppressed too — those
 * cannot be a real person, so a hit is always our own test data.
 *
 * SIGNUP_NOTIFY_SUPPRESS handles anything ad hoc without a deploy, and
 * SIGNUP_NOTIFY_SUPPRESS_DOMAINS does the same for a whole domain.
 */
export function isSuppressedSignupEmail(email: string | null | undefined): boolean {
  if (!email) return true; // No address to judge → don't notify.

  const normalized = email.trim().toLowerCase();
  if (!normalized) return true;

  if (isProtectedEmail(normalized)) return true;

  if (hasSuppressedDomain(normalized)) return true;

  const envAccounts = [
    ...envList("TEST_ACCOUNT_NEW"),
    ...envList("TEST_ACCOUNT_EXISTING"),
    ...envList("SIGNUP_NOTIFY_SUPPRESS"),
  ];

  return envAccounts.includes(normalized);
}

/**
 * Domains that can never belong to a real person. RFC 2606 and RFC 6761
 * reserve them precisely so test fixtures can use an address that is
 * guaranteed never to route anywhere.
 *
 * This rule is what keeps our own test suite out of the ops mail. The
 * jobs-claim concurrency test creates `test-jobs-claim-<timestamp>@example.test`
 * users, and a run interrupted before its afterAll leaves them in the database.
 * Without this, every survivor is a brand-new name in the next digest — the
 * email arrives looking exactly like eight real people who stalled overnight,
 * which is how the one email whose job is triage becomes the one you ignore.
 * SIGNUP_NOTIFY_SUPPRESS cannot cover it: the local part is a fresh timestamp
 * on every run, so there is no fixed address to list.
 */
const RESERVED_EMAIL_DOMAINS = [
  "example.com",
  "example.net",
  "example.org",
  "test",
  "example",
  "invalid",
  "localhost",
  "local",
];

/**
 * Domains suppressed by configuration rather than by RFC.
 *
 * The case this exists for is the misspelling of our OWN domain. The digest has
 * carried eleven addresses on `mastersfit.air`, `mastersfit.ait`,
 * `mastetsfit.ai` and `masterafit.ai` — none of which resolve, so no human
 * being has ever received a code at one. They arrive in ones and twos over
 * months, and because the digest only sends on a day when a NEW name joins the
 * list, each fresh misspelling is not just a line of noise: it is the thing
 * that sends the email.
 *
 * Env-driven on purpose. A new way to fat-finger the domain turns up every few
 * weeks, and waiting on a deploy to silence one is how the list rots back to
 * being unreadable.
 *
 * NOTE the deliberate difference from the `@mastersfit.ai` domain rule that was
 * tried and removed: these domains cannot receive mail at all, so a suppression
 * here can never hide a real person. A rule on the REAL domain could, and did —
 * it silently ate the `rtp+<n>@mastersfit.ai` sim tests.
 */
function suppressedDomains(): string[] {
  return [...RESERVED_EMAIL_DOMAINS, ...envList("SIGNUP_NOTIFY_SUPPRESS_DOMAINS")];
}

/**
 * True when the address sits on a suppressed domain, or any subdomain of one
 * (`mail.example.com`, `db.docker.local`).
 */
function hasSuppressedDomain(normalized: string): boolean {
  // lastIndexOf: the local part may legally contain an "@" when quoted.
  const at = normalized.lastIndexOf("@");
  if (at === -1) return false;

  const domain = normalized.slice(at + 1);
  if (!domain) return false;

  return suppressedDomains().some(
    (suppressed) => domain === suppressed || domain.endsWith(`.${suppressed}`)
  );
}

/** Comma-separated env var -> lowercased, trimmed, non-empty entries. */
function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Grace period before a stalled signup appears in the digest. Someone who
 * signed up two hours ago is mid-onboarding, not stalled.
 */
export function stalledSignupMinHours(): number {
  return positiveNumber(process.env.STALLED_SIGNUP_MIN_HOURS, 24);
}

/**
 * How long a stalled signup keeps appearing.
 *
 * HARD-CLAMPED to 30 days regardless of the env override, because that is the
 * refresh-token TTL (refresh-token.service cleanupExpiredTokens deletes expired
 * rows): past it, a user who DID sign in has had the evidence purged and would
 * be confidently misreported as "account created, never signed in" — a wrong
 * triage claim in the one email whose job is triage.
 */
export function stalledSignupMaxDays(): number {
  return Math.min(positiveNumber(process.env.STALLED_SIGNUP_MAX_DAYS, 30), 30);
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
