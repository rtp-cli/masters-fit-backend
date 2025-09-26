import { Request } from "express";
import jwt from "jsonwebtoken";
import { validateCurrentWaiver, WaiverValidationError } from "@/utils/waiver.utils";

export async function expressAuthentication(
  request: Request,
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
