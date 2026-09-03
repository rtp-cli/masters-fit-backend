/** TEMP read-only diagnostic: are real purchases landing in prod? */
import { db } from "@/config/database";
import { sql } from "drizzle-orm";

async function q(label: string, statement: any) {
  const res: any = await db.execute(statement);
  console.log(`\n=== ${label} ===`);
  console.table(res.rows ?? res);
}

async function main() {
  await q(
    "subscription rows by status",
    sql`select status, count(*) as n
        from user_subscriptions
        group by status order by n desc`
  );

  await q(
    "non-trial subscriptions (real purchases), newest 25",
    sql`select id, user_id, status, plan_id,
               subscription_start_date, subscription_end_date, created_at
        from user_subscriptions
        where status not in ('trial')
        order by created_at desc
        limit 25`
  );

  await q(
    "anything created since launch (2026-08-31)",
    sql`select date_trunc('day', created_at) as day, status, count(*) as n
        from user_subscriptions
        where created_at > timestamp '2026-08-31'
        group by 1, 2 order by 1 desc`
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
