/**
 * READ-ONLY preflight for deleting users. Resolves the target emails to ids and
 * enumerates EVERY table with a foreign key to users(id) — plus each FK's
 * ON DELETE rule — so we know exactly what a delete would touch and whether the
 * canonical teardown in seed-demo-user.ts covers it. No writes.
 *
 *   DATABASE_URL="<url>" npx tsx src/scripts/preflight-user-fk.ts a@x.com b@x.com
 */
import { pool } from "@/config/database";

async function main() {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((e) => e.toLowerCase());
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\npreflight-user-fk — db host: ${host} — READ ONLY\n`);

  // 1. Resolve emails → ids
  const { rows: users } = await pool.query(
    `SELECT id, email FROM users WHERE lower(email) = ANY($1)`,
    [emails]
  );
  console.log(`  target users (${users.length}/${emails.length}):`);
  users.forEach((u: any) => console.log(`    • id=${u.id}  ${u.email}`));
  const missing = emails.filter((e) => !users.find((u: any) => u.email.toLowerCase() === e));
  if (missing.length) console.log(`  NOT FOUND: ${missing.join(", ")}`);

  // 2. Every FK that references users(id), with its ON DELETE rule
  const { rows: fks } = await pool.query(`
    SELECT tc.table_name AS child_table,
           kcu.column_name AS child_col,
           rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users'
    ORDER BY rc.delete_rule, tc.table_name;
  `);
  console.log(`\n  tables with a direct FK → users(id) (${fks.length}):`);
  for (const f of fks as any[]) {
    console.log(`    • ${f.child_table}.${f.child_col}  [ON DELETE ${f.delete_rule}]`);
  }

  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await pool.end().catch(() => {}); process.exit(process.exitCode ?? 0); });
