import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, non-expiring tokens for one-click links in outbound email.
 *
 * Today that means unsubscribe. The signature is what stops the obvious abuse:
 * without it the link is `?user=148` and anyone can unsubscribe anyone, or walk
 * the id space and opt out the whole table.
 *
 * Deliberately NOT a JWT and deliberately NOT expiring. An unsubscribe link has
 * to work the day someone finds the email in a folder two years from now — an
 * expired opt-out link is a compliance failure, not a security win. There is
 * nothing sensitive in the payload and the action it authorizes (stop mailing
 * me) is one nobody needs protecting from.
 */

/** Same fallback shape as share.service's preview secret. */
function secret(): string {
  return process.env.EMAIL_TOKEN_SECRET || process.env.JWT_SECRET || "";
}

const PURPOSE_UNSUBSCRIBE = "unsub";

function sign(purpose: string, userId: number, key: string): string {
  return createHmac("sha256", key)
    .update(`${purpose}:${userId}`)
    .digest("base64url");
}

/**
 * Build the token for an unsubscribe link. Throws when no secret is configured
 * rather than emitting an unsigned link that would accept anything.
 */
export function signUnsubscribeToken(userId: number): string {
  const key = secret();
  if (!key) {
    throw new Error(
      "EMAIL_TOKEN_SECRET (or JWT_SECRET) must be set to sign unsubscribe links"
    );
  }
  return `${userId}.${sign(PURPOSE_UNSUBSCRIBE, userId, key)}`;
}

/**
 * Verify a token and return the user id it authorizes, or null.
 *
 * Returns null for every failure mode — malformed, unknown shape, bad
 * signature, missing secret — so callers have exactly one branch to handle and
 * nothing distinguishes "wrong signature" from "wrong format" to a prober.
 */
export function verifyUnsubscribeToken(token: string | undefined): number | null {
  const key = secret();
  if (!key || !token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = Number(token.slice(0, separator));
  const provided = token.slice(separator + 1);
  if (!Number.isInteger(userId) || userId <= 0 || !provided) return null;

  const expected = sign(PURPOSE_UNSUBSCRIBE, userId, key);

  // Length must match before timingSafeEqual, which throws on a length
  // mismatch rather than returning false.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? userId : null;
}
