/**
 * READ-ONLY: what would happen if a given user logged in right now?
 * Prints their subscription row, ai_operations ledger usage (the lifetime FREE
 * meter), and how much content they already have. No writes.
 *
 *   DATABASE_URL="<url>" npx tsx src/scripts/diag-user-access.ts <email> [<email>...]
 */
import { pool } from "@/config/database";

async function main() {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "localhost";
  console.log(`\ndiag-user-access — db host: ${host} — READ ONLY\n`);

  for (const email of emails) {
    const { rows: urows } = await pool.query(
      `SELECT id, email, created_at, needs_onboarding, is_active
         FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (!urows.length) {
      console.log(`  ${email}: NO USER\n`);
      continue;
    }
    const u = urows[0];
    console.log(
      `  ${u.email}  id=${u.id}  created=${new Date(u.created_at)
        .toISOString()
        .slice(0, 10)}  active=${u.is_active}  needs_onboarding=${u.needs_onboarding}`
    );

    const { rows: sub } = await pool.query(
      `SELECT id, status, access_override, access_override_expires_at,
              plan_id, subscription_start_date, subscription_end_date
         FROM user_subscriptions WHERE user_id = $1`,
      [u.id]
    );
    console.log(`    subscription row: ${sub.length ? JSON.stringify(sub[0]) : "NONE (created lazily on first load)"}`);

    const { rows: ops } = await pool.query(
      `SELECT operation_type, status, count(*)::int AS n
         FROM ai_operations WHERE user_id = $1
         GROUP BY 1, 2 ORDER BY 1, 2`,
      [u.id]
    );
    console.log(
      `    ai_operations ledger (the lifetime FREE meter): ${
        ops.length ? JSON.stringify(ops) : "EMPTY — no allowance consumed"
      }`
    );

    const { rows: content } = await pool.query(
      `SELECT (SELECT count(*)::int FROM workouts WHERE user_id = $1) AS workouts,
              (SELECT count(*)::int FROM profiles WHERE user_id = $1) AS profiles`,
      [u.id]
    );
    console.log(`    existing content: ${JSON.stringify(content[0])}\n`);
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
