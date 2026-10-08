import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { prompts } from "@/models/prompts.schema";
import {
  planDayExercises,
  planDays,
  workoutBlocks,
  workouts,
} from "@/models/workout.schema";
import { exerciseLogs } from "@/models/logs.schema";
import { exercises } from "@/models/exercise.schema";
import {
  loggedActivities,
  type ImportedActivityInput,
} from "@/models/logged-activity.schema";
import { loggedActivityService } from "@/services/logged-activity.service";
import { purgeUserData } from "@/services/user.service";

/**
 * Health activity import against the LOCAL database (the import columns and
 * uq_logged_activities_user_external must be applied —
 * src/scripts/sql/add-logged-activity-import.sql). Skips cleanly with no DB.
 *
 * What only real SQL proves: the unique index makes re-sync idempotent, a
 * deleted import stays deleted, and the MastersFit-session overlap is read off
 * real log timestamps (including the timestamp-without-time-zone handling).
 */
let dbAvailable = false;
const createdUserIds: { id: number; email: string }[] = [];
const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const TODAY = "2026-10-08";

async function makeUser(label: string): Promise<number> {
  const email = `import-${tag}-${label}@testers.mastersfit.ai`;
  const [row] = await db
    .insert(users)
    .values({ email, name: "Test Person" })
    .returning({ id: users.id });
  createdUserIds.push({ id: row.id, email });
  return row.id;
}

/** A MastersFit session whose sets were logged at the given instants. */
async function logSession(userId: number, date: string, loggedAt: string[]) {
  const [prompt] = await db
    .insert(prompts)
    .values({ userId, prompt: "test", response: "test" })
    .returning({ id: prompts.id });
  const [workout] = await db
    .insert(workouts)
    .values({
      userId,
      promptId: prompt.id,
      name: "Test plan",
      startDate: date,
      endDate: date,
    })
    .returning({ id: workouts.id });
  const [day] = await db
    .insert(planDays)
    .values({ workoutId: workout.id, date })
    .returning({ id: planDays.id });
  const [block] = await db
    .insert(workoutBlocks)
    .values({ planDayId: day.id })
    .returning({ id: workoutBlocks.id });
  const [exercise] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .limit(1);

  for (const [i, at] of loggedAt.entries()) {
    const [pde] = await db
      .insert(planDayExercises)
      .values({ workoutBlockId: block.id, exerciseId: exercise.id })
      .returning({ id: planDayExercises.id });
    await db.insert(exerciseLogs).values({
      planDayExerciseId: pde.id,
      roundNumber: i + 1,
      // Mimic what now() writes into a timestamp-without-time-zone column:
      // wall-clock time in the DB session's zone.
      createdAt: sql`(${at}::timestamptz AT TIME ZONE current_setting('TimeZone'))`,
    });
  }
}

const watch = (
  overrides: Partial<ImportedActivityInput> = {}
): ImportedActivityInput => ({
  externalId: `hk-${tag}-${Math.random()}`,
  source: "apple_health",
  activityType: "walk",
  date: TODAY,
  startedAt: "2026-10-08T12:00:00.000Z",
  endedAt: "2026-10-08T12:45:00.000Z",
  durationMinutes: 45,
  distanceMeters: 2800,
  ...overrides,
});

