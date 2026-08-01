import { Router } from "express";

import { requireAuth, requireAdmin } from "@/middleware/authz.middleware";
import { userService } from "@/services/user.service";
import { impersonationService } from "@/services/impersonation.service";
import { logger } from "@/utils/logger";

const router = Router();

// POST /api/admin/impersonate  { email, reason? }
// Admin-only. Mints a short-lived, READ-ONLY token that lets an admin view the
// app as the target user for troubleshooting. Read-only is enforced at the auth
// middleware (any non-GET with an impersonation token → 403); this endpoint just
// records the audit row and hands back the token + target user. Deliberately
// returns NO refreshToken — the session is meant to be short and self-expiring.
router.post("/impersonate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, reason } = req.body ?? {};

    if (typeof email !== "string" || !email.trim()) {
      res
        .status(400)
        .json({ success: false, error: "A target user email is required" });
      return;
    }

    const target = await userService.getUserByEmail(email.trim());
    if (!target) {
      res
        .status(404)
        .json({ success: false, error: "No user with that email" });
      return;
    }

    // Every impersonation session is read-only regardless of who the target is
    // (enforced at the auth middleware), so no special-casing of the target is
    // needed here — even impersonating another admin yields a read-only token.
    const adminUserId = (req as any).userId as number;

    const { token, sessionId } = await impersonationService.startImpersonation({
      adminUserId,
      targetUserId: target.id,
      targetEmail: target.email,
      reason: typeof reason === "string" ? reason : undefined,
      ipAddress: (req as any).clientIP,
    });

    logger.info("Admin impersonation started", {
      operation: "impersonate",
      userId: adminUserId,
      metadata: { targetUserId: target.id, sessionId },
    });

    res.json({ success: true, token, user: target });
  } catch (error) {
    logger.error("Impersonation failed", error as Error, {
      operation: "impersonate",
    });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as adminRouter };
