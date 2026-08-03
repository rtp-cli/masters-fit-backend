/**
 * READ-ONLY audit of removal-candidate accounts: soft-delete tombstones left by
 * the in-app "Delete Account" (email …_deleted_<ts>) and lingering rtp+ test
 * accounts. Prints id, email, active flag, created date, and workout count, and
 * flags PROTECTED accounts that must never be deleted. No writes.
 *
 *   DATABASE_URL="<url>" npx tsx src/scripts/audit-accounts.ts
 */
import { pool } from "@/config/database";
import { isProtectedEmail } from "@/constants/protected-accounts";

async function main() {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\naudit-accounts — db host: ${host} — READ ONLY\n`);

  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.is_active, u.created_at,
      (SELECT count(*)::int FROM workouts w WHERE w.user_id = u.id) AS workouts,
      CASE
        WHEN u.email ~ '_deleted_[0-9]+$' THEN 'tombstone'
        WHEN u.email LIKE 'rtp+%' THEN 'test'
        ELSE 'other'
      END AS category
    FROM users u
    WHERE u.email ~ '_deleted_[0-9]+$' OR u.email LIKE 'rtp+%'
    ORDER BY category, u.created_at;
  `);

  const groups: Record<string, any[]> = { tombstone: [], test: [], other: [] };
  for (const r of rows as any[]) groups[r.category].push(r);

  const fmt = (r: any) => {
    const base = r.email.replace(/_deleted_[0-9]+$/, "");
    const prot = isProtectedEmail(base) || isProtectedEmail(r.email) ? "  🔒 PROTECTED — DO NOT DELETE" : "";
    const date = new Date(r.created_at).toISOString().slice(0, 10);
    return `    id=${String(r.id).padEnd(5)} ${r.is_active ? "active " : "inactive"}  ${date}  ${String(r.workouts).padStart(3)} wo  ${r.email}${prot}`;
  };

  console.log(`  TOMBSTONES — in-app "Delete Account" soft-deletes (${groups.tombstone.length}):`);
  groups.tombstone.forEach((r) => console.log(fmt(r)));
  if (!groups.tombstone.length) console.log("    (none)");

  console.log(`\n  TEST / THROWAWAY — rtp+ accounts (${groups.test.length}):`);
  groups.test.forEach((r) => console.log(fmt(r)));
  if (!groups.test.length) console.log("    (none)");

  const totalWo = rows.reduce((n: number, r: any) => n + r.workouts, 0);
  console.log(`\n  ${rows.length} candidate account(s), ${totalWo} workout row(s) attached.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await pool.end().catch(() => {}); process.exit(process.exitCode ?? 0); });
