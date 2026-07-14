/**
 * P3 seeding — bring existing users onto the ai_operations ledger before the
 * subscription redesign goes live.
 *
 * WHY: resolveGenerationType() decides INITIAL_PLAN vs NEW_PROGRAM from LEDGER
 * truth, not workout-row existence. Existing users have workouts but no ledger
 * rows, so without this they'd be treated as "never used their free initial
 * plan" and handed an extra free generation. This back-fills one completed
 * INITIAL_PLAN op per user who already has a real plan.
 *
 * Also (optional): classify dev/admin -> BYPASS and testers -> COMPLIMENTARY
 * via user_subscriptions.access_override (fill in the email lists below).
 *
 * Idempotent: safe to re-run (skips users who already have a consuming
 * INITIAL_PLAN op). Preview with --dry-run.
 *
 *   Local:  npx tsx src/scripts/seed-initial-plan-ledger.ts --dry-run
 *           npx tsx src/scripts/seed-initial-plan-ledger.ts
 *   Prod:   DATABASE_URL="<neon-url>" npx tsx src/scripts/seed-initial-plan-ledger.ts --dry-run
 *           DATABASE_URL="<neon-url>" npx tsx src/scripts/seed-initial-plan-ledger.ts
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users } from "@/models/user.schema";
import { workouts } from "@/models/workout.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { aiOperations } from "@/models/ai-operations.schema";
import {
  AccessTier,
  AccessOverride,
  AiOperationType,
  AiOperationStatus,
} from "@/constants/access-policy";

// --- OPTIONAL: fill these in for account classification ----------------------
const BYPASS_EMAILS: string[] = []; // dev / admin accounts
const COMPLIMENTARY_EMAILS: string[] = []; // invited testers / reviewers / demo
// -----------------------------------------------------------------------------

const CONSUMING = [AiOperationStatus.RESERVED, AiOperationStatus.COMPLETED];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(
    `\nseed-initial-plan-ledger — db host: ${host} — ${dryRun ? "DRY RUN (no writes)" : "APPLYING"}\n`
  );

  // 1) INITIAL_PLAN back-fill for every user who already has a workout.
  const userRows = await db
    .selectDistinct({ userId: workouts.userId })
    .from(workouts);
  console.log(`Users with >=1 workout: ${userRows.length}`);

  let seeded = 0;
  let skipped = 0;
  for (const { userId } of userRows) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiOperations)
      .where(
        and(
          eq(aiOperations.userId, userId),
          eq(aiOperations.operationType, AiOperationType.INITIAL_PLAN),
          inArray(aiOperations.status, CONSUMING)
        )
      );
    if (n > 0) {
      skipped++;
      continue;
    }

    const [firstWorkout] = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.userId, userId))
      .orderBy(asc(workouts.id))
      .limit(1);

    if (dryRun) {
      console.log(
        `  would seed INITIAL_PLAN for user ${userId} (resultWorkoutId=${firstWorkout?.id})`
      );
      seeded++;
      continue;
    }

    await db.insert(aiOperations).values({
      userId,
      operationType: AiOperationType.INITIAL_PLAN,
      status: AiOperationStatus.COMPLETED,
      // Deterministic key → re-runs can't create a duplicate.
      idempotencyKey: `seed:initial:${userId}`,
      accessTierAtRequest: AccessTier.FREE, // historically claimed as a free user
      countedAgainstFreeAllowance: true, // consumed their 1 free initial plan
      resultWorkoutId: firstWorkout?.id ?? null,
      completedAt: new Date(),
    });
    seeded++;
  }
  console.log(`INITIAL_PLAN: seeded ${seeded}, skipped ${skipped} (already present)\n`);

  // 2) Optional access-tier classification.
  await classify(BYPASS_EMAILS, AccessTier.BYPASS, dryRun);
  await classify(COMPLIMENTARY_EMAILS, AccessTier.COMPLIMENTARY, dryRun);

  console.log("Done.");
}

async function classify(
  emails: string[],
  tier: AccessOverride,
  dryRun: boolean
) {
  for (const email of emails) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!u) {
      console.log(`  [${tier}] no user for ${email} — skipped`);
      continue;
    }
    if (dryRun) {
      console.log(`  [${tier}] would set access_override for ${email} (user ${u.id})`);
      continue;
    }
    // getUserSubscription creates a trial row on first access; ensure it exists.
    await db
      .update(userSubscriptions)
      .set({ accessOverride: tier, accessOverrideExpiresAt: null })
      .where(eq(userSubscriptions.userId, u.id));
    console.log(`  [${tier}] set access_override for ${email} (user ${u.id})`);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
