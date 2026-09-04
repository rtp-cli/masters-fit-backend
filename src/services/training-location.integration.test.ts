import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { profiles } from "@/models/profile.schema";
import { trainingLocations } from "@/models/training-location.schema";
import { trainingLocationService } from "@/services/training-location.service";

/**
 * Integration test for getUserLocations' primary-location self-heal. Runs
 * against the LOCAL database; skips cleanly when no DB is reachable so DB-less
 * CI does not fail.
 *
 * Only real SQL can prove the thing that matters here: the self-heal reads
 * "this user has no primary" in one statement and inserts in another, so
 * concurrent callers all pass the check and all try to insert. The insert has
 * to no-op on conflict rather than throw, because uq_training_locations_one_primary
 * is a partial unique index and retrying a plain insert can never succeed.
 */
let dbAvailable = false;
const createdUserIds: number[] = [];

const CONCURRENCY = 8;
const stamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

/** A user with a profile environment, and deliberately NO training location. */
async function makeUserWithProfileButNoLocation(): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({
      email: `tl-race-${stamp()}@example.test`,
      name: "Test Person",
      needsOnboarding: false,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);

  await db.insert(profiles).values({
    userId: row.id,
    environment: "commercial_gym" as never,
    equipment: ["barbells", "dumbbells"] as never,
  });

  return row.id;
}

/**
 * Open CONCURRENCY pool connections before racing.
 *
 * Without this the test cannot fail: on a cold pool, pg establishes connections
 * one at a time, which serializes the "concurrent" callers enough that each one
 * sees the previous one's primary row and never reaches the insert. Verified --
 * against the unfixed service the suite passed until this warm-up existed, and
 * failed 7-of-8 once it did.
 */
async function warmPool(): Promise<void> {
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => db.execute(sql`select 1`))
  );
}

async function primaryRowCount(userId: number): Promise<number> {
  const rows = await db
    .select({ id: trainingLocations.id })
    .from(trainingLocations)
    .where(
      and(
        eq(trainingLocations.userId, userId),
        eq(trainingLocations.isPrimary, true)
      )
    );
  return rows.length;
}

describe("trainingLocationService self-heal (integration)", () => {
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
    if (createdUserIds.length > 0) {
      await db
        .delete(trainingLocations)
        .where(inArray(trainingLocations.userId, createdUserIds));
      await db.delete(profiles).where(inArray(profiles.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it("creates exactly one primary, and rejects nobody, when callers race", async () => {
    if (!dbAvailable) return;
    const userId = await makeUserWithProfileButNoLocation();
    await warmPool();

    // Every caller sees "no primary" before any of them has inserted, so all
    // of them reach the insert. Before the ON CONFLICT clause this failed 7 of
    // 8 callers with a duplicate-key error on uq_training_locations_one_primary.
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        trainingLocationService.getUserLocations(userId)
      )
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.map((r) => (r as PromiseRejectedResult).reason?.message)).toEqual([]);

    // The invariant the partial unique index exists to protect.
    expect(await primaryRowCount(userId)).toBe(1);

    // Every caller must come back with the primary, not an empty list -- an
    // empty list is what the mobile client shows as "no saved locations".
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
      const rows = (r as PromiseFulfilledResult<unknown[]>).value;
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent: a second pass adds no rows", async () => {
    if (!dbAvailable) return;
    const userId = await makeUserWithProfileButNoLocation();

    await warmPool();
    await trainingLocationService.getUserLocations(userId);
    expect(await primaryRowCount(userId)).toBe(1);

    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        trainingLocationService.getUserLocations(userId)
      )
    );
    expect(await primaryRowCount(userId)).toBe(1);
  });

  it("leaves the profile's environment on the primary after a raced heal", async () => {
    if (!dbAvailable) return;
    const userId = await makeUserWithProfileButNoLocation();
    await warmPool();

    await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        trainingLocationService.getUserLocations(userId)
      )
    );

    const primary = await trainingLocationService.getPrimary(userId);
    expect(primary).toBeDefined();
    // The loser of the race adopts the winner's row and applies its own
    // environment/equipment to it, so a profile edit racing a self-heal is not
    // silently dropped.
    expect(primary?.environment).toBe("commercial_gym");
  });
});
