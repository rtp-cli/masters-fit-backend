import { Router } from "express";

import { requireAuth, requireAdmin } from "@/middleware/authz.middleware";
import { userService } from "@/services/user.service";
import { impersonationService } from "@/services/impersonation.service";
import { requireRole, type AdminRequest } from "@/middleware/admin-role.middleware";
import { adminActionService } from "@/services/admin-action.service";
import {
  adminUserService,
  AdminUserError,
  type PlatformFilter,
} from "@/services/admin-user.service";
import { usageReportService } from "@/services/usage-report.service";
import { ADMIN_ACTIONS } from "@/constants/admin-roles";
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
      // Looked up BY email just above, so it is never null here.
      targetEmail: target.email ?? email.trim(),
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

// ---- Admin console (admin.mastersfit.ai) ----
// Every route: requireAuth, then requireRole(<minimum>). Reads are analyst+,
// state changes are admin+ and go through adminActionService.run so they are
// always recorded in admin_action_log. A state-changing route must also demand
// a non-empty `reason`.

function sendServerError(res: any, operation: string, error: unknown) {
  logger.error("Admin console request failed", error as Error, { operation });
  res.status(500).json({ success: false, error: "Internal server error" });
}

function parseUserId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/admin/me — who is signed in to the console, and at what role.
router.get("/me", requireAuth, requireRole("analyst"), async (req, res) => {
  try {
    const r = req as AdminRequest;
    const user = await userService.getUser(r.userId!);
    res.json({
      success: true,
      data: {
        userId: r.userId,
        name: user?.name ?? null,
        email: user?.email ?? null,
        role: r.adminRole,
      },
    });
  } catch (error) {
    sendServerError(res, "admin.me", error);
  }
});

// GET /api/admin/usage — the weekly usage report (last full Mon–Sun week vs
// the week before), the same numbers as the Monday email.
router.get("/usage", requireAuth, requireRole("analyst"), async (_req, res) => {
  try {
    const report = await usageReportService.buildReport(new Date());
    res.json({ success: true, data: report });
  } catch (error) {
    sendServerError(res, "admin.usage", error);
  }
});

// GET /api/admin/users?q=<email|phone|name|id>&platform=<ios|android|web|unknown>
router.get("/users", requireAuth, requireRole("analyst"), async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const platform = ["ios", "android", "web", "unknown"].includes(req.query.platform as string)
      ? (req.query.platform as PlatformFilter)
      : undefined;
    res.json({ success: true, data: await adminUserService.search(q, platform) });
  } catch (error) {
    sendServerError(res, "admin.users.search", error);
  }
});

// GET /api/admin/platforms — real users by the platform of their latest app open.
router.get("/platforms", requireAuth, requireRole("analyst"), async (_req, res) => {
  try {
    res.json({ success: true, data: await adminUserService.platformSplit() });
  } catch (error) {
    sendServerError(res, "admin.platforms", error);
  }
});

// GET /api/admin/users/:id
router.get(
  "/users/:id",
  requireAuth,
  requireRole("analyst"),
  async (req, res) => {
    try {
      const id = parseUserId(req.params.id);
      if (!id) {
        res.status(400).json({ success: false, error: "Invalid user id" });
        return;
      }
      const detail = await adminUserService.getDetail(id);
      if (!detail) {
        res.status(404).json({ success: false, error: "No user with that id" });
        return;
      }
      res.json({ success: true, data: detail });
    } catch (error) {
      sendServerError(res, "admin.users.detail", error);
    }
  }
);

// POST /api/admin/users/:id/comp  { grant: boolean, reason: string, sendEmail?: boolean }
// Grant or revoke complimentary access. Audited.
router.post(
  "/users/:id/comp",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const r = req as AdminRequest;
    const id = parseUserId(req.params.id);
    const { grant, reason, sendEmail } = req.body ?? {};

    if (!id) {
      res.status(400).json({ success: false, error: "Invalid user id" });
      return;
    }
    if (typeof grant !== "boolean") {
      res.status(400).json({ success: false, error: "`grant` must be true or false" });
      return;
    }
    if (typeof reason !== "string" || !reason.trim()) {
      res.status(400).json({ success: false, error: "A reason is required" });
      return;
    }

    try {
      const result = await adminActionService.run(
        {
          adminUserId: r.userId!,
          action: grant ? ADMIN_ACTIONS.COMP_GRANT : ADMIN_ACTIONS.COMP_REVOKE,
          targetUserId: id,
          reason: reason.trim().slice(0, 500),
          params: { sendEmail: sendEmail !== false },
          ipAddress: (req as any).clientIP,
        },
        () => adminUserService.setComp(id, grant, { sendEmail: sendEmail !== false })
      );
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof AdminUserError) {
        res.status(error.status).json({ success: false, error: error.message });
        return;
      }
      sendServerError(res, "admin.users.comp", error);
    }
  }
);

// GET /api/admin/actions?limit=50 — the admin action log, newest first.
router.get("/actions", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    res.json({ success: true, data: await adminActionService.list(limit) });
  } catch (error) {
    sendServerError(res, "admin.actions", error);
  }
});

export { router as adminRouter };
