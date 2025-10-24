import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "@/utils/logger.js";
import { RetryError } from "@/utils/retry.utils.js";

/**
 * Check if an error is a database connection error
 */
function isDatabaseConnectionError(error: Error): boolean {
  const dbConnectionErrors = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EADDRNOTAVAIL',
    'ETIMEDOUT',
    'EPIPE',
    'connection timeout',
    'server closed the connection',
    'Connection terminated unexpectedly',
    'connect ECONNREFUSED',
    'Client has encountered a connection error'
  ];

  const errorMessage = error.message?.toLowerCase() || '';
  const errorCode = (error as any).code?.toUpperCase() || '';

  return dbConnectionErrors.some(code =>
    errorMessage.includes(code.toLowerCase()) ||
    errorCode === code.toUpperCase()
  );
}

/**
 * Check if an error is a database query timeout
 */
function isDatabaseTimeoutError(error: Error): boolean {
  const timeoutErrors = [
    'query timeout',
    'statement timeout',
    'canceling statement due to statement timeout',
    'timeout'
  ];

  const errorMessage = error.message?.toLowerCase() || '';
  return timeoutErrors.some(msg => errorMessage.includes(msg));
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const context = {
    requestId: req.requestId,
    userId: req.userId,
    path: req.path,
    method: req.method,
    userAgent: req.get("User-Agent"),
  };

  // Handle validation errors
  if (err instanceof ZodError) {
    logger.warn("Validation error", {
      ...context,
      metadata: { validationErrors: err.errors },
    });

    return res.status(400).json({
      error: "Validation error",
      details: err.errors,
    });
  }

  // Handle retry exhaustion errors
  if (err instanceof RetryError) {
    logger.error("Retry exhausted", err, {
      ...context,
      metadata: {
        attempts: err.attempts,
        lastError: err.lastError.message,
        isDatabaseError: isDatabaseConnectionError(err.lastError)
      }
    });

    if (isDatabaseConnectionError(err.lastError)) {
      return res.status(503).json({
        error: "Service temporarily unavailable",
        message: "Database connection issues. Please try again in a moment.",
        retryAfter: 30 // Suggest retry after 30 seconds
      });
    }

    return res.status(500).json({
      error: "Operation failed after multiple attempts",
      message: process.env.NODE_ENV === "development" ? err.lastError.message : "Please try again later",
    });
  }

  // Handle database connection errors
  if (isDatabaseConnectionError(err)) {
    logger.error("Database connection error", err, context);

    return res.status(503).json({
      error: "Service temporarily unavailable",
      message: "Database connection issues. Please try again in a moment.",
      retryAfter: 30
    });
  }

  // Handle database timeout errors
  if (isDatabaseTimeoutError(err)) {
    logger.warn("Database timeout error", {
      ...context,
      metadata: { error: err.message }
    });

    return res.status(504).json({
      error: "Request timeout",
      message: "The operation took too long to complete. Please try again.",
    });
  }

  // Handle specific database constraint errors
  if (err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
    logger.warn("Database constraint violation", {
      ...context,
      metadata: { error: err.message }
    });

    return res.status(409).json({
      error: "Conflict",
      message: "This operation would create a duplicate entry.",
    });
  }

  // Handle foreign key constraint errors
  if (err.message?.includes('foreign key constraint') || err.message?.includes('violates foreign key')) {
    logger.warn("Foreign key constraint violation", {
      ...context,
      metadata: { error: err.message }
    });

    return res.status(400).json({
      error: "Invalid reference",
      message: "Referenced data does not exist.",
    });
  }

  // Log all other errors as errors
  logger.error("Unhandled error", err, context);

  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};
