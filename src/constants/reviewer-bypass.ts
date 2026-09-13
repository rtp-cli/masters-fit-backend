/**
 * The app-store reviewer OTP bypass.
 *
 * App Review (Apple and Google) needs to sign in to a real account without
 * receiving mail. A fixed OTP for one allowlisted address is how that happens:
 * `systemConfigService.isTestEmail()` gates WHICH address may use it, and the
 * code below is WHAT they submit.
 *
 * The code used to be the literal `9876`, written into this repo — which is
 * public. That left the reviewer address as the only thing protecting the
 * account, and `rtp+review@mastersfit.ai` is guessable, so in practice the
 * account was protected by nothing. Rotating the address would not have helped:
 * the address is itself committed here, in PROTECTED_EMAILS.
 *
 * So the SECRET is now the code, held in Render and never in git. The address
 * can stay public. Both gates still apply — an attacker needs the allowlisted
 * address AND the code.
 *
 * Read from `process.env` at CALL time, not module load, matching
 * `signup-notifications.ts`: no stale capture, and tests can flip it without
 * re-importing.
 */

/**
 * The bypass code, or null when unset.
 *
 * FAILS CLOSED. No env var means no bypass — `isReviewerBypassCode()` returns
 * false for every input, including the old "9876", and the normal emailed-OTP
 * path handles everyone. That is the safe direction: a missing secret must not
 * silently reopen the hole this exists to close.
 *
 * Operationally that means REVIEWER_BYPASS_CODE must be set in Render BEFORE an
 * app-store review needs to sign in, or the reviewer cannot get in and the
 * submission is rejected for "unable to sign in".
 */
export function reviewerBypassCode(): string | null {
  const raw = process.env.REVIEWER_BYPASS_CODE?.trim();
  return raw ? raw : null;
}

/** Whether the bypass is configured at all. */
export function isReviewerBypassEnabled(): boolean {
  return reviewerBypassCode() !== null;
}

/**
 * Whether `submitted` is the configured bypass code.
 *
 * Compared with a length-independent constant-time scan so a timing signal
 * can't be used to recover the code character by character. Returns false when
 * the bypass is unconfigured, so callers need no separate enabled check.
 */
export function isReviewerBypassCode(submitted: string | undefined): boolean {
  const expected = reviewerBypassCode();
  if (!expected || !submitted) return false;

  // Compare every character of both strings regardless of mismatch position;
  // a plain === short-circuits on the first differing byte.
  let diff = submitted.length ^ expected.length;
  for (let i = 0; i < submitted.length; i++) {
    diff |= submitted.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }
  return diff === 0;
}
