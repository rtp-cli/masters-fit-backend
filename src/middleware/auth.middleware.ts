import { Request } from "express";
import jwt from "jsonwebtoken";
import {
  validateCurrentWaiver,
  WaiverValidationError,
} from "@/utils/waiver.utils";
import { userService } from "@/services/user.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { getBestIP } from "@/utils/ip.utils";

// Extend Request interface to include clientIP and user UUID
interface AuthenticatedRequest extends Request {
  userId: number;
  userUuid?: string;
  clientIP?: string;
  // Present only when the caller is an admin acting as another user via an
  // impersonation token (see /api/admin/impersonate). Holds the admin's own
  // user id + the audit session id from the `imp` JWT claim.
  impersonatedBy?: number;
  impersonationSessionId?: string;
}

/**
 * Extract client IP address from request headers
 * Handles various proxy and load balancer scenarios
 */
function getClientIP(req: Request): string | undefined {
  try {
    // Check for forwarded IP from proxies/load balancers
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      // x-forwarded-for can be a comma-separated list, take the first one
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const ip = ips.split(",")[0].trim();
      if (ip) return ip;
    }

    // Check for real IP header
    const realIP = req.headers["x-real-ip"];
    if (realIP && typeof realIP === "string") {
      return realIP;
    }

    // Fall back to connection remote address
    return (
      req.ip ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      undefined
    );
  } catch (error) {
    // If IP extraction fails, return undefined rather than throwing
    console.warn("Failed to extract client IP:", error);
    return undefined;
  }
}

export async function expressAuthentication(
  request: AuthenticatedRequest,
  securityName: string,
  scopes?: string[]
): Promise<any> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      imp?: { by: number; sid: string };
    };

    // Impersonation tokens (admin "view as user") are strictly READ-ONLY. This
    // is the security model, not just UX: even if the app has a bug, the token
    // physically cannot mutate prod. Enforced here at the single auth choke
    // point so it covers both the requireAuth-composed routers and the older
    // routers that call expressAuthentication() inline. HEAD/OPTIONS are safe
    // reads; everything else (POST/PUT/PATCH/DELETE) is refused.
    if (decoded.imp && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const roError = new Error(
        "Read-only session: impersonation cannot modify data. Exit impersonation to make changes."
      );
      (roError as any).status = 403;
      throw roError;
    }

    // Set userId in request for logging context
    request.userId = parseInt(decoded.id);
    if (decoded.imp) {
      request.impersonatedBy = decoded.imp.by;
      request.impersonationSessionId = decoded.imp.sid;
    }

    // Capture and enhance client IP for analytics
    const rawIP = getClientIP(request);
    const bestIP = await getBestIP(rawIP);
    // Always set clientIP, even if undefined, to avoid property access errors
    request.clientIP = bestIP;

    // Fetch user information and store UUID in request for analytics
    try {
      const user = await userService.getUser(parseInt(decoded.id));

      // Check if account is active
      if (user && user.isActive === false) {
        throw new Error("Account has been deleted");
      }

      if (user?.uuid) {
        // Store UUID in request for analytics controllers
        request.userUuid = user.uuid;

        // Don't await this - let it run in background
        eventTrackingService.ensureUserProfileExists(user, bestIP).catch(() => {
          // Silently handle errors to not affect authentication
        });
      }
    } catch (error) {
      // If it's an account deleted error, throw it
      if (
        error instanceof Error &&
        error.message === "Account has been deleted"
      ) {
        throw error;
      }
      // Ignore profile sync errors - don't affect authentication
    }

    // Skip waiver validation for auth endpoints (to avoid circular dependency)
    const isAuthEndpoint = request.path.startsWith("/api/auth");

    // Also skip waiver validation for waiver-specific endpoints
    const isWaiverEndpoint =
      request.path.includes("/waiver-status") ||
      request.path.includes("/accept-waiver") ||
      request.path.endsWith("/waiver-status") ||
      request.path.endsWith("/accept-waiver");

    // Debug logging
    console.log(
      `[Auth Middleware] Path: ${request.path}, isAuth: ${isAuthEndpoint}, isWaiver: ${isWaiverEndpoint}`
    );

    // Impersonation is read-only viewing, so the target's waiver state must not
    // block an admin from looking at their account (and must not push the admin
    // into the waiver-acceptance flow on the target's behalf).
    if (!isAuthEndpoint && !isWaiverEndpoint && !decoded.imp) {
      // Validate current waiver for all non-auth and non-waiver endpoints
      try {
        await validateCurrentWaiver(request.userId, request.path);
      } catch (error) {
        if (error instanceof WaiverValidationError) {
          // Create custom error that TSOA will handle with correct status code
          const waiverError = new Error(JSON.stringify(error.response));
          (waiverError as any).status = error.status;
          throw waiverError;
        }
        throw error;
      }
    }

    return decoded;
  } catch (error) {
    // Errors that already carry an explicit HTTP status (waiver 426 etc.)
    // pass through unchanged for the caller to map.
    if (typeof (error as any)?.status === "number") {
      throw error;
    }

    // Only genuine auth failures may become a 401: an invalid/expired JWT or
    // a deleted account. Anything else caught here is an infrastructure
    // failure (DB blip during user lookup or waiver validation, IP
    // enrichment) — mapping those to 401 made healthy clients burn a refresh
    // rotation and log users out mid-session on a transient server error.
    const isAuthError =
      error instanceof jwt.JsonWebTokenError ||
      (error instanceof Error && error.message === "Account has been deleted");
    if (isAuthError) {
      throw new Error("Invalid or expired token");
    }

    const infraError = new Error("Service temporarily unavailable");
    (infraError as any).status = 503;
    throw infraError;
  }
}
