import { Request, Response, NextFunction } from "express";
import { subscriptionService } from "@/services/subscription.service";
import { PaywallResponse } from "@/types/subscription/responses";
import { expressAuthentication } from "@/middleware/auth.middleware";
import { logger } from "@/utils/logger";
import { AccessLevel, PaywallType } from "@/constants";

// Extend Request interface
interface SubscriptionRequest extends Request {
  userId?: number;
  subscriptionAccess?: AccessLevel;
  estimatedTokens?: number;
}

/**
 * Estimate token usage from request body
 * This is a rough estimate - actual usage will be tracked after operation
 */
function estimateTokenUsage(req: SubscriptionRequest): number {
  // Default estimate: ~2000 tokens per generation/regeneration
  // This can be refined based on actual usage patterns
  return 2000;
}

/**
 * Get paywall type from reason
 * Updated to handle OR logic where multiple limits can be exceeded
 */
function getPaywallType(
  operation: "generation" | "regeneration",
  reason?: string
): PaywallType {
  // If multiple limits are exceeded, prioritize token limit, then weekly, then daily
  if (reason?.includes("Token limit") || reason?.includes("tokens")) {
    return PaywallType.TOKEN_LIMIT_EXCEEDED;
  }
  if (
    reason?.includes("Weekly plan regeneration limit") ||
    reason?.includes("Weekly generation limit") ||
    reason?.includes("weekly")
  ) {
    return PaywallType.WEEKLY_LIMIT_EXCEEDED;
  }
  if (
    reason?.includes("Day-plan regeneration limit") ||
    reason?.includes("Daily regeneration limit") ||
    reason?.includes("daily")
  ) {
    return PaywallType.DAILY_REGENERATION_LIMIT_EXCEEDED;
  }
  return PaywallType.SUBSCRIPTION_REQUIRED;
}

/**
 * Get paywall message from type
 * Updated to reflect OR logic: if ANY limit is reached, user is blocked
 */
function getPaywallMessage(
  operation: "generation" | "regeneration",
  reason?: string
): string {
  // If reason mentions multiple limits, use a combined message
  if (reason?.includes("Trial limits exceeded:")) {
    return reason; // Use the detailed reason from the service
  }

  if (
    reason?.includes("Weekly plan regeneration limit") ||
    reason?.includes("Weekly generation limit")
  ) {
    return "You've reached your weekly plan regeneration limit (2 total lifetime). Subscribe to regenerate unlimited workout plans.";
  }
  if (
    reason?.includes("Day-plan regeneration limit") ||
    reason?.includes("Daily regeneration limit")
  ) {
    return "You've reached your day-plan regeneration limit (5 total lifetime). Subscribe to regenerate unlimited times.";
  }
  if (reason?.includes("Token limit")) {
    return "You've reached your token usage limit. Subscribe to continue generating workout plans.";
  }
  return "A subscription is required to generate new workout plans. You can continue using your existing workout plans without a subscription.";
}

/**
 * Subscription guard middleware
 * Checks subscription status and trial limits before allowing generation/regeneration
 */
export function subscriptionGuard(
  operation: "generation" | "regeneration",
  scope: "weekly" | "daily" = "weekly"
) {
  return async (
    req: SubscriptionRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Authenticate first if userId is not set
      if (!req.userId) {
        try {
          await expressAuthentication(req as any, "bearerAuth");
        } catch (authError) {
          res.status(401).json({
            success: false,
            error: "Unauthorized",
          });
          return;
        }
      }

      const userId = req.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: "Unauthorized",
        });
        return;
      }

      // Get user subscription (creates trial if none exists)
      const subscription =
        await subscriptionService.getUserSubscription(userId);

      // Get effective access level
      const accessLevel =
        await subscriptionService.getEffectiveAccessLevel(userId);

      // Store access level in request for controller use
      req.subscriptionAccess = accessLevel;

      // Unlimited access - skip all checks
      if (accessLevel === AccessLevel.UNLIMITED) {
        logger.debug("Unlimited access granted", {
          operation: "subscriptionGuard",
          userId,
          accessLevel,
        });
        next();
        return;
      }

      // Blocked access - subscription required
      if (accessLevel === AccessLevel.BLOCKED) {
        const paywallResponse: PaywallResponse = {
          success: false,
          error: "Subscription required for new workout generation",
          paywall: {
            type: PaywallType.SUBSCRIPTION_REQUIRED,
            message: getPaywallMessage(operation),
          },
        };

        logger.info("Subscription required - request blocked", {
          operation: "subscriptionGuard",
          userId,
          accessLevel,
        });

        res.status(403).json(paywallResponse);
        return;
      }

      // Trial access - check limits
      if (accessLevel === AccessLevel.TRIAL) {
        const estimatedTokens = estimateTokenUsage(req);
        req.estimatedTokens = estimatedTokens;

        const limitCheck = await subscriptionService.checkTrialLimits(
          userId,
          operation,
          estimatedTokens,
          scope
        );

        if (!limitCheck.allowed) {
          const paywallResponse: PaywallResponse = {
            success: false,
            error: limitCheck.reason || "Trial limit exceeded",
            paywall: {
              type: getPaywallType(operation, limitCheck.reason),
              message: getPaywallMessage(operation, limitCheck.reason),
              limits: limitCheck.limits,
            },
          };

          logger.info("Trial limit exceeded - request blocked", {
            operation: "subscriptionGuard",
            userId,
            accessLevel,
            limitReason: limitCheck.reason,
            limits: limitCheck.limits,
          });

          res.status(403).json(paywallResponse);
          return;
        }

        logger.debug("Trial access granted - limits OK", {
          operation: "subscriptionGuard",
          userId,
          accessLevel,
          limits: limitCheck.limits,
        });
      }

      next();
    } catch (error) {
      logger.error("Subscription guard error", error as Error, {
        operation: "subscriptionGuard",
        userId: req.userId,
      });

      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };
}
