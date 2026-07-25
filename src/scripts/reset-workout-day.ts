/**
 * Rewind ONE plan day back to "not started" so you can replay workout logging
 * on a stable QA account without regenerating a whole plan.
 *
 * It surgically un-completes a single day: deletes that day's set/exercise/
 * block/day logs, flips the completion flags on the plan day + its exercises
 * back to false, un-completes the parent workout, and rebuilds the
 * workout_logs rollup (completedDays / completedExercises / completedBlocks /
 * daysCompleted) so the dashboard and streak stay consistent.
 *
 * SAFE BY DESIGN: refuses to run against a non-local DATABASE_URL unless you
 * pass --remote. Only the day you name (for the one user you name) is touched.
 * The plan, profile, subscription, and every other day's history are left
 * intact. Pass --dry-run to preview without writing anything.
 *
 * Usage:
 *   # Reset today's session (profile timezone) on the LOCAL db:
 *   npm run reset-workout-day -- --email rtp+qa@mastersfit.ai
 *
 *   # Reset a specific date:
 *   npm run reset-workout-day -- --email rtp+qa@mastersfit.ai --date 2026-07-25
 *
 *   # Preview only (no writes):
 *   npm run reset-workout-day -- --email rtp+qa@mastersfit.ai --dry-run
 *
 *   # Against production (Neon) — override DATABASE_URL inline and opt in:
 *   DATABASE_URL=<neon-url> npm run reset-workout-day -- \
 *     --email rtp+qa@mastersfit.ai --remote
 */

