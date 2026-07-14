import { Request, Response, NextFunction, RequestHandler } from "express";
import { expressAuthentication } from "@/middleware/auth.middleware";
import { ownershipService, OwnedObjectType } from "@/services/ownership.service";
import { accessService } from "@/services/access.service";
import { Capability } from "@/constants/access-policy";
import { requiresPlusMessageFor } from "@/constants/paywall-copy";
import { logger } from "@/utils/logger";

/**
 * Centralized authentication + object-level authorization middleware.
 *
 * Why this exists: previously auth was called ad-hoc inside route handlers
 * (and omitted on many routes), and object-keyed routes never verified that
 * the referenced object belonged to the caller — a systemic IDOR. These
 * middlewares put authn + authz in one place so every route composes them
 * explicitly and the coverage test (see authz.coverage.test) can prove no
 * route is left unguarded.
 *
 * Ordering contract: requireAuth MUST run before requireSelf / requireOwnership
 * / requireAdmin (they read req.userId set by requireAuth).
 */

interface AuthedRequest extends Request {
  userId?: number;
}

/**
 * Mirrors the auth-error mapping the route handlers used with their local
 * handleError helper, so authn failure responses are unchanged by this refactor.
 * (Waiver 426 errors carry a `.status` and a JSON message; that pre-existing
 * behavior is preserved here rather than "fixed" as part of the P0 security pass.)
 */
