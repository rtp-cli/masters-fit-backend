/**
 * Correct fields on ONE shared-catalog exercise row, by id.
 *
 * Why this exists: catalog fixes (a wrong difficulty, a missing piece of
 * equipment, a muscle group the overload check should see, a typo'd name)
 * were being done with hand-written UPDATEs against prod. Every one of them
 * needed the same care — look at the row first, touch only the named
 * columns, validate against the enums, keep the old values for rollback —
 * and a hand-written UPDATE gets none of that for free.
 *
 * Catalog rows are joined into every workout at read time, so one update
 * corrects every past and future workout that uses the exercise. No app
 * build or OTA is needed.
 *
 * SAFE BY DESIGN:
 *   - PREVIEW BY DEFAULT. Nothing is written without --apply, so a forgotten
 *     flag previews instead of writing.
 *   - Refuses a non-local DATABASE_URL unless --remote.
 *   - Refuses a stale checkout on --apply (lib/checkout-freshness.ts); the
 *     preview only warns. --stale-ok overrides.
 *   - Touches exactly the one row and only the columns you name. Refuses
 *     users' custom exercises (owner_user_id set) — those are not the catalog.
 *   - Validates equipment / difficulty / muscle_groups against the app's enums
 *     and refuses a rename that would collide with another catalog name.
 *   - `link` / `has_demo` are refused: use fix-exercise-link, which checks the
 *     video title.
 *   - Prints the exact rollback command after applying.
 *
 * Usage:
 *   # Preview against the LOCAL db:
 *   npm run catalog-fix -- --id 1131 --set difficulty=moderate \
 *     --set 'equipment=dumbbells,bench'
 *
 *   # Clear a nullable column:
 *   npm run catalog-fix -- --id 1131 --clear description
 *
 *   # Production — never hand-paste the URL, use the wrapper:
 *   scripts/with-prod-url.sh npm run catalog-fix -- --id 1131 \
 *     --set difficulty=moderate --remote            # preview
 *   scripts/with-prod-url.sh npm run catalog-fix -- --id 1131 \
 *     --set difficulty=moderate --remote --apply    # write
 */

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { exercises } from "@/models/exercise.schema";
import { assertCheckoutIsCurrent } from "./lib/checkout-freshness";
import {
  type Change,
  type ColumnValue,
  formatValue,
  parseChanges,
  rollbackArgs,
  sameValue,
} from "./lib/catalog-fix-changes";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function argValues(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  });
  return out;
}

const idArg = argValue("--id");
const allowRemote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");
const staleOk = process.argv.includes("--stale-ok");

const USAGE =
  "Usage: npm run catalog-fix -- --id <id> (--set <column>=<value> | --clear <column>)... " +
  "[--remote] [--apply] [--stale-ok]";

const exerciseId = Number(idArg);
if (!idArg || !Number.isInteger(exerciseId)) {
  console.error(idArg ? `--id must be an integer, got "${idArg}".` : USAGE);
  process.exit(1);
}

