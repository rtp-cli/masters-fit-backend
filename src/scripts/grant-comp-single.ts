/**
 * Grant COMPLIMENTARY access to one or more users by email.
 * Mirrors classify() in seed-initial-plan-ledger.ts WITHOUT the ledger backfill.
 *
 *   Preview: DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> [<email>...] --dry-run
 *   Apply:   DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> [<email>...]
 *   Revoke:  DATABASE_URL="<url>" npx tsx src/scripts/grant-comp-single.ts <email> --revoke
 *
 * A successful FIRST-TIME grant also emails the user (a short personal note from
 * Rich: you're on MastersFit+, and restart the app for it to take). Pass
 * --no-email to comp someone silently. Re-running on an already-comped user,
 * --revoke, --dry-run, and protected internal accounts never send — see
 * shouldSendCompEmail. The email NEVER decides whether the comp succeeded: the
 * access is granted first and a send failure is reported separately.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users } from "@/models/user.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { AccessTier } from "@/constants/access-policy";
import { shouldSendCompEmail } from "@/constants/comp-notification";
import { emailService } from "@/services/email.service";

async function grant(
  email: string,
  dryRun: boolean,
  revoke: boolean,
  noEmail: boolean
) {
  const [u] = await db
    .select({ id: users.id, email: users.email, name: users.name })
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
  console.log(`\n  ✅ applied:`, updated);

  // The access change is already committed. Everything below is a courtesy, so
  // a Resend outage must read as "comped, email failed" — never as a failure.
  const notify = shouldSendCompEmail({
    noEmail,
    revoke,
    dryRun,
    priorOverride: sub.accessOverride,
    email: u.email,
  });

  if (!notify) {
    console.log(`  (no email sent)\n`);
    return;
  }

  try {
    await emailService.sendCompGrantedEmail({ to: u.email, name: u.name });
    console.log(`  📧 emailed ${u.email}\n`);
  } catch (err) {
    console.error(
      `  ⚠️  COMP APPLIED, but the email to ${u.email} failed: ${(err as Error).message}`
    );
    console.error(`     Their access IS granted. Re-send by hand if you want.\n`);
  }
}

async function main() {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const revoke = process.argv.includes("--revoke");
  const noEmail = process.argv.includes("--no-email");
  if (!emails.length) {
    console.error(
      "Usage: grant-comp-single.ts <email> [<email>...] [--dry-run] [--revoke] [--no-email]"
    );
    process.exit(1);
  }
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  const mode = dryRun ? "DRY RUN" : "APPLYING";
  console.log(`\ngrant-comp-single — db host: ${host} — ${revoke ? "REVOKE" : "GRANT"} — ${mode}\n`);

  for (const email of emails) {
    await grant(email, dryRun, revoke, noEmail);
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
