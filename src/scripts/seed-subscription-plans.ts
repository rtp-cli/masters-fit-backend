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
        priceUsd: 6.99, // $6.99
        isActive: true,
      },
      {
        planId: "masters_fit_annual",
        name: "Annual Premium",
        description: "Unlimited workouts and regenerations",
        billingPeriod: BillingPeriod.ANNUAL,
        priceUsd: 49.99, // $49.99
        isActive: true,
      },
    ];

    for (const plan of plans) {
      // Check if plan already exists
      const existing = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.planId, plan.planId),
      });

      if (existing) {
        // Upsert: converge the existing row to the desired config (price, name,
        // etc.) rather than skipping. Makes re-running the seed the canonical way
        // to sync plan changes — the old skip-if-exists silently left stale prices.
        await db
          .update(subscriptionPlans)
          .set({
            name: plan.name,
            description: plan.description,
            billingPeriod: plan.billingPeriod,
            priceUsd: plan.priceUsd,
            isActive: plan.isActive,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionPlans.planId, plan.planId));

        logger.info("Subscription plan updated", {
          operation: "seedSubscriptionPlans",
          metadata: { planId: plan.planId, priceUsd: plan.priceUsd },
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
