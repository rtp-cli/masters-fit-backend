/**
 * Reset a user's trial usage, mark account active, and set subscription status to active.
 *
 * Usage: npm run reset-user-trial -- --email rtp+4@mastersfit.ai
 *
 * Note: This bypasses the backend generation paywall but does NOT grant a RevenueCat
 * entitlement, so the dashboard upgrade banner will still show.
 */

import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { trialUsage, userSubscriptions } from "@/models/subscription.schema";
import { SubscriptionStatus } from "@/constants";
import { eq } from "drizzle-orm";

const email = (() => {
  const idx = process.argv.indexOf("--email");
  return idx !== -1 ? process.argv[idx + 1] : undefined;
})();

if (!email) {
  console.error("Usage: npm run reset-user-trial -- --email <email>");
  process.exit(1);
}

async function run() {
  const user = await db.query.users.findFirst({ where: eq(users.email, email!) });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  console.log(`Found user id=${user.id} email=${user.email} isActive=${user.isActive}`);

  await db.update(users).set({ isActive: true }).where(eq(users.id, user.id));
  console.log("  ✓ is_active = true");

  const usage = await db.query.trialUsage.findFirst({ where: eq(trialUsage.userId, user.id) });
  if (usage) {
    await db
      .update(trialUsage)
      .set({ tokensUsed: 0, weeklyGenerationsCount: 0, dailyRegenerationsCount: 0 })
      .where(eq(trialUsage.userId, user.id));
    console.log("  ✓ tokens_used, weekly_generations_count, daily_regenerations_count = 0");
  } else {
    console.log("  — no trial_usage record found, skipping reset");
  }

  const sub = await db.query.userSubscriptions.findFirst({ where: eq(userSubscriptions.userId, user.id) });
  if (sub) {
    await db
      .update(userSubscriptions)
      .set({ status: SubscriptionStatus.ACTIVE, subscriptionStartDate: new Date(), subscriptionEndDate: null })
      .where(eq(userSubscriptions.userId, user.id));
    console.log("  ✓ subscription status = active");
  } else {
    await db.insert(userSubscriptions).values({
      userId: user.id,
      status: SubscriptionStatus.ACTIVE,
      subscriptionStartDate: new Date(),
    });
    console.log("  ✓ subscription record created with status = active");
  }

  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
