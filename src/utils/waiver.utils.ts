import { userService } from "@/services";
import { CURRENT_WAIVER_VERSION, hasAcceptedCurrentWaiver } from "@/constants/waiver";
import { logger } from "@/utils/logger";

/**
 * TSOA-compatible waiver validation utility
 * Throws appropriate error responses for TSOA controllers
 */
export class WaiverValidationError extends Error {
  public status: number;
  public response: any;

  constructor(status: number, response: any) {
    super(response.message || response.error);
    this.status = status;
    this.response = response;
  }
}

/**
 * Validates current waiver for authenticated user in TSOA controllers
 * @param userId - Authenticated user ID from request.userId
 * @param route - Route being accessed (for logging)
 * @throws WaiverValidationError if waiver is outdated or invalid
 */
export async function validateCurrentWaiver(userId: number, route?: string): Promise<void> {
  try {
    if (!userId) {
      throw new WaiverValidationError(401, {
        success: false,
        error: "User authentication required",
      });
    }

    // Get user from database to check waiver status
    const user = await userService.getUser(userId);

    if (!user) {
      throw new WaiverValidationError(401, {
        success: false,
        error: "User not found",
      });
    }

    // Check if user has accepted the current waiver version
    if (!hasAcceptedCurrentWaiver(user)) {
      logger.info("Waiver enforcement triggered", {
        operation: "validateCurrentWaiver",
        metadata: {
          userId,
          userWaiverVersion: user.waiverVersion,
          currentWaiverVersion: CURRENT_WAIVER_VERSION,
          route: route || "unknown",
        },
      });

      throw new WaiverValidationError(426, {
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

    // Waiver is current - validation passed
  } catch (error) {
    // Re-throw WaiverValidationError as-is
    if (error instanceof WaiverValidationError) {
      throw error;
    }

    // Log unexpected errors
    logger.error("Waiver validation error", error as Error, {
      operation: "validateCurrentWaiver",
      metadata: {
        userId,
        route: route || "unknown",
      },
    });

    // On unexpected error, be conservative and require waiver acceptance
    throw new WaiverValidationError(426, {
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
}

/**
 * Middleware wrapper for Express routes (non-TSOA)
 * Use this for routes that aren't using TSOA controllers
 */
export async function validateCurrentWaiverMiddleware(
  req: any,
  res: any,
  next: any
): Promise<void> {
  try {
    await validateCurrentWaiver(req.userId, req.path);
    next();
  } catch (error) {
    if (error instanceof WaiverValidationError) {
      return res.status(error.status).json(error.response);
    }
    next(error);
  }
}