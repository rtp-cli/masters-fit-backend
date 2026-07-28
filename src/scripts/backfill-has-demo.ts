/**
 * Backfill `exercises.has_demo` — the stored oEmbed verdict on each exercise's
 * demo link (true = playable YouTube video, false = missing/unparseable/dead,
 * null = transient failure, retry later).
 *
 * New/updated exercises get validated at write time (exercise.service.ts);
 * this script covers the existing catalog. Re-running only touches rows where
 * has_demo IS NULL, so it's safe to run repeatedly until the NULLs drain;
 * pass --revalidate to re-check every row (e.g. yearly link rot sweep).
 *
 * oEmbed calls run in small batches to stay polite with YouTube; ~1,700 rows
 * takes a few minutes.
 *
 * SAFE BY DESIGN: local/--remote guard and --apply gate, same convention as
 * the other scripts in this directory.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-has-demo.ts                                # local, dry run
 *   npx tsx src/scripts/backfill-has-demo.ts --apply                       # local, execute
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/backfill-has-demo.ts --remote --apply  # prod
 */

import { db } from "@/config/database";
import { exercises } from "@/models/exercise.schema";
import { eq, isNull } from "drizzle-orm";
import { checkDemoLink } from "@/utils/video-validation";

const CONCURRENCY = 8;

function assertLocalDatabase(allowRemote: boolean) {
  const url = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("DATABASE_URL is unset or unparseable. Aborting.");
    process.exit(1);
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  console.log(`DATABASE_URL host: ${host} (local=${isLocal})`);
  if (!isLocal) {
    if (!allowRemote) {
      console.error(
        `Refusing to run: host "${host}" is not local. This script is LOCAL-ONLY by ` +
          `default.\nRe-run with --remote to target a non-local database (e.g. Neon).`
      );
      process.exit(1);
    }
    console.warn(`⚠️  --remote: targeting NON-LOCAL database "${host}".`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const revalidate = process.argv.includes("--revalidate");
  assertLocalDatabase(process.argv.includes("--remote"));

  const rows = revalidate
    ? await db.select({ id: exercises.id, name: exercises.name, link: exercises.link }).from(exercises)
    : await db
        .select({ id: exercises.id, name: exercises.name, link: exercises.link })
        .from(exercises)
        .where(isNull(exercises.hasDemo));

  console.log(
    `${rows.length} exercises to check (${revalidate ? "revalidate all" : "has_demo IS NULL"}), apply=${apply}`
  );

  let ok = 0;
  let dead = 0;
  let unknown = 0;
  const deadNames: string[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const verdict = await checkDemoLink(row.link);
        if (verdict === true) ok++;
        else if (verdict === false) {
          dead++;
          deadNames.push(`#${row.id} ${row.name}`);
        } else unknown++;

        if (apply && verdict !== null) {
          await db
            .update(exercises)
            .set({ hasDemo: verdict })
            .where(eq(exercises.id, row.id));
        }
      })
    );
    if ((i / CONCURRENCY) % 20 === 0) {
      console.log(`  ...${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
    }
  }

  console.log(
    `\nDone. playable=${ok} dead/no-link=${dead} transient-unknown=${unknown}` +
      (apply ? " (written)" : " (dry run — nothing written; re-run with --apply)")
  );
  if (deadNames.length > 0) {
    console.log(`\nNo working demo (${deadNames.length}):`);
    for (const name of deadNames.slice(0, 50)) console.log(`  ${name}`);
    if (deadNames.length > 50) console.log(`  ...and ${deadNames.length - 50} more`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("backfill-has-demo failed:", error);
  process.exit(1);
});
