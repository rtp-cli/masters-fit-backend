/**
 * One-off: grant COMPLIMENTARY access to a single user by email.
 * Mirrors classify() in seed-initial-plan-ledger.ts WITHOUT the ledger backfill.
 *
 *   Preview: DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> --dry-run
 *   Apply:   DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email>
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users } from "@/models/user.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { AccessTier } from "@/constants/access-policy";

async function main() {
  const email = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!email || email.startsWith("--")) {
    console.error("Usage: grant-comp-single.ts <email> [--dry-run]");
    process.exit(1);
  }
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\ngrant-comp-single — db host: ${host} — ${dryRun ? "DRY RUN" : "APPLYING"}\n`);

  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) {
    console.log(`  no user for ${email} — nothing to do`);
    return;
  }

  const [sub] = await db
    .select({
      id: userSubscriptions.id,
      status: userSubscriptions.status,
      accessOverride: userSubscriptions.accessOverride,
      accessOverrideExpiresAt: userSubscriptions.accessOverrideExpiresAt,
    })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, u.id))
    .limit(1);

  console.log(`  user ${u.id} (${u.email})`);
  console.log(`  current subscription row:`, sub ?? "NONE");

  if (!sub) {
    console.log(
      `\n  ⚠️  No user_subscriptions row — an UPDATE would match nothing. Have her open the app once, then re-run.\n`
    );
    return;
  }

  if (dryRun) {
    console.log(`\n  would set access_override = COMPLIMENTARY (no expiry) for user ${u.id}\n`);
    return;
  }

  const updated = await db
    .update(userSubscriptions)
    .set({ accessOverride: AccessTier.COMPLIMENTARY, accessOverrideExpiresAt: null })
    .where(eq(userSubscriptions.userId, u.id))
    .returning({ userId: userSubscriptions.userId, accessOverride: userSubscriptions.accessOverride });
  console.log(`\n  ✅ applied:`, updated, `\n`);
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
