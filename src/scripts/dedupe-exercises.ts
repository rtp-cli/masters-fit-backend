/**
 * Dedupe near-duplicate rows in the `exercises` table.
 *
 * Production's catalog grew from 265 rows (2025-06-03 original seed) to 2081 via a single-day
 * bulk import on 2025-07-08 that never checked for existing near-matches, producing 266 exact
 * (case-insensitive) duplicate name groups plus ~44 vetted formatting-only near-duplicates. See
 * frontend/launch_readiness/EXERCISE_CURATION_CANDIDATES_PROD.md (LR-035/LR-056) for the full
 * analysis this script implements.
 *
 * For each cluster (Tier 1: exact case-insensitive name match, computed live against whichever DB
 * is targeted; Tier 2: a hand-vetted list of formatting-only near-duplicate pairs — hyphen/en-dash,
 * apostrophe style, word order — from that doc), keeps the LOWEST id as canonical, reassigns every
 * plan_day_exercises.exercise_id reference from the other ids to the canonical id, then deletes the
 * other exercise rows. plan_day_exercises is the only table with a real FK to exercises.id (exercise
 * logs reference plan_day_exercises.id, not exercises directly) — confirmed by inspecting every
 * schema file, not assumed.
 *
 * SAFE BY DESIGN:
 * - Refuses to run against a non-local DATABASE_URL unless you pass --remote (same convention as
 *   seed-demo-user.ts).
 * - Defaults to a DRY RUN (prints the full plan, writes nothing). Pass --apply to actually execute.
 * - Tier 2 pairs are validated against the live catalog at runtime — any id that no longer exists
 *   (e.g. running against local, which has none of these ids) is skipped with a warning, not an
 *   error.
 * - The apply path runs inside a single transaction.
 *
 * Usage:
 *   npx tsx src/scripts/dedupe-exercises.ts                                   # local, dry run
 *   npx tsx src/scripts/dedupe-exercises.ts --apply                          # local, execute
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/dedupe-exercises.ts --remote            # prod dry run
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/dedupe-exercises.ts --remote --apply    # prod execute
 */

import { db } from "@/config/database";
import { exercises } from "@/models/exercise.schema";
import { planDayExercises } from "@/models/workout.schema";
import { eq, inArray, sql } from "drizzle-orm";

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

// Tier 2 — hand-vetted formatting-only near-duplicates (word order, hyphen/en-dash, apostrophe
// style) from EXERCISE_CURATION_CANDIDATES_PROD.md's Tier 2 table. Production ids only; harmless
// no-ops against any other database since resolveClusters() skips ids that don't exist.
const TIER2_PAIRS: [number, number][] = [
  [2007, 2008], [1456, 1586], [2071, 2106], [221, 855], [221, 1394], [221, 1593],
  [290, 809], [197, 1711], [197, 1751], [197, 2030], [199, 2074], [1711, 2030],
  [1713, 1758], [18, 705], [33, 1187], [87, 542], [427, 602], [470, 2078],
  [530, 783], [530, 1125], [575, 682], [602, 1146], [640, 1151], [729, 1635],
  [734, 1159], [783, 1125], [795, 1841], [813, 975], [960, 2036], [996, 2088],
  [1040, 2006], [1309, 2088], [1387, 1456], [1387, 1656], [1508, 2088], [1586, 1656],
  [1742, 1778], [1743, 1787], [1744, 1793], [1751, 2030], [1771, 2031], [1796, 2055],
  [1951, 2004], [1995, 2016],
];

