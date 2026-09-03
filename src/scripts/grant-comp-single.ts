/**
 * Grant COMPLIMENTARY access to one or more users by email.
 * Mirrors classify() in seed-initial-plan-ledger.ts WITHOUT the ledger backfill.
 *
 *   Preview: DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> [<email>...] --dry-run
 *   Apply:   DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> [<email>...]
 *   Revoke:  DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> --revoke
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users } from "@/models/user.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { AccessTier } from "@/constants/access-policy";

async function grant(email: string, dryRun: boolean, revoke: boolean) {
  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) {
    console.log(`  no user for ${email} — nothing to do\n`);
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
      `\n  ⚠️  No user_subscriptions row — an UPDATE would match nothing. Have them open the app once, then re-run.\n`
    );
    return;
  }

  const target = revoke ? null : AccessTier.COMPLIMENTARY;

  if (dryRun) {
    console.log(`\n  would set access_override = ${target ?? "NULL"} (no expiry) for user ${u.id}\n`);
    return;
  }

  const updated = await db
    .update(userSubscriptions)
    .set({ accessOverride: target, accessOverrideExpiresAt: null })
    .where(eq(userSubscriptions.userId, u.id))
    .returning({ userId: userSubscriptions.userId, accessOverride: userSubscriptions.accessOverride });
  console.log(`\n  ✅ applied:`, updated, `\n`);
}

async function main() {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const revoke = process.argv.includes("--revoke");
  if (!emails.length) {
    console.error("Usage: grant-comp-single.ts <email> [<email>...] [--dry-run] [--revoke]");
    process.exit(1);
  }
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  const mode = dryRun ? "DRY RUN" : "APPLYING";
  console.log(`\ngrant-comp-single — db host: ${host} — ${revoke ? "REVOKE" : "GRANT"} — ${mode}\n`);

  for (const email of emails) {
    await grant(email, dryRun, revoke);
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
