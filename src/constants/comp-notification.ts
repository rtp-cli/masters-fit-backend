import { isProtectedEmail } from "@/constants/protected-accounts";
import { AccessTier } from "@/constants/access-policy";

/**
 * Whether granting a comp should also email the person.
 *
 * Pulled out of the ops script so the rules are testable in isolation — every
 * clause below exists because getting it wrong means an email nobody wanted, to
 * somebody who didn't expect it, about access that didn't change.
 */
export interface CompEmailDecision {
  /** The operator passed --no-email. */
  noEmail: boolean;
  /** This is a --revoke, not a grant. */
  revoke: boolean;
  /** Nothing is being written. */
  dryRun: boolean;
  /** access_override as it was BEFORE this run. */
  priorOverride: string | null;
  email: string | null | undefined;
}

export function shouldSendCompEmail(d: CompEmailDecision): boolean {
  // Explicit opt-out by the operator.
  if (d.noEmail) return false;

  // Never on revoke. "Your free access has been removed" is a message that
  // should require a human writing it deliberately, not a script side effect.
  if (d.revoke) return false;

  // A dry run writes nothing, so there is nothing to announce.
  if (d.dryRun) return false;

  // Only announce an actual CHANGE. Re-running comp on someone already comped
  // is a no-op, and mailing them a second "I've upgraded you" is confusing at
  // best — this is the guard that makes the script safe to re-run.
  if (d.priorOverride === AccessTier.COMPLIMENTARY) return false;

  if (!d.email || !d.email.trim()) return false;

  // The demo user, QA logins and the reviewer account get comped routinely as
  // part of ops. None of them is a person who wants a thank-you note.
  if (isProtectedEmail(d.email.trim().toLowerCase())) return false;

  return true;
}