class UnionFind {
  private parent = new Map<number, number>();
  private ensure(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    return x;
  }
  find(x: number): number {
    this.ensure(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

type Cluster = { canonical: number; others: number[]; names: Map<number, string> };

async function resolveClusters(): Promise<Cluster[]> {
  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises);
  const existingIds = new Set(rows.map((r) => r.id));
  const namesById = new Map(rows.map((r) => [r.id, r.name]));

  const uf = new UnionFind();

  // Tier 1 — exact case-insensitive name matches, computed live.
  const byLowerName = new Map<string, number[]>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    byLowerName.set(key, [...(byLowerName.get(key) ?? []), r.id]);
  }
  let tier1Groups = 0;
  for (const ids of byLowerName.values()) {
    if (ids.length < 2) continue;
    tier1Groups++;
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // Tier 2 — vetted pairs, skipping any id absent from this database.
  let tier2Applied = 0;
  let tier2Skipped = 0;
  for (const [a, b] of TIER2_PAIRS) {
    if (!existingIds.has(a) || !existingIds.has(b)) {
      tier2Skipped++;
      continue;
    }
    uf.union(a, b);
    tier2Applied++;
  }
  console.log(
    `Tier 1: ${tier1Groups} exact-name groups. Tier 2: ${tier2Applied} pairs applied, ` +
      `${tier2Skipped} skipped (ids not present on this database).`
  );

  const clusterMembers = new Map<number, number[]>();
  for (const id of existingIds) {
    const root = uf.find(id);
    clusterMembers.set(root, [...(clusterMembers.get(root) ?? []), id]);
  }

  const clusters: Cluster[] = [];
  for (const members of clusterMembers.values()) {
    if (members.length < 2) continue;
    const canonical = Math.min(...members);
    const others = members.filter((id) => id !== canonical);
    clusters.push({ canonical, others, names: namesById });
  }
  clusters.sort((a, b) => b.others.length - a.others.length);
  return clusters;
}

async function countReferences(exerciseIds: number[]): Promise<number> {
  if (exerciseIds.length === 0) return 0;
  const rows = await db
    .select({ id: planDayExercises.id })
    .from(planDayExercises)
    .where(inArray(planDayExercises.exerciseId, exerciseIds));
  return rows.length;
}

async function run() {
  const apply = process.argv.includes("--apply");
  assertLocalDatabase(process.argv.includes("--remote"));

  const clusters = await resolveClusters();
  if (clusters.length === 0) {
    console.log("No duplicate clusters found on this database. Nothing to do.");
    process.exit(0);
  }

  const allOtherIds = clusters.flatMap((c) => c.others);
  const totalRefsToReassign = await countReferences(allOtherIds);

  console.log(
    `\n${clusters.length} cluster(s), ${allOtherIds.length} redundant row(s) to remove, ` +
      `${totalRefsToReassign} plan_day_exercises reference(s) to reassign.\n`
  );
  for (const c of clusters) {
    const canonicalName = c.names.get(c.canonical);
    console.log(
      `  keep ${c.canonical} "${canonicalName}"  <-  delete ${c.others
        .map((id) => `${id} "${c.names.get(id)}"`)
        .join(", ")}`
    );
  }

  if (!apply) {
    console.log(
      "\nDRY RUN — nothing written. Re-run with --apply to execute this plan."
    );
    process.exit(0);
  }

  console.log("\nApplying...");
  await db.transaction(async (tx) => {
    for (const c of clusters) {
      if (c.others.length === 0) continue;
      await tx
        .update(planDayExercises)
        .set({ exerciseId: c.canonical })
        .where(inArray(planDayExercises.exerciseId, c.others));
      await tx.delete(exercises).where(inArray(exercises.id, c.others));
    }
  });

  const remaining = await resolveClusters();
  const orphans = await db.execute(sql`
    select count(*) as count from plan_day_exercises pde
    where not exists (select 1 from exercises e where e.id = pde.exercise_id)
  `);
  console.log(
    `\nDone. ${allOtherIds.length} row(s) removed. Remaining duplicate clusters: ` +
      `${remaining.length}. Orphaned plan_day_exercises rows: ${(orphans as any).rows?.[0]?.count ?? (orphans as any)[0]?.count}.`
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
