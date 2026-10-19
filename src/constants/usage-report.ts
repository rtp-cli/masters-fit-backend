import {
  isSignupNotifyEnabled,
  isSuppressedSignupEmail,
} from "@/constants/signup-notifications";

/**
 * Configuration for the weekly usage report — an internal email to the owner
 * summarising the last full Monday–Sunday week against the week before.
 *
 * Like the signup notifications, every value is read from `process.env` at CALL
 * time so the kill switch is honest and tests can flip settings freely.
 */

/**
 * On whenever the internal owner notifications are on (SIGNUP_NOTIFY_ENABLED),
 * so merging this needs no new Render setting. USAGE_REPORT_ENABLED=false turns
 * the report off on its own without silencing the signup and purchase alerts.
 */
export function isUsageReportEnabled(): boolean {
  if (process.env.USAGE_REPORT_ENABLED === "false") return false;
  return isSignupNotifyEnabled();
}

/**
 * Monday 08:00 in the owner's timezone. Bull evaluates the cron in
 * USAGE_REPORT_TZ, so the send time doesn't drift an hour at each DST change.
 */
export function usageReportCron(): string {
  return process.env.USAGE_REPORT_CRON || "0 8 * * 1";
}

/** The week boundaries and every date in the email are in this timezone. */
export function usageReportTimezone(): string {
  return process.env.OWNER_TIMEZONE || "America/Chicago";
}

/**
 * Domains whose accounts are ours, not customers'. The owner, the demo user,
 * the reviewer and QA logins, and the disposable rtp+<n> sim-test accounts all
 * live on @mastersfit.ai; the dev team signs in from @conradlabs.com.
 *
 * Deliberately broader than isSuppressedSignupEmail, which keeps rtp+<n>
 * accounts VISIBLE so signup alerts can be tested. A usage report has the
 * opposite need: seeded test accounts carry hundreds of logs each, and counting
 * them makes every activation number wrong.
 */
const INTERNAL_DOMAINS = ["mastersfit.ai", "conradlabs.com"];

/** True for an account that must not be counted as a real user. */
export function isInternalAccount(email: string | null | undefined): boolean {
  if (isSuppressedSignupEmail(email)) return true;

  const normalized = (email ?? "").trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (
    INTERNAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
  ) {
    return true;
  }

  return envList("USAGE_REPORT_EXCLUDE").includes(normalized);
}

/** Comma-separated env var -> lowercased, trimmed, non-empty entries. */
function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
