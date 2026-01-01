import {
  Controller,
  Post,
  Get,
  Route,
  Request,
  Response,
  SuccessResponse,
  Tags,
  Body,
  Header,
} from "@tsoa/runtime";
import { subscriptionService } from "@/services/subscription.service";
import { SubscriptionStatus } from "@/constants";
import {
  RevenueCatWebhookPayload,
  RevenueCatWebhookEvent,
  RevenueCatCancelReason,
} from "@/types/subscription/requests";
import { SubscriptionPlansResponse } from "@/types/subscription/responses";
import { logger } from "@/utils/logger";
import { userService } from "@/services/user.service";

/**
 * Environment variable for RevenueCat webhook authorization
 * Set this in your environment to match the value configured in RevenueCat dashboard
 */
const REVENUECAT_WEBHOOK_AUTH_HEADER =
  process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;

@Route("subscriptions")
@Tags("Subscriptions")
export class SubscriptionController extends Controller {
  /**
   * Get all active subscription plans
   * Returns a list of subscription plans available for purchase
   */
  @Get("/plans")
  @SuccessResponse(200, "Subscription plans retrieved successfully")
  @Response(500, "Internal server error")
  public async getSubscriptionPlans(): Promise<SubscriptionPlansResponse> {
    try {
      const plans = await subscriptionService.getActiveSubscriptionPlans();

      logger.info("Subscription plans retrieved", {
        operation: "getSubscriptionPlans",
        metadata: { planCount: plans.length },
      });

      return {
        success: true,
        plans: plans.map((plan) => ({
          id: plan.id,
          planId: plan.planId,
          name: plan.name,
          description: plan.description,
          billingPeriod: plan.billingPeriod as "monthly" | "annual",
          priceUsd: Number(plan.priceUsd),
          isActive: plan.isActive,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
        })),
      };
    } catch (error) {
      logger.error("Failed to retrieve subscription plans", error as Error, {
        operation: "getSubscriptionPlans",
      });

      this.setStatus(500);
      throw error;
    }
  }

