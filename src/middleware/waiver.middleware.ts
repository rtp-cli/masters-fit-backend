import { Request, Response, NextFunction } from "express";
import { userService } from "@/services";
import { CURRENT_WAIVER_VERSION, hasAcceptedCurrentWaiver } from "@/constants/waiver";
import { logger } from "@/utils/logger";

/**
 * Middleware to ensure user has accepted the current waiver version
 * Returns HTTP 426 "Upgrade Required" if waiver is outdated
 */
export const requireCurrentWaiver = async (
  req: Request & { userId?: number },
  res: Response,
  next: NextFunction
) => {
  try {
    // Skip waiver check if no user ID (should be handled by auth middleware first)
    if (!req.userId) {
      return next();
    }

    // Get user from database to check waiver status
    const user = await userService.getUser(req.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found",
      });
    }

    // Check if user has accepted the current waiver version
    if (!hasAcceptedCurrentWaiver(user)) {
      logger.info("Waiver enforcement triggered", {
        operation: "requireCurrentWaiver",
        metadata: {
          userId: req.userId,
          userWaiverVersion: user.waiverVersion,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
          route: req.path,
        },
      });

      return res.status(426).json({
        success: false,
        error: "WAIVER_UPDATE_REQUIRED",
        message: "You must accept the updated waiver to continue",
        waiverInfo: {
          currentVersion: CURRENT_WAIVER_VERSION,
          userVersion: user.waiverVersion,
          hasAccepted: user.waiverAcceptedAt !== null,
          isUpdate: user.waiverVersion !== null && user.waiverVersion !== CURRENT_WAIVER_VERSION,
        },
      });
    }

    // Waiver is current, proceed with request
    next();
  } catch (error) {
    logger.error("Waiver middleware error", error as Error, {
      operation: "requireCurrentWaiver",
      metadata: {
        userId: req.userId,
        route: req.path,
      },
    });

    // On error, be conservative and require waiver acceptance
    return res.status(426).json({
      success: false,
      error: "WAIVER_CHECK_FAILED",
      message: "Unable to verify waiver status. Please accept the current waiver.",
      waiverInfo: {
        currentVersion: CURRENT_WAIVER_VERSION,
        userVersion: null,
        hasAccepted: false,
        isUpdate: false,
      },
    });
  }
};

/**
 * Optional middleware for routes that should check waiver but not block on failure
 * Logs waiver status but allows request to proceed
 */
export const logWaiverStatus = async (
  req: Request & { userId?: number },
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.userId) {
      return next();
    }

    const user = await userService.getUser(req.userId);

    if (user && !hasAcceptedCurrentWaiver(user)) {
      logger.warn("User accessing route with outdated waiver", {
        operation: "logWaiverStatus",
        metadata: {
          userId: req.userId,
          userWaiverVersion: user.waiverVersion,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
          route: req.path,
        },
      });
    }

    next();
  } catch (error) {
    logger.error("Waiver status logging error", error as Error, {
      operation: "logWaiverStatus",
      metadata: {
        userId: req.userId,
        route: req.path,
      },
    });

    // Always proceed - this is just for logging
    next();
  }
};