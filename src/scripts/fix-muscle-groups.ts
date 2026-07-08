/**
 * Fix malformed `muscle_groups` values: 1,065 exercises (61% of production's catalog) have
 * muscle_groups stored as ONE array element containing a comma-joined string (e.g.
 * `{"back,biceps,core"}`) instead of separate elements (`{back,biceps,core}`). Since
 * `arrayOverlaps()` (used by exercise.service.ts's getExercises filter and
 * workout-agent.service.ts's getFilteredExercises) checks for a matching array ELEMENT, these
 * rows never match any single-muscle-group filter — found while investigating a user-reported
 * search duplicate, unrelated to LR-035/LR-056's dedup work.
 *
 * Two cases, handled differently:
 *
 * 1. SIMPLE (1,047 rows): the single element is cleanly comma-joined, nothing else wrong. Split on
 *    comma, trim, dedupe, drop empties.
 *
 * 2. QUOTE-CORRUPTED (18 rows, all in the 2025-07-08 bulk-import id range): the value looks like
 *    `incline_decline_bench","chest,shoulders,triceps` — an equipment token got concatenated onto
 *    the front of the muscle_groups string with literal stray quote characters, missing the field
 *    separator that should have kept them apart during import. Investigated by hand: in every one
 *    of the 18 cases, the leaked token is a valid AvailableEquipment value that's ALSO absent from
 *    that row's existing `equipment` column and makes contextual sense for the exercise (e.g. id
 *    1153 "Incline Dumbbell Press" was missing `incline_decline_bench`; id 1246 "Barbell Hip
 *    Thrust" was missing `bench`) — recovers real missing data, not just a formatting fix. Hardcoded
 *    below rather than parsed generically since the corruption has two different quote-position
 *    variants and 18 rows is small enough to verify each by hand instead of trusting a regex.
 *
 * SAFE BY DESIGN: local/--remote guard and --apply gate, same convention as the other scripts in
 * this directory.
 *
 * Usage:
 *   npx tsx src/scripts/fix-muscle-groups.ts                                   # local, dry run
 *   npx tsx src/scripts/fix-muscle-groups.ts --apply                          # local, execute
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/fix-muscle-groups.ts --remote            # prod dry run
 *   DATABASE_URL=<neon-url> npx tsx src/scripts/fix-muscle-groups.ts --remote --apply    # prod execute
 */

import { db } from "@/config/database";
import { exercises } from "@/models/exercise.schema";
import { eq } from "drizzle-orm";
import { AvailableEquipment } from "@/types";

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

// Case 2 — hand-verified fixes for the 18 quote-corrupted rows (production ids). Harmless no-op
// against any database missing these ids.
const QUOTE_CORRUPTED_FIXES: Record<
  number,
  { muscleGroups: string[]; addEquipment: AvailableEquipment }
> = {
  1153: { muscleGroups: ["chest", "shoulders", "triceps"], addEquipment: "incline_decline_bench" },
  1154: { muscleGroups: ["glutes", "hamstrings", "lower_back"], addEquipment: "squat_rack" },
  1161: { muscleGroups: ["glutes", "quads"], addEquipment: "plyo_box" },
  1167: { muscleGroups: ["glutes", "quads", "core"], addEquipment: "bench" },
  1183: { muscleGroups: ["glutes", "hamstrings", "lower_back"], addEquipment: "plyo_box" },
  1195: { muscleGroups: ["biceps"], addEquipment: "incline_decline_bench" },
  1198: { muscleGroups: ["chest", "triceps"], addEquipment: "resistance_bands" },
  1203: { muscleGroups: ["chest", "triceps", "core"], addEquipment: "dumbbells" },
  1209: { muscleGroups: ["chest", "shoulders"], addEquipment: "stability_ball" },
  1213: { muscleGroups: ["biceps", "forearms"], addEquipment: "incline_decline_bench" },
  1220: { muscleGroups: ["shoulders"], addEquipment: "dumbbells" },
  1225: { muscleGroups: ["chest", "shoulders"], addEquipment: "incline_decline_bench" },
  1232: { muscleGroups: ["glutes", "quads", "core"], addEquipment: "bench" },
  1234: { muscleGroups: ["quads", "biceps"], addEquipment: "dumbbells" },
  1235: { muscleGroups: ["glutes", "quads"], addEquipment: "bench" },
  1242: { muscleGroups: ["rotator_cuff"], addEquipment: "incline_decline_bench" },
  1246: { muscleGroups: ["glutes", "hamstrings"], addEquipment: "bench" },
  1262: { muscleGroups: ["chest", "triceps"], addEquipment: "incline_decline_bench" },
};

