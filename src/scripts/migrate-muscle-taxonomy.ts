/**
 * [GQ-09] One-time migration: normalize exercises.muscle_groups to the canonical
 * taxonomy (src/constants/muscle-groups.ts). DRY-RUN by default.
 *
 * Playbook mirrors LR-035 (exercise dedup): preview → review → snapshot →
 * apply → verify counts. Safe by design — refuses a non-local DATABASE_URL
 * unless --remote is passed, and writes a rollback snapshot before any write.
 *
 * Usage:
 *   npm run migrate-muscle-taxonomy                 # dry-run against LOCAL
 *   npm run migrate-muscle-taxonomy -- --apply      # apply to LOCAL
 *   DATABASE_URL=<neon> npm run migrate-muscle-taxonomy -- --remote          # dry-run against PROD
 *   DATABASE_URL=<neon> npm run migrate-muscle-taxonomy -- --remote --apply  # APPLY to PROD
 */
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/config/database";
import { exercises } from "@/models";
import {
  normalizeMuscleGroups,
  CANONICAL_MUSCLE_GROUPS,
} from "@/constants/muscle-groups";

const APPLY = process.argv.includes("--apply");
const REMOTE = process.argv.includes("--remote");

// [GQ-09] Manual tags (keyed by PROD exercise id) for rows whose muscle_groups
// normalized to empty (their only label was an empty string / non-muscle junk)
// but whose correct group is unambiguous from the exercise name. Reviewed at
// CP-2; applied before the full_body fallback. Ids are prod-specific — a no-op
// locally. The two "mind" rows (Gratitude Reflection, Standing Body Scan)
// intentionally fall through to full_body.
const MANUAL_ID_OVERRIDES: Record<number, string[]> = {
  1308: ["shoulders"], // Overhead Dumbbell Press
  1299: ["back", "shoulders"], // Resistance Band Pull-Apart
};

function assertSafeTarget() {
  const url = (process.env.DATABASE_URL || "").toLowerCase();
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  if (!isLocal && !REMOTE) {
    console.error(
      "Refusing to run against a non-local DATABASE_URL without --remote.\n" +
        "Pass --remote to target production (Neon)."
    );
    process.exit(1);
  }
  return isLocal;
}

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function run() {
  const isLocal = assertSafeTarget();
  console.log(
    `Muscle-taxonomy migration — ${APPLY ? "APPLY" : "DRY-RUN"} against ${isLocal ? "LOCAL" : "REMOTE (prod)"}\n`
  );

  const rows = await db
    .select({ id: exercises.id, name: exercises.name, muscleGroups: exercises.muscleGroups })
    .from(exercises);

  const changes: { id: number; name: string; before: string[]; after: string[] }[] = [];
  const defaulted: { id: number; name: string; before: string[] }[] = [];
  const unmappedLabels = new Map<string, number>();
  const resultDistribution = new Map<string, number>();
  const snapshot: Record<number, string[]> = {};

  for (const row of rows) {
    const before = row.muscleGroups || [];
    const { groups, unmapped } = normalizeMuscleGroups(before);
    for (const u of unmapped) unmappedLabels.set(u, (unmappedLabels.get(u) || 0) + 1);

    let after = groups;
    if (after.length === 0) {
      // Every exercise must keep at least one muscle group (column is NOT NULL
      // and downstream reads muscleGroups[0]). Prefer a reviewed manual tag;
      // otherwise default to full_body and flag for review.
      if (MANUAL_ID_OVERRIDES[row.id]) {
        after = MANUAL_ID_OVERRIDES[row.id];
      } else {
        after = ["full_body"];
        defaulted.push({ id: row.id, name: row.name, before });
      }
    }
    for (const g of after) resultDistribution.set(g, (resultDistribution.get(g) || 0) + 1);

    if (!arraysEqual(before, after)) {
      changes.push({ id: row.id, name: row.name, before, after });
      snapshot[row.id] = before;
    }
  }

  // --- Report ---
  console.log(`Total exercises:            ${rows.length}`);
  console.log(`Rows that would change:     ${changes.length}`);
  console.log(`Rows emptied -> full_body:  ${defaulted.length}`);
  console.log(`Unmapped labels (should be 0): ${unmappedLabels.size}`);
  if (unmappedLabels.size > 0) {
    console.log("  ⚠️  UNMAPPED (add to RAW_MUSCLE_LABEL_MAP before applying):");
    for (const [label, n] of [...unmappedLabels].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${n}× "${label}"`);
    }
  }

  console.log(`\nResulting canonical distribution:`);
  for (const g of CANONICAL_MUSCLE_GROUPS) {
    console.log(`  ${g.padEnd(12)} ${resultDistribution.get(g) || 0}`);
  }

  console.log(`\nSample changes (first 20):`);
  for (const c of changes.slice(0, 20)) {
    console.log(`  [${c.id}] ${c.name}`);
    console.log(`      ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }
  if (defaulted.length > 0) {
    console.log(`\nExercises defaulted to full_body (review these):`);
    for (const d of defaulted) console.log(`  [${d.id}] ${d.name} — was ${JSON.stringify(d.before)}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN only — no writes. Re-run with --apply to migrate.`);
    process.exit(0);
  }

  // --- Apply ---
  if (unmappedLabels.size > 0) {
    console.error(`\nAborting apply: ${unmappedLabels.size} unmapped label(s). Extend the map first.`);
    process.exit(1);
  }

  const snapshotPath = path.join(
    process.cwd(),
    `muscle-taxonomy-rollback-${isLocal ? "local" : "prod"}.json`
  );
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote rollback snapshot (${Object.keys(snapshot).length} rows) -> ${snapshotPath}`);

  let applied = 0;
  for (const c of changes) {
    await db.update(exercises).set({ muscleGroups: c.after }).where(eq(exercises.id, c.id));
    applied++;
  }
  console.log(`Applied ${applied} updates.`);

  // Verify: no non-canonical values remain.
  const after = await db
    .select({ muscleGroups: exercises.muscleGroups })
    .from(exercises);
  const canonicalSet = new Set(CANONICAL_MUSCLE_GROUPS);
  const stray = new Set<string>();
  let emptied = 0;
  for (const r of after) {
    const gs = r.muscleGroups || [];
    if (gs.length === 0) emptied++;
    for (const g of gs) if (!canonicalSet.has(g)) stray.add(g);
  }
  console.log(`\nVerify: ${stray.size} stray non-canonical values, ${emptied} empty arrays.`);
  if (stray.size > 0) console.log(`  stray: ${[...stray].join(", ")}`);
  process.exit(stray.size === 0 && emptied === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
