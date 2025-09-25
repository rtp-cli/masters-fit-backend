/**
 * Waiver version constants
 *
 * IMPORTANT: When updating the waiver version:
 * 1. Update CURRENT_WAIVER_VERSION constant
 * 2. Update frontend constant to match
 * 3. All users will be prompted to re-accept the waiver
 * 4. Consider legal review before deployment
 */
export const CURRENT_WAIVER_VERSION = "1.0";

/**
 * Check if user has accepted the current waiver version
 */
export function hasAcceptedCurrentWaiver(user: {
  waiverAcceptedAt: Date | null;
  waiverVersion: string | null;
}): boolean {
  // No waiver acceptance recorded
  if (!user.waiverAcceptedAt) {
    return false;
  }

  // No version recorded (legacy users) - requires re-acceptance
  if (!user.waiverVersion) {
    return false;
  }

  // Version mismatch - requires re-acceptance
  if (user.waiverVersion !== CURRENT_WAIVER_VERSION) {
    return false;
  }

  return true;
}

/**
 * Determine if this is a waiver update (user had previous version)
 */
export function isWaiverUpdate(waiverVersion: string | null): boolean {
  return waiverVersion !== null && waiverVersion !== CURRENT_WAIVER_VERSION;
}
