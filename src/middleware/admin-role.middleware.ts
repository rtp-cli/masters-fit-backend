import { Request, Response, NextFunction, RequestHandler } from "express";
import { type AdminRole, roleAtLeast } from "@/constants/admin-roles";
import { adminRoleService } from "@/services/admin-role.service";
import { logger } from "@/utils/logger";

export interface AdminRequest extends Request {
  userId?: number;
  impersonatedBy?: number;
  /** Set by requireRole for the handlers after it. */
  adminRole?: AdminRole;
}

/**
 * Admin-console gate: 403 unless the authenticated user's role is at least
 * `minimum`. Must run after requireAuth. Server-side and per-route — the
 * console's UI hides things by role too, but this is the enforcement.
 *
 * Impersonation ("view as user") tokens are refused outright, whatever the
 * target's role: those sessions exist to see the APP as a customer, never to
 * act as an admin.
 */
export function requireRole(minimum: AdminRole): RequestHandler {
  return async function requireRoleGuard(
    req: AdminRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (req.userId === undefined || req.impersonatedBy !== undefined) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }

      const role = await adminRoleService.getRole(req.userId);
      if (!roleAtLeast(role, minimum)) {
        logger.warn("Authorization denied: admin role too low", {
          operation: "requireRole",
          userId: req.userId,
          metadata: { role, minimum },
        });
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }

      req.adminRole = role!;
      next();
    } catch (error) {
      logger.error("Admin role check failed", error as Error, {
        operation: "requireRole",
        userId: req.userId,
      });
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}
