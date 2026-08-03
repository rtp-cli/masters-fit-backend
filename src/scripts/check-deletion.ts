/**
 * READ-ONLY: was an email hard-deleted, and when? Hashes the candidate email the
 * SAME way the delete path does (via the shared hashEmail) and looks it up in
 * account_deletion_log. Answers "was foo@bar.com nuked?" without the log ever
 * storing the plaintext address.
 *
 *   DATABASE_URL="<url>" npx tsx src/scripts/check-deletion.ts foo@bar.com
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { accountDeletionLog } from "@/models";
import { hashEmail } from "@/services/user.service";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!email) { console.error("Usage: check-deletion.ts <email>"); process.exit(1); }

  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  const digest = hashEmail(email);
  console.log(`\ncheck-deletion — db host: ${host}`);
  console.log(`  email : ${email}`);
  console.log(`  sha256: ${digest}\n`);

  const rows = await db
    .select()
    .from(accountDeletionLog)
    .where(eq(accountDeletionLog.emailHash, digest));

  if (!rows.length) {
    console.log(`  ✗ No hard-delete on record for this email.\n`);
    return;
  }

  console.log(`  ✓ Hard-deleted — ${rows.length} record(s):`);
  for (const r of rows as any[]) {
    const when = new Date(r.createdAt).toISOString();
    console.log(`    • ${when}  id=${r.deletedUserId}  source=${r.source}${r.actor ? ` (${r.actor})` : ""}`);
    if (r.rowsDeleted) console.log(`        rows removed: ${JSON.stringify(r.rowsDeleted)}`);
    if (r.uuid) console.log(`        uuid: ${r.uuid}`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await pool.end().catch(() => {}); process.exit(process.exitCode ?? 0); });