type Plan = {
  id: number;
  name: string;
  kind: "simple" | "quote-corrupted";
  oldMuscleGroups: string[];
  newMuscleGroups: string[];
  oldEquipment: string[] | null;
  newEquipment: string[] | null;
};

async function buildPlan(): Promise<Plan[]> {
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      muscleGroups: exercises.muscleGroups,
      equipment: exercises.equipment,
    })
    .from(exercises);

  const plan: Plan[] = [];
  for (const row of rows) {
    if (row.muscleGroups.length !== 1 || !row.muscleGroups[0].includes(",")) continue;

    const fix = QUOTE_CORRUPTED_FIXES[row.id];
    if (fix) {
      const existingEquipment = row.equipment ?? [];
      const newEquipment = existingEquipment.includes(fix.addEquipment)
        ? existingEquipment
        : [...existingEquipment, fix.addEquipment];
      plan.push({
        id: row.id,
        name: row.name,
        kind: "quote-corrupted",
        oldMuscleGroups: row.muscleGroups,
        newMuscleGroups: fix.muscleGroups,
        oldEquipment: row.equipment,
        newEquipment,
      });
      continue;
    }

    if (row.muscleGroups[0].includes('"')) {
      // A row matching the "single comma-joined element" shape that isn't in our hand-verified
      // list AND still has a stray quote character — don't guess, surface it instead.
      console.warn(
        `SKIPPING id ${row.id} "${row.name}": has an unrecognized quote-corrupted ` +
          `muscle_groups value not in QUOTE_CORRUPTED_FIXES: ${JSON.stringify(row.muscleGroups)}`
      );
      continue;
    }

    const split = Array.from(
      new Set(
        row.muscleGroups[0]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    );
    plan.push({
      id: row.id,
      name: row.name,
      kind: "simple",
      oldMuscleGroups: row.muscleGroups,
      newMuscleGroups: split,
      oldEquipment: row.equipment,
      newEquipment: row.equipment,
    });
  }
  return plan;
}

async function run() {
  const apply = process.argv.includes("--apply");
  assertLocalDatabase(process.argv.includes("--remote"));

  const plan = await buildPlan();
  if (plan.length === 0) {
    console.log("No malformed muscle_groups rows found on this database. Nothing to do.");
    process.exit(0);
  }

  const simple = plan.filter((p) => p.kind === "simple");
  const quoteFixed = plan.filter((p) => p.kind === "quote-corrupted");
  console.log(
    `\n${plan.length} row(s) to fix: ${simple.length} simple comma-split, ` +
      `${quoteFixed.length} quote-corrupted (also recovers missing equipment).\n`
  );
  for (const p of quoteFixed) {
    console.log(
      `  [quote-corrupted] ${p.id} "${p.name}": muscle_groups ${JSON.stringify(
        p.oldMuscleGroups
      )} -> ${JSON.stringify(p.newMuscleGroups)}; equipment ${JSON.stringify(
        p.oldEquipment
      )} -> ${JSON.stringify(p.newEquipment)}`
    );
  }
  console.log(`  [simple] ${simple.length} rows, e.g.:`);
  for (const p of simple.slice(0, 5)) {
    console.log(
      `    ${p.id} "${p.name}": ${JSON.stringify(p.oldMuscleGroups)} -> ${JSON.stringify(
        p.newMuscleGroups
      )}`
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to execute this plan.");
    process.exit(0);
  }

  console.log("\nApplying...");
  await db.transaction(async (tx) => {
    for (const p of plan) {
      await tx
        .update(exercises)
        .set({ muscleGroups: p.newMuscleGroups, equipment: p.newEquipment as any })
        .where(eq(exercises.id, p.id));
    }
  });

  const remaining = await buildPlan();
  console.log(`\nDone. ${plan.length} row(s) fixed. Remaining malformed rows: ${remaining.length}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
