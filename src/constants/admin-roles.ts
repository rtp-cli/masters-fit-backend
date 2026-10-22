/**
 * Admin-console roles, lowest to highest. Each role can do everything the
 * roles below it can.
 *
 * - analyst:     read-only — dashboards and user lookup.
 * - admin:       analyst + audited actions on users (comp, revoke, ...).
 * - super_admin: admin + managing who has which role.
 *
 * Who can do what will be refined as features land; routes declare a MINIMUM
 * role with requireRole(...), so tightening one route never touches the others.
 */
export const ADMIN_ROLES = ["analyst", "admin", "super_admin"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value)
  );
}

/** True when `role` meets or exceeds `minimum`. */
export function roleAtLeast(
  role: AdminRole | null | undefined,
  minimum: AdminRole
): boolean {
  if (!role) return false;
  return ADMIN_ROLES.indexOf(role) >= ADMIN_ROLES.indexOf(minimum);
}

/** Action names written to admin_action_log.action. */
export const ADMIN_ACTIONS = {
  COMP_GRANT: "user.comp.grant",
  COMP_REVOKE: "user.comp.revoke",
} as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS];
