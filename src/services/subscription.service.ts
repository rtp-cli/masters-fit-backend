import { eq, and, asc } from "drizzle-orm";
import {
  subscriptionPlans,
  userSubscriptions,
  trialUsage,
  webhookEvents,
  UserSubscription,
  TrialUsage,
  InsertUserSubscription,
  InsertTrialUsage,
  UpdateUserSubscription,
  UpdateTrialUsage,
} from "@/models/subscription.schema";
import { BaseService } from "@/services/base.service";
import { logger } from "@/utils/logger";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { AccessLevel, TRIAL_LIMITS, SubscriptionStatus } from "@/constants";

export interface TrialLimitCheck {
  allowed: boolean;
  reason?: string;
  limits?: {
    weeklyGenerations: { used: number; limit: number };
    dailyRegenerations: { used: number; limit: number };
    tokens: { used: number; limit: number };
  };
}

export class SubscriptionService extends BaseService {
  /**
   * Get user subscription or create trial if none exists
   */
  async getUserSubscription(userId: number): Promise<UserSubscription> {
    return this.executeWithRetry(
      async () => {
        let subscription = await this.db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.userId, userId),
        });

        if (!subscription) {
          // Create default trial subscription
          subscription = await this.createTrialSubscription(userId);
        }

        return subscription;
      },
      { operation: "getUserSubscription", userId }
    );
  }

  /**
   * Create a trial subscription for a user
   */
  async createTrialSubscription(userId: number): Promise<UserSubscription> {
    return this.executeWithRetry(
      async () => {
        const trialData = {
          userId,
          status: SubscriptionStatus.TRIAL,
          revenuecatCustomerId: null,
          revenuecatSubscriptionId: null,
          planId: null,
          subscriptionStartDate: null,
          subscriptionEndDate: null,
        } satisfies InsertUserSubscription;

        const [subscription] = await this.db
          .insert(userSubscriptions)
          .values(trialData)
          .returning();

        logger.info("Trial subscription created", {
          operation: "createTrialSubscription",
          metadata: { userId, subscriptionId: subscription.id },
        });

        return subscription;
      },
      { operation: "createTrialSubscription", userId }
    );
  }

  /**
   * Get effective access level for a user
   */
  async getEffectiveAccessLevel(userId: number): Promise<AccessLevel> {
    const subscription = await this.getUserSubscription(userId);

    // Active subscribers have unlimited access
    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return AccessLevel.UNLIMITED;
    }

    // Grace period users: check if still within grace period
    if (subscription.status === SubscriptionStatus.GRACE_PERIOD) {
      const now = new Date();
      const gracePeriodEnd = subscription.subscriptionEndDate;

      // If no grace period end date or expired, block access
      if (!gracePeriodEnd || gracePeriodEnd <= now) {
        return AccessLevel.BLOCKED;
      }

      // Still within grace period - grant unlimited access
      return AccessLevel.UNLIMITED;
    }

    // Cancelled subscriptions: check if still within access period
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      const now = new Date();
      const expirationDate = subscription.subscriptionEndDate;

      // If no expiration date or expired, block access
      if (!expirationDate || expirationDate <= now) {
        return AccessLevel.BLOCKED;
      }

      // Still within access period - grant unlimited access
      return AccessLevel.UNLIMITED;
    }

    // Trial users have limited access
    if (subscription.status === SubscriptionStatus.TRIAL) {
      return AccessLevel.TRIAL;
    }

    // Expired, paused, or other statuses are blocked
    return AccessLevel.BLOCKED;
  }

  /**
   * Get or create trial usage record
   */
  async getTrialUsage(userId: number): Promise<TrialUsage> {
    return this.executeWithRetry(
      async () => {
        let usage = await this.db.query.trialUsage.findFirst({
          where: eq(trialUsage.userId, userId),
        });

        if (!usage) {
          const usageData: InsertTrialUsage = {
            userId,
            weeklyGenerationsCount: 0,
            dailyRegenerationsCount: 0,
            tokensUsed: 0,
          };

          const [newUsage] = await this.db
            .insert(trialUsage)
            .values(usageData)
            .returning();

          return newUsage;
        }

        // Note: dailyRegenerationsCount is a LIFETIME limit (5 total day-plan regenerations)
        // It does NOT reset daily - it's a cumulative count that never resets automatically
        return usage;
      },
      { operation: "getTrialUsage", userId }
    );
  }

  /**
   * Note: Weekly generations are tracked as a LIFETIME limit (2 total weekly plan generations)
   * The count is stored in trial_usage.weeklyGenerationsCount and never resets automatically
   */

  /**
   * Check trial limits before allowing operation
   * For regenerations: Uses OR logic - if ANY limit (weekly, daily, or tokens) is exceeded, user is blocked
   * For generations: Only checks token limit
   */
  async checkTrialLimits(
    userId: number,
    operation: "generation" | "regeneration",
    estimatedTokens: number = 0,
    scope: "weekly" | "daily" = "weekly"
  ): Promise<TrialLimitCheck> {
    const usage = await this.getTrialUsage(userId);

    const limits = {
      weeklyGenerations: {
        used: usage.weeklyGenerationsCount,
        limit: TRIAL_LIMITS.WEEKLY_GENERATIONS,
      },
      dailyRegenerations: {
        used: usage.dailyRegenerationsCount,
        limit: TRIAL_LIMITS.DAILY_REGENERATIONS,
      },
      tokens: {
        used: usage.tokensUsed,
        limit: TRIAL_LIMITS.TOKEN_CAP,
      },
    };

    // For generations: only check token limit
    if (operation === "generation") {
      if (usage.tokensUsed + estimatedTokens > TRIAL_LIMITS.TOKEN_CAP) {
        return {
          allowed: false,
          reason: "Token limit exceeded",
          limits,
        };
      }
      return {
        allowed: true,
        limits,
      };
    }

    // For regenerations: Check ALL three limits with OR logic
    // Check weekly limit, daily limit, AND token limit - if ANY is exceeded, block
    const exceededLimits: string[] = [];

    // Check weekly regeneration limit (applies to all regenerations)
    if (usage.weeklyGenerationsCount >= TRIAL_LIMITS.WEEKLY_GENERATIONS) {
      exceededLimits.push("weekly");
    }

    // Check daily regeneration limit (applies to all regenerations)
    if (usage.dailyRegenerationsCount >= TRIAL_LIMITS.DAILY_REGENERATIONS) {
      exceededLimits.push("daily");
    }

    // Check token limit (applies to all regenerations)
    if (usage.tokensUsed + estimatedTokens > TRIAL_LIMITS.TOKEN_CAP) {
      exceededLimits.push("tokens");
    }

    // If ANY limit is exceeded, block the user
    if (exceededLimits.length > 0) {
      // Determine the primary reason based on which limits are exceeded
      let reason: string;
      if (exceededLimits.includes("tokens")) {
        reason = "Token limit exceeded";
      } else if (exceededLimits.includes("weekly")) {
        reason = "Weekly plan regeneration limit exceeded (2 total lifetime)";
      } else if (exceededLimits.includes("daily")) {
        reason = "Day-plan regeneration limit exceeded (5 total lifetime)";
      } else {
        reason = "Trial limit exceeded";
      }

      // If multiple limits are exceeded, mention all of them
      if (exceededLimits.length > 1) {
        const limitNames = exceededLimits.map((limit) => {
          if (limit === "weekly") return "weekly regenerations";
          if (limit === "daily") return "daily regenerations";
          return "tokens";
        });
        reason = `Trial limits exceeded: ${limitNames.join(", ")}. Subscribe to continue.`;
      }

      return {
        allowed: false,
        reason,
        limits,
      };
    }

    return {
      allowed: true,
      limits,
    };
  }

  /**
   * Increment trial usage after operation
   */
  async incrementTrialUsage(
    userId: number,
    operation: "generation" | "regeneration",
    tokensUsed: number,
    scope: "weekly" | "daily" = "weekly"
  ): Promise<void> {
    await this.executeWithRetry(
      async () => {
        const usage = await this.getTrialUsage(userId);
        const now = getCurrentUTCDate();

        const updateData: UpdateTrialUsage = {
          tokensUsed: usage.tokensUsed + tokensUsed,
          updatedAt: now,
        };

        if (operation === "regeneration") {
          if (scope === "weekly") {
            updateData.weeklyGenerationsCount =
              usage.weeklyGenerationsCount + 1;
          } else {
            updateData.dailyRegenerationsCount =
              usage.dailyRegenerationsCount + 1;
          }
        }

        await this.db
          .update(trialUsage)
          .set(updateData)
          .where(eq(trialUsage.userId, userId));

        logger.info("Trial usage incremented", {
          operation: "incrementTrialUsage",
          metadata: {
            userId,
            operation,
            tokensUsed,
            newTotalTokens: updateData.tokensUsed,
          },
        });
      },
      { operation: "incrementTrialUsage", userId }
    );
  }

  /**
   * Get subscription plan by RevenueCat product ID
   */
  async getPlanByRevenueCatProductId(
    productId: string
  ): Promise<typeof subscriptionPlans.$inferSelect | null> {
    return this.executeWithRetry(
      async () => {
        const plan = await this.db.query.subscriptionPlans.findFirst({
          where: eq(subscriptionPlans.planId, productId),
        });

        return plan || null;
      },
      { operation: "getPlanByRevenueCatProductId" }
    );
  }

  /**
   * Get all active subscription plans
   */
  async getActiveSubscriptionPlans(): Promise<
    (typeof subscriptionPlans.$inferSelect)[]
  > {
    return this.executeWithRetry(
      async () => {
        const plans = await this.db.query.subscriptionPlans.findMany({
          where: eq(subscriptionPlans.isActive, true),
        });

        // Sort by price ascending
        plans.sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd));

        return plans;
      },
      { operation: "getActiveSubscriptionPlans" }
    );
  }

  /**
   * Update user subscription from webhook
   */
  async updateUserSubscription(
    userId: number,
    updates: UpdateUserSubscription
  ): Promise<UserSubscription> {
    return this.executeWithRetry(
      async () => {
        const [updated] = await this.db
          .update(userSubscriptions)
          .set({
            ...updates,
            status: updates.status as SubscriptionStatus | undefined,
            updatedAt: getCurrentUTCDate(),
          })
          .where(eq(userSubscriptions.userId, userId))
          .returning();

        if (!updated) {
          throw new Error(`Subscription not found for user ${userId}`);
        }

        logger.info("User subscription updated", {
          operation: "updateUserSubscription",
          metadata: { userId },
        });

        return updated;
      },
      { operation: "updateUserSubscription", userId }
    );
  }

  /**
   * Check if webhook event was already processed
   */
  async isWebhookEventProcessed(eventId: string): Promise<boolean> {
    const event = await this.db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.eventId, eventId),
    });

    return !!event;
  }

  /**
   * Mark webhook event as processed
   */
  async markWebhookEventProcessed(
    eventId: string,
    eventType: string,
    payload: string
  ): Promise<void> {
    await this.db.insert(webhookEvents).values({
      eventId,
      eventType,
      payload,
      processedAt: getCurrentUTCDate(),
    });
  }

  /**
   * Find user by RevenueCat customer ID
   */
  async findUserByRevenueCatCustomerId(
    customerId: string
  ): Promise<UserSubscription | null> {
    return this.executeWithRetry(
      async () => {
        const subscription = await this.db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.revenuecatCustomerId, customerId),
        });

        return subscription || null;
      },
      { operation: "findUserByRevenueCatCustomerId" }
    );
  }

  /**
   * Find subscription by RevenueCat subscription ID
   */
  async findSubscriptionByRevenueCatSubscriptionId(
    subscriptionId: string
  ): Promise<UserSubscription | null> {
    return this.executeWithRetry(
      async () => {
        const subscription = await this.db.query.userSubscriptions.findFirst({
          where: eq(userSubscriptions.revenuecatSubscriptionId, subscriptionId),
        });

        return subscription || null;
      },
      { operation: "findSubscriptionByRevenueCatSubscriptionId" }
    );
  }
}

export const subscriptionService = new SubscriptionService();
