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
} from "@tsoa/runtime";
import { subscriptionService } from "@/services/subscription.service";
import { SubscriptionStatus } from "@/constants";
import { RevenueCatWebhookPayload } from "@/types/subscription/requests";
import { SubscriptionPlansResponse } from "@/types/subscription/responses";
import { logger } from "@/utils/logger";
import { userService } from "@/services/user.service";

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
   */
  @Post("/webhooks/revenuecat")
  @SuccessResponse(200, "Webhook processed successfully")
  @Response(401, "Unauthorized - Invalid signature")
  @Response(400, "Bad Request")
  public async handleRevenueCatWebhook(
    @Request() request: any,
    @Body() payload: RevenueCatWebhookPayload
  ): Promise<{ success: boolean; message: string }> {
    try {
      // TODO: Verify RevenueCat signature
      // const signature = request.headers['authorization'];
      // if (!verifyRevenueCatSignature(payload, signature)) {
      //   this.setStatus(401);
      //   return { success: false, message: "Invalid signature" };
      // }

      const event = payload.event;
      const eventId = event.id;
      const eventType = event.type;

      logger.info("RevenueCat webhook received", {
        operation: "handleRevenueCatWebhook",
        eventId,
        eventType,
        appUserId: event.app_user_id,
      });

      // Check idempotency - if event already processed, return success
      const isProcessed =
        await subscriptionService.isWebhookEventProcessed(eventId);
      if (isProcessed) {
        logger.info("Webhook event already processed", {
          operation: "handleRevenueCatWebhook",
          eventId,
          eventType,
        });
        return { success: true, message: "Event already processed" };
      }

      // Process the event
      await this.processWebhookEvent(event);

      // Mark event as processed
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
      });

      this.setStatus(500);
      return {
        success: false,
        message: (error as Error).message || "Internal server error",
      };
    }
  }

  /**
   * Process webhook event based on type
   */
  private async processWebhookEvent(
    event: RevenueCatWebhookPayload["event"]
  ): Promise<void> {
    const eventType = event.type;
    const appUserId = event.app_user_id;

    // Find user by RevenueCat customer ID
    // Note: app_user_id should match our user ID or we need a mapping
    // For now, assuming app_user_id is the user ID
    let userId: number;
    try {
      userId = parseInt(appUserId);
      if (isNaN(userId)) {
        // Try to find by RevenueCat customer ID
        const subscription =
          await subscriptionService.findUserByRevenueCatCustomerId(appUserId);
        if (!subscription) {
          throw new Error(
            `User not found for RevenueCat customer ID: ${appUserId}`
          );
        }
        userId = subscription.userId;
      }
    } catch (error) {
      throw new Error(`Invalid user ID: ${appUserId}`);
    }

    // Verify user exists
    const user = await userService.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
        await this.handleSubscriptionActivated(event, userId);
        break;

      case "CANCELLATION":
        await this.handleSubscriptionCancelled(event, userId);
        break;

      case "EXPIRATION":
        await this.handleSubscriptionExpired(event, userId);
        break;

      case "BILLING_ISSUE":
        await this.handleBillingIssue(event, userId);
        break;

      default:
        logger.warn("Unknown webhook event type", {
          operation: "processWebhookEvent",
          eventType,
          userId,
        });
    }
  }

  /**
   * Handle subscription activation (initial purchase or renewal)
   */
  private async handleSubscriptionActivated(
    event: RevenueCatWebhookPayload["event"],
    userId: number
  ): Promise<void> {
    const productId = event.product_id;
    const subscriptionId = event.subscription_id || null;
    const purchasedAt = event.purchased_at
      ? new Date(event.purchased_at)
      : new Date();
    const expiresAt = event.expires_at ? new Date(event.expires_at) : null;

    // Get subscription plan
    const plan =
      await subscriptionService.getPlanByRevenueCatProductId(productId);
    if (!plan) {
      throw new Error(`Subscription plan not found: ${productId}`);
    }

    // Update or create subscription
    const subscription = await subscriptionService.getUserSubscription(userId);

    await subscriptionService.updateUserSubscription(userId, {
      revenuecatCustomerId: event.app_user_id,
      revenuecatSubscriptionId: subscriptionId,
      planId: plan.planId,
      status: SubscriptionStatus.ACTIVE,
      subscriptionStartDate: purchasedAt,
      subscriptionEndDate: expiresAt,
    });

    logger.info("Subscription activated", {
      operation: "handleSubscriptionActivated",
      userId,
      planId: plan.planId,
    });
  }

  /**
   * Handle subscription cancellation
   */
  private async handleSubscriptionCancelled(
    event: RevenueCatWebhookPayload["event"],
    userId: number
  ): Promise<void> {
    const subscriptionId = event.subscription_id;
    if (!subscriptionId) {
      throw new Error("Subscription ID required for cancellation");
    }

    // Find subscription by RevenueCat subscription ID
    const subscription =
      await subscriptionService.findSubscriptionByRevenueCatSubscriptionId(
        subscriptionId
      );
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Update subscription - cancellation doesn't immediately change status
    // Status will change to 'cancelled' when it expires
    // For now, we just log it - RevenueCat will send EXPIRATION event when period ends
    logger.info("Subscription cancelled", {
      operation: "handleSubscriptionCancelled",
      userId,
      subscriptionId,
    });
  }

  /**
   * Handle subscription expiration
   */
  private async handleSubscriptionExpired(
    event: RevenueCatWebhookPayload["event"],
    userId: number
  ): Promise<void> {
    const subscriptionId = event.subscription_id;
    if (!subscriptionId) {
      throw new Error("Subscription ID required for expiration");
    }

    // Find subscription by RevenueCat subscription ID
    const subscription =
      await subscriptionService.findSubscriptionByRevenueCatSubscriptionId(
        subscriptionId
      );
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Set status to expired or cancelled based on whether it was cancelled
    // For simplicity, we'll set to expired - can be enhanced later
    await subscriptionService.updateUserSubscription(userId, {
      status: SubscriptionStatus.EXPIRED,
    });

    logger.info("Subscription expired", {
      operation: "handleSubscriptionExpired",
      userId,
      subscriptionId,
    });
  }

  /**
   * Handle billing issue
   */
  private async handleBillingIssue(
    event: RevenueCatWebhookPayload["event"],
    userId: number
  ): Promise<void> {
    logger.warn("Billing issue detected", {
      operation: "handleBillingIssue",
      userId,
      appUserId: event.app_user_id,
    });

    // For now, just log - can be enhanced to notify user or take action
  }
}
