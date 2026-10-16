import { signUnsubscribeToken } from "@/utils/email-token";

/**
 * Public links that appear inside customer emails.
 *
 * Read from `process.env` at CALL time (same convention as the nudge configs),
 * so tests and scripts can override without re-importing.
 */

/**
 * The unsubscribe page on the website. It is BOTH the visible footer link and
 * the one-click `List-Unsubscribe` target: the website's /unsubscribe function
 * (mastersfit-website-next, api/unsubscribe.js) forwards the token to this
 * API's POST /api/email-preferences/unsubscribe, which stays the one place a
 * token is verified. The API's own GET/POST routes keep working unchanged for
 * every email already sent with the old onrender.com link.
 */
export function unsubscribePageUrl(): string {
  return (
    process.env.UNSUBSCRIBE_PAGE_URL || "https://www.mastersfit.ai/unsubscribe"
  ).replace(/\/$/, "");
}

/** The signed unsubscribe link for one user. Throws when no signing secret is set. */
export function unsubscribeUrlFor(userId: number): string {
  return `${unsubscribePageUrl()}?token=${encodeURIComponent(
    signUnsubscribeToken(userId),
  )}`;
}

/**
 * Headers for commercial mail. Gmail and Yahoo require one-click unsubscribe
 * (RFC 8058) on bulk mail; without it they are entitled to treat the send as
 * spam no matter how good the footer link is. One https URL only — the header
 * must not mix targets.
 */
export function listUnsubscribeHeaders(
  unsubscribeUrl: string,
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
