/** TEMP read-only diagnostic: OTP/auth-code health + recent signup activity. */
import { db } from "@/config/database";
import { sql } from "drizzle-orm";

async function q(label: string, statement: any) {
  const res: any = await db.execute(statement);
  console.log(`\n=== ${label} ===`);
  console.table(res.rows ?? res);
}

async function main() {
  await q(
    "auth_codes volume",
    sql`select count(*) as total,
               count(*) filter (where created_at > now() - interval '2 days') as last_2d,
               count(*) filter (where used = false) as unused
        from auth_codes`
  );

  await q(
    "recent auth_codes (25)",
    sql`select id, email, created_at, expires_at, used, attempts
        from auth_codes order by created_at desc limit 25`
  );

  await q(
    "users created recently (20)",
    sql`select id, email, name, created_at, needs_onboarding
        from users order by created_at desc limit 20`
  );

  await q(
    "users created per day (10d)",
    sql`select date_trunc('day', created_at) as day, count(*) as n
        from users where created_at > now() - interval '10 days'
        group by 1 order by 1 desc`
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