function sendAuthError(error: unknown, res: Response): void {
  if ((error as any)?.status === 426) {
    // Preserve pre-existing waiver behavior: message is a JSON payload string.
    try {
      res.status(426).json(JSON.parse((error as Error).message));
    } catch {
      res.status(426).json({ success: false, error: "Waiver acceptance required" });
    }
    return;
  }
  if (error instanceof Error && error.message === "Invalid or expired token") {
    res.status(401).json({ success: false, error: error.message });
    return;
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  if (error instanceof Error) {
    res.status(401).json({ success: false, error: error.message });
    return;
  }
  res.status(401).json({ success: false, error: "Unauthorized" });
}

/**
 * Verifies the bearer JWT and sets req.userId. Named function so the authz
 * coverage test can detect its presence in each route's middleware stack.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await expressAuthentication(req as any, "bearerAuth");
    next();
  } catch (error) {
    sendAuthError(error, res);
  }
}

/**
 * Asserts the path parameter `paramName` (default "userId") equals the
 * authenticated user. For routes keyed directly by a user id.
 */
export function requireSelf(paramName: string = "userId"): RequestHandler {
  return function requireSelfGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): void {
    const pathId = Number(req.params[paramName]);
    if (!Number.isInteger(pathId) || pathId !== req.userId) {
      logger.warn("Authorization denied: path user mismatch", {
        operation: "requireSelf",
        userId: req.userId,
        metadata: { paramName, pathId },
      });
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Verifies the authenticated user owns the object identified by
 * req.params[paramName]. 404 when the object does not exist, 403 when it
 * belongs to someone else. For routes keyed by an object id (workout, plan
 * day, exercise, log, profile, job) rather than a userId.
 */
export function requireOwnership(
  type: OwnedObjectType,
  paramName: string = "id"
): RequestHandler {
  return async function requireOwnershipGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const objectId = Number(req.params[paramName]);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      res.status(400).json({ success: false, error: "Invalid id" });
      return;
    }

    let ownerId: number | null;
    try {
      ownerId = await ownershipService.resolveOwnerUserId(type, objectId);
    } catch (error) {
      logger.error("Ownership resolution failed", error as Error, {
        operation: "requireOwnership",
        userId: req.userId,
        metadata: { type, objectId },
      });
      res.status(500).json({ success: false, error: "Internal server error" });
      return;
    }

    if (ownerId === null) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }
    if (ownerId !== req.userId) {
      logger.warn("Authorization denied: object ownership mismatch", {
        operation: "requireOwnership",
        userId: req.userId,
        metadata: { type, objectId, ownerId },
      });
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Like requireOwnership, but reads the object id from the request BODY
 * (req.body[bodyKey]) instead of a path param. For write routes that identify
 * their target object in the payload (e.g. POST /logs/exercise carries
 * planDayExerciseId, POST /logs/workout carries workoutId).
 */
export function requireOwnershipFromBody(
  type: OwnedObjectType,
  bodyKey: string
): RequestHandler {
  return async function requireOwnershipFromBodyGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const objectId = Number(req.body?.[bodyKey]);
    if (!Number.isInteger(objectId) || objectId <= 0) {
      res.status(400).json({ success: false, error: `Invalid ${bodyKey}` });
      return;
    }
    try {
      const ownerId = await ownershipService.resolveOwnerUserId(type, objectId);
      if (ownerId === null) {
        res.status(404).json({ success: false, error: "Not found" });
        return;
      }
      if (ownerId !== req.userId) {
        logger.warn("Authorization denied: body object ownership mismatch", {
          operation: "requireOwnershipFromBody",
          userId: req.userId,
          metadata: { type, objectId, ownerId },
        });
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      next();
    } catch (error) {
      logger.error("Ownership resolution failed", error as Error, {
        operation: "requireOwnershipFromBody",
        userId: req.userId,
        metadata: { type, objectId },
      });
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}

/**
 * Asserts a userId carried in the request BODY equals the authenticated user.
 * Guards against IDOR via a trusted body userId (e.g. profile create/update,
 * where the controller writes to req.body.userId). When required=false the
 * check only fires if the key is present (rejects a mismatch, allows absence).
 */
export function requireBodySelf(
  bodyKey: string = "userId",
  options: { required?: boolean } = { required: true }
): RequestHandler {
  return function requireBodySelfGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): void {
    const raw = req.body?.[bodyKey];
    if (raw === undefined || raw === null) {
      if (options.required) {
        res.status(400).json({ success: false, error: `Missing ${bodyKey}` });
        return;
      }
      next();
      return;
    }
    if (Number(raw) !== req.userId) {
      logger.warn("Authorization denied: body userId mismatch", {
        operation: "requireBodySelf",
        userId: req.userId,
        metadata: { bodyKey, bodyValue: raw },
      });
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Verifies the caller owns EVERY object referenced in a body array
 * (req.body[arrayKey][].itemKey). For batch write routes
 * (e.g. POST /logs/exercise/batch). Rejects the whole request if any item is
 * missing or owned by another user.
 */
export function requireOwnershipBatchFromBody(
  type: OwnedObjectType,
  arrayKey: string,
  itemKey: string
): RequestHandler {
  return async function requireOwnershipBatchGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const arr = req.body?.[arrayKey];
    if (!Array.isArray(arr) || arr.length === 0) {
      res.status(400).json({ success: false, error: `Invalid ${arrayKey}` });
      return;
    }
    const ids = Array.from(
      new Set(arr.map((item) => Number(item?.[itemKey])))
    );
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      res.status(400).json({ success: false, error: `Invalid ${itemKey}` });
      return;
    }
    try {
      for (const id of ids) {
        const ownerId = await ownershipService.resolveOwnerUserId(type, id);
        if (ownerId === null) {
          res.status(404).json({ success: false, error: "Not found" });
          return;
        }
        if (ownerId !== req.userId) {
          logger.warn("Authorization denied: batch object ownership mismatch", {
            operation: "requireOwnershipBatchFromBody",
            userId: req.userId,
            metadata: { type, id, ownerId },
          });
          res.status(403).json({ success: false, error: "Forbidden" });
          return;
        }
      }
      next();
    } catch (error) {
      logger.error("Batch ownership resolution failed", error as Error, {
        operation: "requireOwnershipBatchFromBody",
        userId: req.userId,
        metadata: { type, arrayKey, itemKey },
      });
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}

/**
 * Admin authorization for internal/global endpoints (llm-metrics, prompts,
 * ai-provider config, exercise-catalog mutations).
 *
 * INTERIM (P0): gated on an env allowlist of admin user ids
 * (ADMIN_USER_IDS="1,2,3"). Fail-closed — if unset, no user is an admin.
 * P1 replaces this with the BYPASS access tier once access_override lands.
 */
function parseAdminIds(): Set<number> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

/**
 * Server-side entitlement gate: 403s (as a paywall) unless the authenticated
 * user's tier grants `capability`. For premium read features (advanced
 * analytics, etc.). Must run after requireAuth.
 */
export function requireCapability(capability: Capability): RequestHandler {
  return async function requireCapabilityGuard(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (
        req.userId === undefined ||
        !(await accessService.hasCapability(req.userId, capability))
      ) {
        const message = requiresPlusMessageFor(capability);
        res.status(403).json({
          success: false,
          error: message,
          paywall: { type: "requires_plus", message },
        });
        return;
      }
      next();
    } catch (error) {
      logger.error("Capability check failed", error as Error, {
        operation: "requireCapability",
        userId: req.userId,
        metadata: { capability },
      });
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}

export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  const adminIds = parseAdminIds();
  if (req.userId === undefined || !adminIds.has(req.userId)) {
    logger.warn("Authorization denied: not an admin", {
      operation: "requireAdmin",
      userId: req.userId,
    });
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }
  next();
}
