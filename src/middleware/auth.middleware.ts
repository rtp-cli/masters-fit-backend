import { Request } from "express";
import jwt from "jsonwebtoken";
import { validateCurrentWaiver, WaiverValidationError } from "@/utils/waiver.utils";
import { userService } from "@/services/user.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { getBestIP } from "@/utils/ip.utils";

// Extend Request interface to include clientIP and user UUID
interface AuthenticatedRequest extends Request {
  userId: number;
  userUuid?: string;
  clientIP?: string;
}

/**
 * Extract client IP address from request headers
 * Handles various proxy and load balancer scenarios
 */
function getClientIP(req: Request): string | undefined {
  try {
    // Check for forwarded IP from proxies/load balancers
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // x-forwarded-for can be a comma-separated list, take the first one
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const ip = ips.split(',')[0].trim();
      if (ip) return ip;
    }

    // Check for real IP header
    const realIP = req.headers['x-real-ip'];
    if (realIP && typeof realIP === 'string') {
      return realIP;
    }

    // Fall back to connection remote address
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || undefined;
  } catch (error) {
    // If IP extraction fails, return undefined rather than throwing
    console.warn('Failed to extract client IP:', error);
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
    };

    // Set userId in request for logging context
    request.userId = parseInt(decoded.id);

    // Capture and enhance client IP for analytics
    const rawIP = getClientIP(request);
    const bestIP = await getBestIP(rawIP);
    // Always set clientIP, even if undefined, to avoid property access errors
    request.clientIP = bestIP;

    // Fetch user information and store UUID in request for analytics
    try {
      const user = await userService.getUser(parseInt(decoded.id));
      if (user?.uuid) {
        // Store UUID in request for analytics controllers
        request.userUuid = user.uuid;

        // Don't await this - let it run in background
        eventTrackingService.ensureUserProfileExists(user, bestIP).catch(() => {
          // Silently handle errors to not affect authentication
        });
      }
    } catch (error) {
      // Ignore profile sync errors - don't affect authentication
    }

    // Skip waiver validation for auth endpoints (to avoid circular dependency)
    const isAuthEndpoint = request.path.startsWith('/api/auth');

    // Also skip waiver validation for waiver-specific endpoints
    const isWaiverEndpoint = request.path.includes('/waiver-status') ||
                             request.path.includes('/accept-waiver') ||
                             request.path.endsWith('/waiver-status') ||
                             request.path.endsWith('/accept-waiver');

    // Debug logging
    console.log(`[Auth Middleware] Path: ${request.path}, isAuth: ${isAuthEndpoint}, isWaiver: ${isWaiverEndpoint}`);

    if (!isAuthEndpoint && !isWaiverEndpoint) {
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
    // Handle waiver validation errors with specific status codes
    if ((error as any).status === 426) {
      const waiverError = new Error((error as Error).message);
      (waiverError as any).status = 426;
      throw waiverError;
    }

    throw new Error("Invalid or expired token");
  }
}
