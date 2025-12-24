/**
 * Seed script for subscription plans
 * Run this script to populate the subscription_plans table with monthly and annual plans
 *
 * Usage: tsx src/scripts/seed-subscription-plans.ts
 */

import { db } from "@/config/database";
import { subscriptionPlans } from "@/models/subscription.schema";
import { BillingPeriod } from "@/constants";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger";

async function seedSubscriptionPlans() {
  try {
    logger.info("Starting subscription plans seed", {
      operation: "seedSubscriptionPlans",
    });

    const plans = [
      {
        planId: "masters_fit_monthly",
        name: "Monthly Premium",
        description: "Unlimited workouts and regenerations",
        billingPeriod: BillingPeriod.MONTHLY,
        priceUsd: 9.99, // $9.99
        isActive: true,
      },
      {
        planId: "masters_fit_annual",
        name: "Annual Premium",
        description: "Unlimited workouts and regenerations",
        billingPeriod: BillingPeriod.ANNUAL,
        priceUsd: 79.99, // $79.99
        isActive: true,
      },
    ];

    for (const plan of plans) {
      // Check if plan already exists
      const existing = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.planId, plan.planId),
      });

      if (existing) {
        logger.info("Subscription plan already exists, skipping", {
          operation: "seedSubscriptionPlans",
          metadata: { planId: plan.planId },
        });
        continue;
      }

      // Insert plan
      await db.insert(subscriptionPlans).values(plan);

      logger.info("Subscription plan created", {
        operation: "seedSubscriptionPlans",
        metadata: { planId: plan.planId, name: plan.name },
      });
    }

    logger.info("Subscription plans seed completed successfully", {
      operation: "seedSubscriptionPlans",
    });

    process.exit(0);
  } catch (error) {
    logger.error("Subscription plans seed failed", error as Error, {
      operation: "seedSubscriptionPlans",
    });
    process.exit(1);
  }
}

// Run the seed function
seedSubscriptionPlans();
