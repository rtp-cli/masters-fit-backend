/**
 * Hard-delete users by email and all their data. Mirrors the tested teardown
 * ordering in seed-demo-user.ts (deleteDemoUser), generalized to any email,
 * wrapped in a TRANSACTION so an unexpected FK rolls back atomically. Adds the
 * two NO-ACTION tables the demo teardown omits (app_feedback, plan_day_feedback);
 * CASCADE-FK tables (refresh_tokens, llm_generation_logs, exercise_exclusions, …)
 * are cleaned up by the final users delete.
 *
 *   Preview: DATABASE_URL="<url>" npx tsx src/scripts/delete-users.ts a@x.com --dry-run
 *   Apply:   DATABASE_URL="<url>" npx tsx src/scripts/delete-users.ts a@x.com
 */
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users, workouts } from "@/models";
// Single shared teardown — same code path as the in-app Delete Account flow.
import { purgeUserData } from "@/services/user.service";
import { isProtectedUser } from "@/constants/protected-accounts";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const emails = args.filter((a) => !a.startsWith("--")).map((e) => e.toLowerCase().trim()).filter(Boolean);
  if (!emails.length) { console.error("Usage: delete-users.ts <email> [<email> ...] [--dry-run]"); process.exit(1); }

  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\ndelete-users — db host: ${host} — ${dryRun ? "DRY RUN" : "APPLYING"}\n`);

  for (const email of emails) {
    const [u] = await db.select({ id: users.id, email: users.email, uuid: users.uuid }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (!u) { console.log(`  ${email} — not found, skipping`); continue; }

    if (isProtectedUser(u.id, u.email)) {
      console.log(`  ${email} (id=${u.id}) — 🔒 PROTECTED (admin/owner), refusing to delete`);
      continue;
    }

    const wCount = (await db.select({ id: workouts.id }).from(workouts).where(eq(workouts.userId, u.id))).length;
    console.log(`  ${email} (id=${u.id}) — ${wCount} workout(s)${dryRun ? "  → WOULD DELETE user + all data" : ""}`);

    if (dryRun) continue;
    await db.transaction(async (tx) => {
      await purgeUserData(tx, u.id, {
        source: "ops_script",
        email: u.email,
        uuid: u.uuid,
        actor: process.env.USER ?? "ops",
      });
    });
    console.log(`    ✓ deleted id=${u.id} and all associated data`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await pool.end().catch(() => {}); process.exit(process.exitCode ?? 0); });