  /**
   * Handle RevenueCat webhook events
   * This endpoint receives webhooks from RevenueCat for subscription events
   * @see https://www.revenuecat.com/docs/integrations/webhooks
   */
  @Post("/webhooks/revenuecat")
  @SuccessResponse(200, "Webhook processed successfully")
  @Response(401, "Unauthorized - Invalid authorization")
  @Response(400, "Bad Request")
  public async handleRevenueCatWebhook(
    @Request() request: any,
    @Body() payload: RevenueCatWebhookPayload,
    @Header("Authorization") authHeader?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Verify authorization header if configured
      // @see https://www.revenuecat.com/docs/integrations/webhooks#security-and-best-practices
      if (REVENUECAT_WEBHOOK_AUTH_HEADER) {
        // Debug logging for authorization issues
        logger.debug("Webhook authorization check", {
          operation: "handleRevenueCatWebhook",
          expectedHeaderConfigured: !!REVENUECAT_WEBHOOK_AUTH_HEADER,
          expectedHeaderPreview:
            REVENUECAT_WEBHOOK_AUTH_HEADER?.substring(0, 8) + "...",
          receivedHeaderPresent: !!authHeader,
          receivedHeaderPreview: authHeader
            ? authHeader.substring(0, 8) + "..."
            : "none",
          headersMatch: authHeader === REVENUECAT_WEBHOOK_AUTH_HEADER,
        });

        if (authHeader !== REVENUECAT_WEBHOOK_AUTH_HEADER) {
          logger.warn("Invalid webhook authorization", {
            operation: "handleRevenueCatWebhook",
            receivedHeader: authHeader ? "[PRESENT_BUT_MISMATCH]" : "missing",
          });
          this.setStatus(401);
          return { success: false, message: "Unauthorized" };
        }
      } else {
        // No auth configured - log this for awareness
        logger.debug(
          "Webhook authorization not configured, accepting all requests",
          {
            operation: "handleRevenueCatWebhook",
          }
        );
      }

      const event = payload.event;
      const eventId = event.id;
      const eventType = event.type;

      logger.info("RevenueCat webhook received", {
        operation: "handleRevenueCatWebhook",
        eventId,
        eventType,
        appUserId: event.app_user_id,
        environment: event.environment,
        store: event.store,
        apiVersion: payload.api_version,
      });

      // Handle TEST event - just return success without processing
      // @see https://www.revenuecat.com/docs/integrations/webhooks#testing
      if (eventType === "TEST") {
        logger.info("Test webhook received", {
          operation: "handleRevenueCatWebhook",
          eventId,
        });
        return { success: true, message: "Test webhook received" };
      }

      // Check idempotency - if event already processed, return success
      // @see https://www.revenuecat.com/docs/integrations/webhooks#handle-duplicate-events
      const isProcessed =
        await subscriptionService.isWebhookEventProcessed(eventId);
      if (isProcessed) {
        logger.info("Webhook event already processed (idempotency check)", {
          operation: "handleRevenueCatWebhook",
          eventId,
          eventType,
        });
        return { success: true, message: "Event already processed" };
      }

      // Process the event
      await this.processWebhookEvent(event);

      // Mark event as processed for idempotency
      await subscriptionService.markWebhookEventProcessed(
        eventId,
        eventType,
        JSON.stringify(payload)
      );

      logger.info("RevenueCat webhook processed successfully", {
        operation: "handleRevenueCatWebhook",
        eventId,
        eventType,
      });

      return { success: true, message: "Webhook processed successfully" };
    } catch (error) {
      logger.error("RevenueCat webhook processing failed", error as Error, {
        operation: "handleRevenueCatWebhook",
        eventType: payload?.event?.type,
        eventId: payload?.event?.id,
      });

      // Return 500 so RevenueCat will retry
      // @see https://www.revenuecat.com/docs/integrations/webhooks - "RevenueCat will retry later (up to 5 times)"
      this.setStatus(500);
      return {
        success: false,
        message: (error as Error).message || "Internal server error",
      };
    }
  }

  /**
   * Process webhook event based on type
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#event-types
   */
  private async processWebhookEvent(
    event: RevenueCatWebhookEvent
  ): Promise<void> {
    const eventType = event.type;
    const appUserId = event.app_user_id;

    // For TRANSFER events, handle differently since they involve multiple users
    if (eventType === "TRANSFER") {
      await this.handleTransfer(event);
      return;
    }

    // For SUBSCRIBER_ALIAS, just log - no action needed
    if (eventType === "SUBSCRIBER_ALIAS") {
      logger.info("Subscriber alias created", {
        operation: "processWebhookEvent",
        appUserId,
        aliases: event.aliases,
      });
      return;
    }

    // Find user by RevenueCat customer ID or user ID
    const userId = await this.resolveUserId(appUserId, event);

    switch (eventType) {
      case "INITIAL_PURCHASE":
        await this.handleInitialPurchase(event, userId);
        break;

      case "RENEWAL":
        await this.handleRenewal(event, userId);
        break;

      case "CANCELLATION":
        await this.handleCancellation(event, userId);
        break;

      case "UNCANCELLATION":
        await this.handleUncancellation(event, userId);
        break;

      case "NON_RENEWING_PURCHASE":
        await this.handleNonRenewingPurchase(event, userId);
        break;

      case "SUBSCRIPTION_PAUSED":
        await this.handleSubscriptionPaused(event, userId);
        break;

      case "EXPIRATION":
        await this.handleExpiration(event, userId);
        break;

      case "BILLING_ISSUE":
        await this.handleBillingIssue(event, userId);
        break;

      case "PRODUCT_CHANGE":
        await this.handleProductChange(event, userId);
        break;

      default:
        // Future-proofing: log unknown events but don't fail
        // @see https://www.revenuecat.com/docs/integrations/webhooks#future-proofing
        logger.warn(
          "Unknown webhook event type - ignoring for future compatibility",
          {
            operation: "processWebhookEvent",
            eventType,
            userId,
          }
        );
    }
  }

  /**
   * Resolve user ID from RevenueCat webhook event
   * Tries multiple methods to find the user:
   * 1. Parse app_user_id as numeric user ID
   * 2. Check subscriber_attributes for user_id
   * 3. Look up by RevenueCat customer ID in database
   * 4. Check original_app_user_id if different from app_user_id
   * 5. Check aliases
   */
  private async resolveUserId(
    appUserId: string,
    event?: RevenueCatWebhookEvent
  ): Promise<number> {
    // Method 1: Try to parse app_user_id as numeric user ID
    const parsedId = parseInt(appUserId, 10);
    if (!isNaN(parsedId) && parsedId > 0) {
      const user = await userService.getUser(parsedId);
      if (user) {
        logger.debug("User resolved from app_user_id", {
          operation: "resolveUserId",
          method: "numeric_parse",
          userId: parsedId,
        });
        return parsedId;
      }
    }

    // Method 2: Check subscriber_attributes for user_id
    if (event?.subscriber_attributes) {
      const userIdAttr =
        event.subscriber_attributes["$userId"] ||
        event.subscriber_attributes["user_id"] ||
        event.subscriber_attributes["userId"];

      if (userIdAttr?.value) {
        const attrUserId = parseInt(userIdAttr.value, 10);
        if (!isNaN(attrUserId) && attrUserId > 0) {
          const user = await userService.getUser(attrUserId);
          if (user) {
            logger.debug("User resolved from subscriber_attributes", {
              operation: "resolveUserId",
              method: "subscriber_attributes",
              userId: attrUserId,
            });
            return attrUserId;
          }
        }
      }
    }

    // Method 3: Try to find by RevenueCat customer ID in database
    const subscription =
      await subscriptionService.findUserByRevenueCatCustomerId(appUserId);
    if (subscription) {
      logger.debug("User resolved from database lookup", {
        operation: "resolveUserId",
        method: "database_lookup",
        userId: subscription.userId,
      });
      return subscription.userId;
    }

    // Method 4: Check original_app_user_id if different from app_user_id
    if (
      event?.original_app_user_id &&
      event.original_app_user_id !== appUserId
    ) {
      const originalId = parseInt(event.original_app_user_id, 10);
      if (!isNaN(originalId) && originalId > 0) {
        const user = await userService.getUser(originalId);
        if (user) {
          logger.debug("User resolved from original_app_user_id", {
            operation: "resolveUserId",
            method: "original_app_user_id",
            userId: originalId,
          });
          return originalId;
        }
      }

      // Also try database lookup with original_app_user_id
      const origSubscription =
        await subscriptionService.findUserByRevenueCatCustomerId(
          event.original_app_user_id
        );
      if (origSubscription) {
        logger.debug(
          "User resolved from original_app_user_id database lookup",
          {
            operation: "resolveUserId",
            method: "original_app_user_id_db",
            userId: origSubscription.userId,
          }
        );
        return origSubscription.userId;
      }
    }

    // Method 5: Check aliases
    if (event?.aliases && event.aliases.length > 0) {
      for (const alias of event.aliases) {
        const aliasId = parseInt(alias, 10);
        if (!isNaN(aliasId) && aliasId > 0) {
          const user = await userService.getUser(aliasId);
          if (user) {
            logger.debug("User resolved from alias", {
              operation: "resolveUserId",
              method: "alias",
              userId: aliasId,
              alias,
            });
            return aliasId;
          }
        }
      }
    }

    // If all methods fail, throw error with helpful message
    const isAnonymous = appUserId.startsWith("$RCAnonymousID:");
    const errorMsg = isAnonymous
      ? `Anonymous user purchase detected. The mobile app should identify the user with RevenueCat before purchase. app_user_id: ${appUserId}`
      : `User not found for RevenueCat app_user_id: ${appUserId}. Ensure the mobile app calls Purchases.logIn(userId) before purchase.`;

    throw new Error(errorMsg);
  }

  /**
   * Parse timestamp from milliseconds or ISO string
   */
  private parseTimestamp(ms?: number, isoString?: string): Date | null {
    if (ms) {
      return new Date(ms);
    }
    if (isoString) {
      return new Date(isoString);
    }
    return null;
  }

  /**
   * Handle initial purchase - new subscription started
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - INITIAL_PURCHASE
   */
  private async handleInitialPurchase(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const productId = event.product_id;
    if (!productId) {
      throw new Error("Product ID required for initial purchase");
    }

    const purchasedAt = this.parseTimestamp(
      event.purchased_at_ms,
      event.purchased_at
    );
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    // Get subscription plan to validate product
    const plan =
      await subscriptionService.getPlanByRevenueCatProductId(productId);
    if (!plan) {
      logger.warn("Subscription plan not found for product", {
        operation: "handleInitialPurchase",
        productId,
        userId,
      });
      // Still create/update subscription but without plan reference
    }

    // Determine status based on period type
    // If it's a trial period, keep as trial; otherwise, set as active
    const status =
      event.period_type === "TRIAL"
        ? SubscriptionStatus.TRIAL
        : SubscriptionStatus.ACTIVE;

    await subscriptionService.updateUserSubscription(userId, {
      revenuecatCustomerId: event.app_user_id,
      revenuecatSubscriptionId: event.original_transaction_id || null,
      planId: plan?.planId || productId,
      status,
      subscriptionStartDate: purchasedAt,
      subscriptionEndDate: expiresAt,
    });

    logger.info("Initial purchase processed", {
      operation: "handleInitialPurchase",
      userId,
      productId,
      planId: plan?.planId,
      status,
      periodType: event.period_type,
      environment: event.environment,
    });
  }

  /**
   * Handle renewal - subscription renewed or lapsed user resubscribed
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - RENEWAL
   */
  private async handleRenewal(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const productId = event.product_id;
    const purchasedAt = this.parseTimestamp(
      event.purchased_at_ms,
      event.purchased_at
    );
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    // Get subscription plan
    const plan = productId
      ? await subscriptionService.getPlanByRevenueCatProductId(productId)
      : null;

    // Update subscription - set to active since they renewed
    await subscriptionService.updateUserSubscription(userId, {
      revenuecatCustomerId: event.app_user_id,
      revenuecatSubscriptionId: event.original_transaction_id || null,
      planId: plan?.planId || productId || null,
      status: SubscriptionStatus.ACTIVE,
      subscriptionStartDate: purchasedAt,
      subscriptionEndDate: expiresAt,
    });

    logger.info("Renewal processed", {
      operation: "handleRenewal",
      userId,
      productId,
      renewalNumber: event.renewal_number,
      isTrialConversion: event.is_trial_conversion,
      environment: event.environment,
    });
  }

  /**
   * Handle cancellation - subscription cancelled or refunded
   * Note: This doesn't immediately revoke access. EXPIRATION event handles that.
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - CANCELLATION
   */
  private async handleCancellation(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const cancelReason = event.cancel_reason;
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    // For refunds (CUSTOMER_SUPPORT), revoke access immediately
    if (cancelReason === "CUSTOMER_SUPPORT") {
      logger.warn("Subscription refunded", {
        operation: "handleCancellation",
        userId,
        cancelReason,
        originalTransactionId: event.original_transaction_id,
      });

      // Revoke immediately for refunds
      await subscriptionService.updateUserSubscription(userId, {
        status: SubscriptionStatus.CANCELLED,
        subscriptionEndDate: new Date(), // Revoke immediately
      });
    } else {
      // Regular cancellation - user cancelled but still has access until period end
      // Set status to CANCELLED but keep subscriptionEndDate so access continues
      await subscriptionService.updateUserSubscription(userId, {
        status: SubscriptionStatus.CANCELLED,
        subscriptionEndDate: expiresAt, // Keep expiration date for access check
      });

      logger.info(
        "Subscription cancelled (access continues until period end)",
        {
          operation: "handleCancellation",
          userId,
          cancelReason,
          expiresAt,
        }
      );
    }
  }

  /**
   * Handle uncancellation - cancelled subscription re-enabled before expiry
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - UNCANCELLATION
   */
  private async handleUncancellation(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    // User re-enabled their subscription before it expired
    // Restore active status and update expiration date
    await subscriptionService.updateUserSubscription(userId, {
      status: SubscriptionStatus.ACTIVE,
      subscriptionEndDate: expiresAt, // Update expiration date from event
    });

    logger.info("Subscription uncancelled", {
      operation: "handleUncancellation",
      userId,
      expiresAt,
      originalTransactionId: event.original_transaction_id,
    });
  }

  /**
   * Handle non-renewing purchase (e.g., consumable or lifetime)
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - NON_RENEWING_PURCHASE
   */
  private async handleNonRenewingPurchase(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const productId = event.product_id;
    const purchasedAt = this.parseTimestamp(
      event.purchased_at_ms,
      event.purchased_at
    );
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    const plan = productId
      ? await subscriptionService.getPlanByRevenueCatProductId(productId)
      : null;

    await subscriptionService.updateUserSubscription(userId, {
      revenuecatCustomerId: event.app_user_id,
      revenuecatSubscriptionId: event.original_transaction_id || null,
      planId: plan?.planId || productId || null,
      status: SubscriptionStatus.ACTIVE,
      subscriptionStartDate: purchasedAt,
      subscriptionEndDate: expiresAt,
    });

    logger.info("Non-renewing purchase processed", {
      operation: "handleNonRenewingPurchase",
      userId,
      productId,
    });
  }

  /**
   * Handle subscription paused (Play Store only)
   * Note: Don't revoke access here - wait for EXPIRATION event
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - SUBSCRIPTION_PAUSED
   */
  private async handleSubscriptionPaused(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    // The subscription will pause at end of period
    // User still has access until EXPIRATION event
    // We can optionally store the paused state for UI purposes

    const autoResumeAt = event.auto_resume_at_ms
      ? new Date(event.auto_resume_at_ms)
      : null;

    logger.info(
      "Subscription set to pause (access continues until period end)",
      {
        operation: "handleSubscriptionPaused",
        userId,
        autoResumeAt,
        originalTransactionId: event.original_transaction_id,
      }
    );
  }

  /**
   * Handle expiration - subscription expired, revoke access
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - EXPIRATION
   */
  private async handleExpiration(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const expirationReason = event.expiration_reason;
    const expiresAt =
      this.parseTimestamp(event.expiration_at_ms, event.expires_at) ||
      new Date(); // Use event expiration, fallback to now

    // Get current subscription to check if already cancelled
    const currentSubscription =
      await subscriptionService.getUserSubscription(userId);

    // Determine status based on expiration reason
    let status: SubscriptionStatus;

    // If already cancelled, keep it cancelled (don't change to EXPIRED)
    if (currentSubscription.status === SubscriptionStatus.CANCELLED) {
      status = SubscriptionStatus.CANCELLED;
    } else {
      switch (expirationReason) {
        case "SUBSCRIPTION_PAUSED":
          status = SubscriptionStatus.PAUSED;
          break;
        case "BILLING_ERROR":
          status = SubscriptionStatus.EXPIRED;
          break;
        case "UNSUBSCRIBE":
        case "DEVELOPER_INITIATED":
          status = SubscriptionStatus.CANCELLED;
          break;
        default:
          status = SubscriptionStatus.EXPIRED;
      }
    }

    await subscriptionService.updateUserSubscription(userId, {
      status,
      subscriptionEndDate: expiresAt, // Use event expiration timestamp
    });

    logger.info("Subscription expired", {
      operation: "handleExpiration",
      userId,
      status,
      expirationReason,
      expiresAt,
      originalTransactionId: event.original_transaction_id,
    });
  }

  /**
   * Handle billing issue - payment failed, user may be in grace period
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - BILLING_ISSUE
   */
  private async handleBillingIssue(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const gracePeriodExpiresAt = event.grace_period_expiration_at_ms
      ? new Date(event.grace_period_expiration_at_ms)
      : null;

    // Set user to grace period status - they still have access but payment failed
    // Store grace period expiration for access checks
    await subscriptionService.updateUserSubscription(userId, {
      status: SubscriptionStatus.GRACE_PERIOD,
      subscriptionEndDate: gracePeriodExpiresAt, // Store grace period expiration
    });

    logger.warn("Billing issue detected - user in grace period", {
      operation: "handleBillingIssue",
      userId,
      gracePeriodExpiresAt,
      originalTransactionId: event.original_transaction_id,
    });

    // TODO: Consider sending notification to user about payment issue
    // The EXPIRATION event with cancel_reason BILLING_ERROR will be sent
    // if grace period ends without payment recovery
  }

  /**
   * Handle product change - user switched subscription plans
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - PRODUCT_CHANGE
   */
  private async handleProductChange(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<void> {
    const newProductId = event.product_id;
    const expiresAt = this.parseTimestamp(
      event.expiration_at_ms,
      event.expires_at
    );

    const newPlan = newProductId
      ? await subscriptionService.getPlanByRevenueCatProductId(newProductId)
      : null;

    await subscriptionService.updateUserSubscription(userId, {
      planId: newPlan?.planId || newProductId || null,
      status: SubscriptionStatus.ACTIVE,
      subscriptionEndDate: expiresAt,
    });

    logger.info("Product change processed", {
      operation: "handleProductChange",
      userId,
      newProductId,
      newPlanId: newPlan?.planId,
    });
  }

  /**
   * Handle transfer - entitlements transferred between users
   * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields - TRANSFER
   */
  private async handleTransfer(event: RevenueCatWebhookEvent): Promise<void> {
    const transferredFrom = event.transferred_from || [];
    const transferredTo = event.transferred_to || [];

    logger.info("Subscription transfer processed", {
      operation: "handleTransfer",
      transferredFrom,
      transferredTo,
    });

    // Revoke access from old users
    for (const fromUserId of transferredFrom) {
      try {
        const userId = await this.resolveUserId(fromUserId);
        await subscriptionService.updateUserSubscription(userId, {
          status: SubscriptionStatus.EXPIRED,
          subscriptionEndDate: new Date(),
        });
        logger.info("Access revoked from transferred user", {
          operation: "handleTransfer",
          userId,
          fromUserId,
        });
      } catch (error) {
        logger.warn("Could not revoke access from transferred user", {
          operation: "handleTransfer",
          fromUserId,
          error: (error as Error).message,
        });
      }
    }

    // Note: The receiving user will get an INITIAL_PURCHASE or RENEWAL event
    // so we don't need to grant access here
  }
}
