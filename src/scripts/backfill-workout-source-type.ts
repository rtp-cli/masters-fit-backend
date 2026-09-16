/**
 * Backfill `workouts.source_type` from the ai_operations ledger.
 *
 * Nothing ever wrote source_type, so every generated plan landed NULL and the
 * initial-vs-regeneration mix was invisible. Settlement now stamps the tag
 * going forward (see `aiOperationService.settleCompletedByJobId`); this script
 * recovers the history the ledger can still explain.
 *
 * Only workouts with a completed ledger row pointing at them are touched — the
 * ledger began 2026-07-14, so older plans have no evidence of their lineage and
 * are deliberately LEFT NULL rather than guessed at. A wrong tag is worse than
 * an absent one: absent reads as "before we tracked this", wrong reads as data.
 *
 * Dry-run by default. Writes only with --apply.
 *
 *   npm run backfill-workout-source-type                  # local, preview
 *   npm run backfill-workout-source-type -- --apply       # local, write
 *   .../with-prod-url.sh npm run backfill-workout-source-type -- --apply
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { aiOperations } from "@/models/ai-operations.schema";
import { workouts } from "@/models/workout.schema";
import {
  AiOperationStatus,
  AiOperationType,
  WORKOUT_SOURCE_BY_OPERATION,
} from "@/constants/access-policy";

const apply = process.argv.includes("--apply");

async function run() {
  // Host only — never anything that resolves to the credential.
  const hostRes: any = await db.execute(
    sql`select inet_server_addr()::text as host`
  );
  const host = (hostRes.rows ?? hostRes)[0]?.host;
  console.log(`Database host: ${host ?? "(local socket)"}`);
  console.log(apply ? "Mode: APPLY (writes)" : "Mode: dry-run (no writes)");

  const candidates = await db
    .select({
      workoutId: workouts.id,
      operationType: aiOperations.operationType,
    })
    .from(workouts)
    .innerJoin(aiOperations, eq(aiOperations.resultWorkoutId, workouts.id))
    .where(
      and(
        isNull(workouts.sourceType),
        eq(aiOperations.status, AiOperationStatus.COMPLETED)
      )
    );

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const counts = new Map<string, number>();
  let skipped = 0;

  for (const row of candidates) {
    const sourceType =
      WORKOUT_SOURCE_BY_OPERATION[row.operationType as AiOperationType];
    if (!sourceType) {
      // An operation type with no lineage mapping — report it rather than
      // silently dropping the row, since that means the map needs updating.
      console.warn(
        `  ! workout ${row.workoutId}: unmapped operation_type "${row.operationType}"`
      );
      skipped += 1;
      continue;
    }

    counts.set(sourceType, (counts.get(sourceType) ?? 0) + 1);

    if (apply) {
      await db
        .update(workouts)
        .set({ sourceType })
        // Re-check the NULL so a concurrent settlement's tag is never clobbered.
        .where(and(eq(workouts.id, row.workoutId), isNull(workouts.sourceType)));
    }
  }

  console.log(`\n${apply ? "Backfilled" : "Would backfill"}:`);
  for (const [tag, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tag.padEnd(18)} ${n}`);
  }
  if (skipped) console.log(`  (skipped ${skipped} unmapped)`);

  const remaining = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workouts)
    .where(isNull(workouts.sourceType));
  console.log(
    `\nStill NULL after this run: ${remaining[0].n} (plans predating the ledger — expected).`
  );
  if (!apply) console.log("\nRe-run with --apply to write.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
