import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "@/utils/logger.js";

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

  // Log all other errors as errors
  logger.error("Unhandled error", err, context);

  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};
