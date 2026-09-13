import { isProtectedEmail } from "@/constants/protected-accounts";

/**
 * Configuration for the onboarding nudge — one email to someone who created an
 * account and never finished setting up their profile.
 *
 * This is the first USER-FACING lifecycle email in the codebase. The two signup
 * notifications next door are internal ops mail to the owner; this one lands in
 * a customer's inbox. That difference is the reason for the two things internal
 * mail never needed: a working unsubscribe, and a postal address.
 *
 * Every value is read from `process.env` at CALL time, not module load — same
 * reason as signup-notifications: an honest kill switch, and tests can flip a
 * setting without re-importing the module.
 */

/**
 * Master kill switch, checked before ANY work happens — including before the
 * first database read. Unset means off, so merging this code mails nobody until
 * the env var is deliberately set in Render.
 */
export function isOnboardingNudgeEnabled(): boolean {
  return process.env.ONBOARDING_NUDGE_ENABLED === "true";
}

/**
 * Grace period before someone counts as stalled. Somebody who signed up three
 * hours ago is mid-onboarding, not stuck — and a nudge that arrives while the
 * app is still open reads as surveillance, not help.
 */
export function onboardingNudgeMinHours(): number {
  return positiveNumber(process.env.ONBOARDING_NUDGE_MIN_HOURS, 48);
}

/**
 * How far back the scan looks.
 *
 * This exists to stop the FIRST run in any environment from mass-mailing every
 * stalled signup in history the moment the flag is switched on. Someone who
 * abandoned setup five weeks ago has moved on; emailing them out of nowhere is
 * a spam complaint, not a re-engagement. Clamped to 30 days regardless of the
 * override for that reason.
 */
export function onboardingNudgeMaxDays(): number {
  return Math.min(positiveNumber(process.env.ONBOARDING_NUDGE_MAX_DAYS, 14), 30);
}

/**
 * Postal address for the CAN-SPAM footer.
 *
 * REQUIRED. Commercial email must carry a valid physical address, and there is
 * no sensible default to fall back on — a wrong address is worse than no email.
 * Unset returns null and the job refuses to send, which is deliberate: the
 * compliance check lives in code rather than in someone's memory.
 */
export function companyPostalAddress(): string | null {
  const raw = process.env.COMPANY_POSTAL_ADDRESS?.trim();
  return raw ? raw : null;
}

/**
 * Where the "Finish setting up" button points.
 *
 * NOT a `masters-fit://` deep link: the app registers the custom scheme but has
 * no associated domains, and mail clients (Gmail's especially) strip or refuse
 * to linkify custom schemes. This points at a web page that attempts the deep
 * link and falls back to the store.
 */
export function onboardingContinueUrl(): string {
  return (
    process.env.ONBOARDING_CONTINUE_URL || "https://www.mastersfit.ai/continue"
  ).replace(/\/$/, "");
}

/**
 * Public origin of THIS api, used to build the unsubscribe link. The default is
 * the Render host the app already talks to; set the env var if a prettier
 * domain ever fronts it, since this URL is visible in every nudge.
 */
export function publicApiUrl(): string {
  return (
    process.env.PUBLIC_API_URL || "https://masters-fit-backend.onrender.com"
  ).replace(/\/$/, "");
}

/**
 * Who must never receive a nudge.
 *
 * Reuses the signup-notification suppression set (PROTECTED_EMAILS: the owner,
 * the demo user Dave reseeded nightly, the QA and reviewer logins) plus the same
 * ad-hoc env list, so one place governs "don't mail this account" for every
 * email feature. ONBOARDING_NUDGE_SUPPRESS adds to it without a deploy.
 */
export function isSuppressedNudgeEmail(email: string | null | undefined): boolean {
  if (!email) return true; // No address to judge → don't send.

  const normalized = email.trim().toLowerCase();
  if (!normalized) return true;

  if (isProtectedEmail(normalized)) return true;

  const envAccounts = [
    ...envList("TEST_ACCOUNT_NEW"),
    ...envList("TEST_ACCOUNT_EXISTING"),
    ...envList("SIGNUP_NOTIFY_SUPPRESS"),
    ...envList("ONBOARDING_NUDGE_SUPPRESS"),
  ];

  return envAccounts.includes(normalized);
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