import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { profiles } from "@/models/profile.schema";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
} from "@/models/workout.schema";
import {
  exerciseLogs,
  exerciseSetLogs,
  blockLogs,
  planDayLogs,
  workoutLogs,
} from "@/models/logs.schema";
import { and, eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const email = argValue("--email");
const dateArg = argValue("--date");
const allowRemote = process.argv.includes("--remote");
const dryRun = process.argv.includes("--dry-run");

if (!email) {
  console.error(
    "Usage: npm run reset-workout-day -- --email <email> [--date YYYY-MM-DD] [--remote] [--dry-run]"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guardrail: local-only unless --remote (mirrors seed-demo-user.ts)
// ---------------------------------------------------------------------------
function assertLocalDatabase(): void {
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
        `Re-run with --remote to reset a day on a non-local database (e.g. Neon). ` +
        `Only the one day for ${email} is touched.`
    );
    process.exit(1);
  }
  if (!isLocal) {
    console.warn(
      `⚠️  --remote: operating on NON-LOCAL database "${host}" for ${email}.`
    );
  }
}

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
function todayInTimezone(tz: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the plan_days.date shape.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
async function run() {
  assertLocalDatabase();

  const user = await db.query.users.findFirst({
    where: eq(users.email, email!),
  });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  // Resolve the target date. Default = "today" in the account's profile
  // timezone, matching how the app/streak logic decides what "today" is
  // (avoids the UTC-vs-local streak mismatch).
  let targetDate = dateArg;
  if (!targetDate) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.userId, user.id),
    });
    const tz = profile?.timezone || "UTC";
    targetDate = todayInTimezone(tz);
    console.log(`No --date given; using "today" = ${targetDate} (tz: ${tz}).`);
  }

  // Find the plan day for this date among THIS user's workouts. Prefer the
  // active workout if the same date somehow appears in more than one.
  const userWorkouts = await db
    .select({ id: workouts.id, isActive: workouts.isActive })
    .from(workouts)
    .where(eq(workouts.userId, user.id));
  const workoutIds = userWorkouts.map((w) => w.id);
  if (!workoutIds.length) {
    console.error(`User ${email} has no workouts.`);
    process.exit(1);
  }

  const candidateDays = await db
    .select({ id: planDays.id, workoutId: planDays.workoutId, name: planDays.name })
    .from(planDays)
    .where(
      and(inArray(planDays.workoutId, workoutIds), eq(planDays.date, targetDate))
    );

  if (!candidateDays.length) {
    console.error(
      `No plan day found for ${email} on ${targetDate}. ` +
        `(Nothing to reset — check the date or that a plan covers it.)`
    );
    process.exit(1);
  }

  const activeWorkoutIds = new Set(
    userWorkouts.filter((w) => w.isActive).map((w) => w.id)
  );
  const planDay =
    candidateDays.find((d) => activeWorkoutIds.has(d.workoutId)) ??
    candidateDays[0];
  const workoutId = planDay.workoutId;

  console.log(
    `Target: plan day id=${planDay.id} "${planDay.name ?? ""}" ` +
      `date=${targetDate} in workout id=${workoutId}` +
      (candidateDays.length > 1
        ? ` (chose active workout out of ${candidateDays.length} matches)`
        : "")
  );

  // Gather the dependent row ids for this one day.
  const blocks = await db
    .select({ id: workoutBlocks.id })
    .from(workoutBlocks)
    .where(eq(workoutBlocks.planDayId, planDay.id));
  const blockIds = blocks.map((b) => b.id);

  const pdes = blockIds.length
    ? await db
        .select({ id: planDayExercises.id })
        .from(planDayExercises)
        .where(inArray(planDayExercises.workoutBlockId, blockIds))
    : [];
  const pdeIds = pdes.map((p) => p.id);

  const elogs = pdeIds.length
    ? await db
        .select({ id: exerciseLogs.id })
        .from(exerciseLogs)
        .where(inArray(exerciseLogs.planDayExerciseId, pdeIds))
    : [];
  const elogIds = elogs.map((e) => e.id);

  console.log(
    `Found ${blockIds.length} block(s), ${pdeIds.length} exercise(s), ` +
      `${elogIds.length} exercise log(s) to clear for this day.`
  );

  if (dryRun) {
    console.log("\n--dry-run: no changes written. Would have:");
    console.log(`  • deleted set/exercise/block/day logs for day ${planDay.id}`);
    console.log(`  • set plan_days.is_complete=false, exercises.completed=false`);
    console.log(`  • set workouts.completed=false for workout ${workoutId}`);
    console.log(`  • removed day ${planDay.id} from workout_logs rollup`);
    process.exit(0);
  }

  // 1. Delete the logs, deepest first (FK order).
  if (elogIds.length) {
    await db
      .delete(exerciseSetLogs)
      .where(inArray(exerciseSetLogs.exerciseLogId, elogIds));
    await db
      .delete(exerciseLogs)
      .where(inArray(exerciseLogs.planDayExerciseId, pdeIds));
    console.log("  ✓ deleted exercise_set_logs + exercise_logs");
  }
  if (blockIds.length) {
    await db
      .delete(blockLogs)
      .where(inArray(blockLogs.workoutBlockId, blockIds));
    console.log("  ✓ deleted block_logs");
  }
  await db.delete(planDayLogs).where(eq(planDayLogs.planDayId, planDay.id));
  console.log("  ✓ deleted plan_day_logs");

  // 2. Flip completion flags back to "not started".
  if (pdeIds.length) {
    await db
      .update(planDayExercises)
      .set({ completed: false, isSkipped: false })
      .where(inArray(planDayExercises.id, pdeIds));
  }
  await db
    .update(planDays)
    .set({ isComplete: false })
    .where(eq(planDays.id, planDay.id));
  await db
    .update(workouts)
    .set({ completed: false })
    .where(eq(workouts.id, workoutId));
  console.log(
    "  ✓ plan_days.is_complete=false, plan_day_exercises.completed=false, workouts.completed=false"
  );

  // 3. Rebuild the workout_logs rollup so dashboard/streak stay consistent:
  //    drop this day (and its exercises/blocks) from the completed arrays.
  const wlog = await db.query.workoutLogs.findFirst({
    where: eq(workoutLogs.workoutId, workoutId),
  });
  if (wlog) {
    const pdeSet = new Set(pdeIds);
    const blockSet = new Set(blockIds);
    const newCompletedDays = (wlog.completedDays ?? []).filter(
      (id) => id !== planDay.id
    );
    const newCompletedExercises = (wlog.completedExercises ?? []).filter(
      (id) => !pdeSet.has(id)
    );
    const newCompletedBlocks = (wlog.completedBlocks ?? []).filter(
      (id) => !blockSet.has(id)
    );
    await db
      .update(workoutLogs)
      .set({
        completedDays: newCompletedDays,
        completedExercises: newCompletedExercises,
        completedBlocks: newCompletedBlocks,
        daysCompleted: newCompletedDays.length,
        isComplete: false,
        isActive: true,
      })
      .where(eq(workoutLogs.workoutId, workoutId));
    console.log(
      `  ✓ workout_logs rollup updated (daysCompleted -> ${newCompletedDays.length})`
    );
  } else {
    console.log("  — no workout_logs row for this workout; skipped rollup");
  }

  console.log(
    `\nDone. Day ${targetDate} for ${email} is reset to not-started — ` +
      `re-open the app and log it again.`
  );
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
