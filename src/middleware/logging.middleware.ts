import { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger.js";
import { v4 as uuidv4 } from "uuid";

// Extend Express Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      userId?: number;
    }
  }
}

export const loggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();
  const requestId = uuidv4();

  // Add request ID to request object for downstream use
  req.requestId = requestId;

  // Set request context in logger
  const context = {
    requestId,
    userId: req.userId, // Will be set by auth middleware if user is authenticated
    operation: `${req.method} ${req.path}`,
  };

  logger.setContext(context);

  // Log request start for API endpoints (excluding health checks and static assets)
  if (req.path.startsWith("/api") && !req.path.includes("/health")) {
    logger.requestStart(req.method, req.path, {
      requestId,
      userAgent: req.get("User-Agent"),
      ip: req.ip || req.connection.remoteAddress,
    });
  }

  // Capture response details
  const originalSend = res.send;
  const originalJson = res.json;
  let responseBody: any = undefined;

  res.send = function (body) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  res.json = function (body) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    // Log request completion for API endpoints
    if (req.path.startsWith("/api") && !req.path.includes("/health")) {
      const responseContext: any = {
        requestId,
        userId: req.userId,
        duration,
        responseSize: res.get("Content-Length"),
      };

      // Add error details if response indicates an error
      if (res.statusCode >= 400) {
        responseContext.metadata = {
          errorResponse:
            typeof responseBody === "string" && responseBody.length < 200
              ? responseBody
              : undefined,
        };
      }

      logger.requestEnd(
        req.method,
        req.path,
        res.statusCode,
        duration,
        responseContext
      );

      // Log performance warnings for slow requests
      if (duration > 1000) {
        logger.performanceWarning("HTTP Request", duration, 1000, {
          requestId,
          path: req.path,
          method: req.method,
        });
      }
    }

    // Clear context after request
    logger.clearContext();
  });

  next();
};
