/**
 * One-off: add emails to the system_config `test_email` allowlist (enables the
 * 9876 OTP bypass for those addresses). APPEND-ONLY and idempotent — it reads
 * the current list, merges + dedupes (lowercased), and writes back, so it never
 * clobbers existing entries (e.g. the Apple-reviewer email).
 *
 *   Preview: DATABASE_URL="<url>" npx tsx src/scripts/add-test-emails.ts a@x.com b@x.com --dry-run
 *   Apply:   DATABASE_URL="<url>" npx tsx src/scripts/add-test-emails.ts a@x.com b@x.com
 *
 * NOTE: getConfig caches for 5 min in Redis — a fresh write can take up to 5
 * minutes to take effect unless the cache is busted (attempted best-effort below).
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { systemConfig, SYSTEM_CONFIG_KEY } from "@/models";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const remove = args.includes("--remove");
  const emails = args
    .filter((a) => !a.startsWith("--"))
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);

  if (emails.length === 0) {
    console.error("Usage: add-test-emails.ts <email> [<email> ...] [--remove] [--dry-run]");
    process.exit(1);
  }

  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\nadd-test-emails — db host: ${host} — ${dryRun ? "DRY RUN" : "APPLYING"}\n`);

  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, SYSTEM_CONFIG_KEY.TEST_EMAIL))
    .limit(1);

  const current: string[] = (row?.value as { emails?: string[] })?.emails ?? [];
  const currentSet = new Set(current.map((e) => e.toLowerCase()));
  const targetSet = new Set(emails);

  const changed = remove
    ? emails.filter((e) => currentSet.has(e)) // to remove
    : emails.filter((e) => !currentSet.has(e)); // to add
  const noop = remove
    ? emails.filter((e) => !currentSet.has(e)) // not present
    : emails.filter((e) => currentSet.has(e)); // already present
  const merged = remove
    ? current.filter((e) => !targetSet.has(e.toLowerCase()))
    : Array.from(new Set([...current, ...emails]));

  const verb = remove ? "remove" : "add";
  console.log(`  current allowlist (${current.length}):`);
  current.forEach((e) => console.log(`    • ${e}`));
  console.log(`\n  to ${verb} (${changed.length}): ${changed.join(", ") || `(none — nothing to ${verb})`}`);
  if (noop.length) console.log(`  ${remove ? "not present" : "already present"}: ${noop.join(", ")}`);
  console.log(`\n  resulting allowlist (${merged.length}):`);
  merged.forEach((e) => console.log(`    • ${e}`));

  if (dryRun) {
    console.log(`\n  DRY RUN — no write performed.\n`);
    return;
  }
  if (changed.length === 0) {
    console.log(`\n  Nothing to ${verb} — allowlist unchanged.\n`);
    return;
  }

  if (row) {
    await db
      .update(systemConfig)
      .set({ value: { emails: merged }, updatedAt: new Date() })
      .where(eq(systemConfig.key, SYSTEM_CONFIG_KEY.TEST_EMAIL));
  } else {
    await db
      .insert(systemConfig)
      .values({ key: SYSTEM_CONFIG_KEY.TEST_EMAIL, value: { emails: merged } });
  }
  console.log(`\n  ✅ Applied. ${remove ? "Removed" : "Added"} ${changed.length}: ${changed.join(", ")}`);

  // Best-effort cache bust (getConfig caches for 5 min).
  try {
    const { redisClient } = await import("@/utils/redis");
    if (!redisClient.isOpen) await redisClient.connect();
    await redisClient.del(`system_config:${SYSTEM_CONFIG_KEY.TEST_EMAIL}`);
    console.log(`  🧹 Redis cache busted — effective immediately.`);
  } catch {
    console.log(`  (couldn't bust Redis cache — allow up to 5 min for it to take effect)`);
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
