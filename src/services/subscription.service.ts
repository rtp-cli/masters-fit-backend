import { eq, and, asc, gte, lte, isNull, sql } from "drizzle-orm";
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
} from "@/models/subscription.schema";
import { users } from "@/models/user.schema";
import { BaseService } from "@/services/base.service";
import { logger } from "@/utils/logger";
import { getCurrentUTCDate } from "@/utils/date.utils";
import {
  AccessLevel,
  BillingPeriod,
  RENEWAL_REMINDER_DAYS,
  RENEWAL_REMINDER_FALLBACK_DAYS,
  SubscriptionStatus,
} from "@/constants";
import type { AccessOverride } from "@/constants/access-policy";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A subscription due for a renewal-reminder email, with the data the email needs. */
export interface RenewalReminderCandidate {
  subscriptionId: number;
  userId: number;
  email: string;
  name: string;
  billingPeriod: BillingPeriod | null;
  priceUsd: number | null;
  subscriptionEndDate: Date;
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

        // Create trial usage record proactively for consistency
        await this.getTrialUsage(userId);

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
            accessOverride: updates.accessOverride as
              | AccessOverride
              | null
              | undefined,
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
   * Subscriptions whose auto-renewal is close enough to warrant a reminder email
   * and that haven't been reminded for this billing period yet.
   *
   * Only ACTIVE subs qualify: CANCELLED means auto-renew is off (they already
   * know it's ending), and comped users (accessOverride set) are never charged.
   * We fetch the widest lead-time window in SQL, then narrow per billing period
   * in JS (annual 7d / monthly 3d), so the query stays simple. Plan (hence
   * billing period + price) is a LEFT join — a plan miss still gets a reminder
   * at the fallback lead time, just without the price line.
   */
  async getRenewalReminderCandidates(
    now: Date
  ): Promise<RenewalReminderCandidate[]> {
    const maxWindowDays = Math.max(
      RENEWAL_REMINDER_DAYS[BillingPeriod.ANNUAL],
      RENEWAL_REMINDER_DAYS[BillingPeriod.MONTHLY],
      RENEWAL_REMINDER_FALLBACK_DAYS
    );
    const windowEnd = new Date(now.getTime() + maxWindowDays * MS_PER_DAY);

    const rows = await this.db
      .select({
        subscriptionId: userSubscriptions.id,
        userId: userSubscriptions.userId,
        email: users.email,
        name: users.name,
        billingPeriod: subscriptionPlans.billingPeriod,
        priceUsd: subscriptionPlans.priceUsd,
        subscriptionEndDate: userSubscriptions.subscriptionEndDate,
      })
      .from(userSubscriptions)
      .innerJoin(users, eq(users.id, userSubscriptions.userId))
      .leftJoin(
        subscriptionPlans,
        eq(subscriptionPlans.planId, userSubscriptions.planId)
      )
      .where(
        and(
          eq(userSubscriptions.status, SubscriptionStatus.ACTIVE),
          isNull(userSubscriptions.accessOverride),
          gte(userSubscriptions.subscriptionEndDate, now),
          lte(userSubscriptions.subscriptionEndDate, windowEnd),
          // Not already reminded for this exact renewal date (null = never).
          sql`${userSubscriptions.renewalReminderForPeriodEnd} IS DISTINCT FROM ${userSubscriptions.subscriptionEndDate}`
        )
      );

    return rows
      .filter(
        (r): r is typeof r & { subscriptionEndDate: Date } =>
          r.subscriptionEndDate != null
      )
      .filter((r) => {
        const period = r.billingPeriod as BillingPeriod | null;
        const leadDays =
          (period && RENEWAL_REMINDER_DAYS[period]) ??
          RENEWAL_REMINDER_FALLBACK_DAYS;
        const sendFrom = new Date(
          r.subscriptionEndDate.getTime() - leadDays * MS_PER_DAY
        );
        return now >= sendFrom;
      })
      .map((r) => ({
        subscriptionId: r.subscriptionId,
        userId: r.userId,
        email: r.email,
        name: r.name,
        billingPeriod: (r.billingPeriod as BillingPeriod | null) ?? null,
        priceUsd: r.priceUsd != null ? Number(r.priceUsd) : null,
        subscriptionEndDate: r.subscriptionEndDate,
      }));
  }

  /**
   * Atomically claim a subscription's renewal reminder before sending. The
   * UPDATE only matches if the row is still ACTIVE, still has this exact
   * period-end, and hasn't already been claimed for it — so under concurrent
   * instances exactly one worker's UPDATE returns a row and gets to send. The
   * loser matches zero rows. Returns true iff this caller won the claim.
   */
  async claimRenewalReminder(
    subscriptionId: number,
    periodEnd: Date
  ): Promise<boolean> {
    const [claimed] = await this.db
      .update(userSubscriptions)
      .set({
        renewalReminderSentAt: getCurrentUTCDate(),
        renewalReminderForPeriodEnd: periodEnd,
        updatedAt: getCurrentUTCDate(),
      })
      .where(
        and(
          eq(userSubscriptions.id, subscriptionId),
          eq(userSubscriptions.status, SubscriptionStatus.ACTIVE),
          eq(userSubscriptions.subscriptionEndDate, periodEnd),
          sql`${userSubscriptions.renewalReminderForPeriodEnd} IS DISTINCT FROM ${periodEnd}`
        )
      )
      .returning({ id: userSubscriptions.id });

    return !!claimed;
  }

  /**
   * Undo a claim when the email send fails, so a later run can retry. Guarded on
   * the period-end so we never clobber a claim a concurrent renewal has moved on.
   */
  async releaseRenewalReminderClaim(
    subscriptionId: number,
    periodEnd: Date
  ): Promise<void> {
    await this.db
      .update(userSubscriptions)
      .set({
        renewalReminderSentAt: null,
        renewalReminderForPeriodEnd: null,
        updatedAt: getCurrentUTCDate(),
      })
      .where(
        and(
          eq(userSubscriptions.id, subscriptionId),
          eq(userSubscriptions.renewalReminderForPeriodEnd, periodEnd)
        )
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