let changes: Change[];
try {
  changes = parseChanges(argValues("--set"), argValues("--clear"));
} catch (err) {
  console.error(`${(err as Error).message}\n\n${USAGE}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guardrail: local-only unless --remote (mirrors fix-exercise-link.ts)
// ---------------------------------------------------------------------------
function assertLocalDatabase(): boolean {
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
  if (!isLocal && !allowRemote) {
    console.error(
      `Refusing to run: host "${host}" is not local. This script is ` +
        `LOCAL-ONLY by default.\n` +
        `Re-run with --remote to fix a catalog row on a non-local database ` +
        `(e.g. Neon). Only the one exercise row is touched.`,
    );
    process.exit(1);
  }
  if (!isLocal) {
    console.warn(`⚠️  --remote: operating on NON-LOCAL database "${host}".`);
  }
  return isLocal;
}

async function main(): Promise<void> {
  console.log(`\ncatalog-fix — ${apply ? "APPLYING" : "PREVIEW (no --apply, nothing will be written)"}\n`);

  // The preview reads only, so it warns rather than blocking — but it is also
  // the preflight for the real write, so it still says something.
  await assertCheckoutIsCurrent({
    skip: staleOk,
    warnOnly: !apply,
    label: "catalog-fix",
    effect: "write to the database",
  });

  assertLocalDatabase();

  const [row] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);

  if (!row) {
    console.error(`No exercise with id ${exerciseId}.`);
    process.exit(1);
  }
  if (row.ownerUserId !== null) {
    console.error(
      `Exercise ${row.id} "${row.name}" is user ${row.ownerUserId}'s CUSTOM exercise, ` +
        `not a catalog row. Refusing — this tool only edits the shared catalog.`,
    );
    process.exit(1);
  }

  const current = row as unknown as Record<string, ColumnValue>;
  const before: Record<string, ColumnValue> = {};
  for (const c of changes) before[c.column] = current[c.key] ?? null;

  console.log(`\nExercise ${row.id}: ${row.name}`);
  console.log(`  updated_at: ${row.updatedAt.toISOString()}\n`);

  const effective = changes.filter((c) => !sameValue(before[c.column], c.value));
  for (const c of changes) {
    const unchanged = !effective.includes(c);
    console.log(`  ${c.column}${unchanged ? "  (already this value — no change)" : ""}`);
    console.log(`    before: ${formatValue(before[c.column])}`);
    console.log(`    after : ${formatValue(c.value)}`);
  }

  if (!effective.length) {
    console.log(`\nEvery value already matches. Nothing to do.`);
    return;
  }

  // A rename that collides with another catalog row would fail on the unique
  // index anyway; catch it here with a message that names the other row.
  const rename = effective.find((c) => c.column === "name");
  if (rename) {
    const [clash] = await db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(
        and(
          sql`lower(${exercises.name}) = lower(${rename.value as string})`,
          isNull(exercises.ownerUserId),
          ne(exercises.id, row.id),
        ),
      )
      .limit(1);
    if (clash) {
      console.error(
        `\nRefusing: catalog exercise ${clash.id} is already named "${clash.name}". ` +
          `Catalog names are unique case-insensitively — that is a merge, not a rename.`,
      );
      process.exit(1);
    }
  }

  // tag is free text in the schema, but generation keys off specific values
  // (e.g. walking_movement pins). A brand-new tag is usually a typo.
  const tag = effective.find((c) => c.column === "tag" && c.value !== null);
  if (tag) {
    const [known] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(exercises)
      .where(and(eq(exercises.tag, tag.value as string), isNull(exercises.ownerUserId)));
    if (!known.n) {
      console.warn(
        `\n⚠️  No other catalog exercise has tag "${tag.value}". Check it isn't a typo ` +
          `of an existing tag before applying.`,
      );
    }
  }

  const rollback =
    `${allowRemote ? "scripts/with-prod-url.sh " : ""}npm run catalog-fix -- --id ${row.id} ` +
    `${rollbackArgs(effective, before)}${allowRemote ? " --remote" : ""} --apply`;

  if (!apply) {
    console.log(
      `\nPREVIEW only — nothing written. Re-run the same command with --apply to write ` +
        `${effective.length} column(s) on row ${row.id}.`,
    );
    return;
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const c of effective) set[c.key] = c.value;

  const updated = await db
    .update(exercises)
    .set(set)
    .where(and(eq(exercises.id, row.id), isNull(exercises.ownerUserId)))
    .returning({ id: exercises.id, updatedAt: exercises.updatedAt });

  if (updated.length !== 1) {
    console.error(`\nExpected to update 1 row, updated ${updated.length}. Check the row by hand.`);
    process.exit(1);
  }

  console.log(`\n✅ Updated exercise ${row.id} "${row.name}" (updated_at ${updated[0].updatedAt.toISOString()}).`);
  console.log(`   To roll back:\n   ${rollback}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("catalog-fix failed:", error);
    await pool.end();
    process.exit(1);
  });
