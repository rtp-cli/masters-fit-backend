/**
 * Accounts that must NEVER be hard-deleted. Enforced in purgeUserData (the
 * single delete chokepoint), so BOTH the in-app Delete Account flow AND the
 * delete-user ops script are protected — in code, not just by skill guidance.
 *
 * Protection is keyed primarily on EMAIL because email is stable across
 * environments. Admin *ids* are NOT: local `.env` has ADMIN_USER_IDS=55,90
 * while prod is 3, so an id-only guard fails OPEN when the ops script runs with
 * a laptop's env against the prod DB. The admin-id check below is a secondary
 * layer that only helps within a correctly-configured environment (e.g. the
 * app on Render); the email list is the guarantee.
 */
export const PROTECTED_EMAILS: ReadonlySet<string> = new Set(
  [
    "rtp@mastersfit.ai", // OWNER / prod admin + main account
    "rtp+demo@mastersfit.ai", // marketing/demo user (Dave)
    "rtp+applereview@mastersfit.ai", // Apple reviewer login
    "rtp+qa@mastersfit.ai", // QA/test account
    // NOTE: rtp+<numbers>@mastersfit.ai are disposable test accounts — NOT protected.
    // Emails are stable across local & prod, so listing them here is what
    // actually protects the admin account from the ops-script-vs-prod path.
  ].map((e) => e.trim().toLowerCase())
);

export function isProtectedEmail(email: string | null | undefined): boolean {
  return !!email && PROTECTED_EMAILS.has(email.trim().toLowerCase());
}

// Mirrors authz.middleware.isAdminUserId (kept self-contained here to avoid a
// service import cycle). Fail-closed: unset env → nobody is admin.
function adminIds(): Set<number> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

/** True if this user is protected from hard deletion (by email OR admin id). */
export function isProtectedUser(userId: number, email: string | null | undefined): boolean {
  return isProtectedEmail(email) || adminIds().has(userId);
}