describe("Health activity import (integration, local DB)", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    for (const u of createdUserIds) {
      await db.transaction(async (tx) => {
        await purgeUserData(tx, u.id, {
          source: "ops_script",
          email: u.email,
          uuid: null,
        });
      });
    }
  });

  it("imports a walk once — a re-sync of the same workout is a no-op", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("idem");
    const walk = watch();

    const first = await loggedActivityService.importActivities(userId, [walk], TODAY);
    expect(first.imported).toHaveLength(1);
    expect(first.imported[0]).toMatchObject({
      source: "apple_health",
      activityType: "walk",
      distanceMeters: 2800,
    });

    const second = await loggedActivityService.importActivities(userId, [walk], TODAY);
    expect(second.imported).toHaveLength(0);
    expect(second.skippedExisting).toBe(1);
  });

  it("racing syncs land one row (the unique index settles it)", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("race");
    const walk = watch();
    // Warm the pool, or pg serializes the callers and the race never happens.
    await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select 1`)));

    await Promise.all(
      Array.from({ length: 4 }, () =>
        loggedActivityService.importActivities(userId, [walk], TODAY)
      )
    );
    const rows = await loggedActivityService.listActivities(userId);
    expect(rows).toHaveLength(1);
  });

  it("a deleted import disappears and never comes back", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("tomb");
    const walk = watch();
    const { imported } = await loggedActivityService.importActivities(userId, [walk], TODAY);

    await loggedActivityService.deleteActivity(userId, imported[0].id);
    expect(await loggedActivityService.listActivities(userId)).toHaveLength(0);
    expect(await loggedActivityService.getMostRecent(userId)).toHaveLength(0);

    const again = await loggedActivityService.importActivities(userId, [walk], TODAY);
    expect(again.imported).toHaveLength(0);
    expect(again.skippedExisting).toBe(1);

    // Deleting the tombstone itself is a 404, not a hard delete that would
    // let the walk return.
    await expect(
      loggedActivityService.deleteActivity(userId, imported[0].id)
    ).rejects.toThrow("Activity not found.");
  });

  it("manual activities are still hard-deleted", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("manual-del");
    const manual = await loggedActivityService.createActivity(
      userId,
      { date: TODAY, activityType: "golf", durationMinutes: 120 },
      TODAY
    );
    await loggedActivityService.deleteActivity(userId, manual.id);
    const rows = await db
      .select()
      .from(loggedActivities)
      .where(eq(loggedActivities.id, manual.id));
    expect(rows).toHaveLength(0);
  });

  it("skips the watch recording OF a MastersFit session, keeps the walk before it", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("overlap");
    // Sets logged 14:10 → 14:50 UTC.
    await logSession(userId, TODAY, [
      "2026-10-08T14:10:00Z",
      "2026-10-08T14:30:00Z",
      "2026-10-08T14:50:00Z",
    ]);

    const companion = watch({
      activityType: "other",
      customType: "Rowing",
      startedAt: "2026-10-08T14:00:00Z",
      endedAt: "2026-10-08T15:00:00Z",
      durationMinutes: 60,
    });
    const morningWalk = watch({
      startedAt: "2026-10-08T12:00:00Z",
      endedAt: "2026-10-08T12:45:00Z",
    });

    const result = await loggedActivityService.importActivities(
      userId,
      [companion, morningWalk],
      TODAY
    );
    expect(result.skippedSessionOverlap).toBe(1);
    expect(result.imported.map((r) => r.externalId)).toEqual([
      morningWalk.externalId,
    ]);
  });

  it("a set added days later by an edit does not swallow walks in between", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("late-edit");
    await logSession(userId, "2026-10-05", [
      "2026-10-05T14:00:00Z",
      "2026-10-05T14:20:00Z",
      "2026-10-07T20:00:00Z", // edited in later
    ]);

    const result = await loggedActivityService.importActivities(
      userId,
      [
        watch({
          date: "2026-10-06",
          startedAt: "2026-10-06T12:00:00Z",
          endedAt: "2026-10-06T12:45:00Z",
        }),
      ],
      TODAY
    );
    expect(result.imported).toHaveLength(1);
  });

  it("another user's session never suppresses my walk", async () => {
    if (!dbAvailable) return;
    const me = await makeUser("mine");
    const them = await makeUser("theirs");
    await logSession(them, TODAY, ["2026-10-08T12:20:00Z"]);

    const result = await loggedActivityService.importActivities(me, [watch()], TODAY);
    expect(result.imported).toHaveLength(1);
  });

  it("skips a type already logged by hand that day, imports other types", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("manual-dup");
    await loggedActivityService.createActivity(
      userId,
      { date: TODAY, activityType: "walk", durationMinutes: 40 },
      TODAY
    );

    const result = await loggedActivityService.importActivities(
      userId,
      [
        watch(),
        watch({
          activityType: "run",
          startedAt: "2026-10-08T16:00:00Z",
          endedAt: "2026-10-08T16:30:00Z",
        }),
      ],
      TODAY
    );
    expect(result.skippedManualDuplicate).toBe(1);
    expect(result.imported.map((r) => r.activityType)).toEqual(["run"]);
  });

  it("drops a workout dated after the user's today", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("future");
    const result = await loggedActivityService.importActivities(
      userId,
      [watch({ date: "2026-10-09" })],
      TODAY
    );
    expect(result.imported).toHaveLength(0);
  });

  it("account deletion removes imported activities and tombstones", async () => {
    if (!dbAvailable) return;
    const userId = await makeUser("purge");
    const { imported } = await loggedActivityService.importActivities(
      userId,
      [watch(), watch({ activityType: "hike" })],
      TODAY
    );
    await loggedActivityService.deleteActivity(userId, imported[0].id);

    const email = createdUserIds.find((u) => u.id === userId)!.email;
    await db.transaction(async (tx) => {
      await purgeUserData(tx, userId, {
        source: "ops_script",
        email,
        uuid: null,
      } as any);
    });
    createdUserIds.splice(
      createdUserIds.findIndex((u) => u.id === userId),
      1
    );

    const left = await db
      .select()
      .from(loggedActivities)
      .where(and(eq(loggedActivities.userId, userId)));
    expect(left).toHaveLength(0);
  });
});
