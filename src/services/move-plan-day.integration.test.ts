import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { prompts } from "@/models/prompts.schema";
import { exercises } from "@/models/exercise.schema";
import {
  workouts,
  planDays,
  workoutBlocks,
  planDayExercises,
} from "@/models/workout.schema";
import { exerciseLogs } from "@/models/logs.schema";
import { planDayMoveService } from "@/services/plan-day-move.service";

/**
 * Integration test for moving / swapping planned workouts between days. Runs
 * against the LOCAL database and skips cleanly when none is reachable.
 *
 * What only real SQL can prove: the two dates really trade places in one
 * transaction, dayNumber follows the new date order, and a day with any logged
 * work is refused rather than silently re-dated.
 */
let dbAvailable = false;
const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const TZ = "UTC";

/** YYYY-MM-DD for today + n days, in UTC (matches TZ passed to the service). */
const day = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let userId: number;
let workoutId: number;
let promptId: number;
let exerciseId: number;
/** label → plan day id, rebuilt before each test. */
let ids: Record<string, number>;

async function datesById(): Promise<Record<number, { date: string; dayNumber: number | null }>> {
  const rows = await db.query.planDays.findMany({
    where: eq(planDays.workoutId, workoutId),
    orderBy: [asc(planDays.date)],
  });
  return Object.fromEntries(rows.map((r) => [r.id, { date: r.date, dayNumber: r.dayNumber }]));
}

async function clearPlan() {
  const days = await db.query.planDays.findMany({ where: eq(planDays.workoutId, workoutId) });
  const dayIds = days.map((d) => d.id);
  if (dayIds.length === 0) return;
  const blocks = await db.query.workoutBlocks.findMany({
    where: inArray(workoutBlocks.planDayId, dayIds),
  });
  const blockIds = blocks.map((b) => b.id);
  if (blockIds.length > 0) {
    const pdes = await db.query.planDayExercises.findMany({
      where: inArray(planDayExercises.workoutBlockId, blockIds),
    });
    const pdeIds = pdes.map((p) => p.id);
    if (pdeIds.length > 0) {
      await db.delete(exerciseLogs).where(inArray(exerciseLogs.planDayExerciseId, pdeIds));
      await db.delete(planDayExercises).where(inArray(planDayExercises.id, pdeIds));
    }
    await db.delete(workoutBlocks).where(inArray(workoutBlocks.id, blockIds));
  }
  await db.delete(planDays).where(inArray(planDays.id, dayIds));
}

async function addDay(label: string, offset: number, dayNumber: number, opts: { complete?: boolean } = {}) {
  const [row] = await db
    .insert(planDays)
    .values({
      workoutId,
      date: day(offset),
      dayNumber,
      name: label,
      isComplete: opts.complete ?? false,
    })
    .returning({ id: planDays.id });
  const [block] = await db
    .insert(workoutBlocks)
    .values({ planDayId: row.id, blockName: `${label} block`, order: 1 })
    .returning({ id: workoutBlocks.id });
  const [pde] = await db
    .insert(planDayExercises)
    .values({ workoutBlockId: block.id, exerciseId, sets: 3, reps: 10, order: 1 })
    .returning({ id: planDayExercises.id });
  ids[label] = row.id;
  return { planDayId: row.id, pdeId: pde.id };
}

describe("movePlanDay (integration, local DB)", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
    if (!dbAvailable) return;

    const [user] = await db
      .insert(users)
      .values({ email: `move-day-${tag}@testers.mastersfit.ai`, name: "Test Person" })
      .returning({ id: users.id });
    userId = user.id;
    const [prompt] = await db
      .insert(prompts)
      .values({ userId, prompt: "move-day test", response: "{}" })
      .returning({ id: prompts.id });
    promptId = prompt.id;
    const [w] = await db
      .insert(workouts)
      .values({
        userId,
        promptId,
        name: "Move-day test plan",
        startDate: day(-2),
        endDate: day(6),
        isActive: true,
        completed: false,
      })
      .returning({ id: workouts.id });
    workoutId = w.id;
    const [ex] = await db.select({ id: exercises.id }).from(exercises).limit(1);
    exerciseId = ex.id;
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    ids = {};
    await clearPlan();
    // Plan: yesterday (done), today = Strength, +1 rest, +2 = Yoga, +3 = Run.
    await addDay("Done", -1, 1, { complete: true });
    await addDay("Strength", 0, 2);
    await addDay("Yoga", 2, 3);
    await addDay("Run", 3, 4);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await clearPlan();
    await db.delete(workouts).where(eq(workouts.id, workoutId));
    await db.delete(prompts).where(eq(prompts.id, promptId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("swaps today's workout with a later day's (Linley's case)", async () => {
    if (!dbAvailable) return;
    const result = await planDayMoveService.movePlanDay(userId, ids.Yoga, day(0), TZ);
    expect(result).toEqual({
      planDayId: ids.Yoga,
      fromDate: day(2),
      toDate: day(0),
      swappedPlanDayIds: [ids.Strength],
    });
    const after = await datesById();
    expect(after[ids.Yoga].date).toBe(day(0));
    expect(after[ids.Strength].date).toBe(day(2));
    expect(after[ids.Run].date).toBe(day(3));
    // dayNumber follows date order: Done, Yoga, Strength, Run.
    expect(after[ids.Done].dayNumber).toBe(1);
    expect(after[ids.Yoga].dayNumber).toBe(2);
    expect(after[ids.Strength].dayNumber).toBe(3);
    expect(after[ids.Run].dayNumber).toBe(4);
  });

  it("moves onto a rest day, leaving the old date empty", async () => {
    if (!dbAvailable) return;
    const result = await planDayMoveService.movePlanDay(userId, ids.Strength, day(1), TZ);
    expect(result.swappedPlanDayIds).toEqual([]);
    const after = await datesById();
    expect(after[ids.Strength].date).toBe(day(1));
    expect(Object.values(after).some((d) => d.date === day(0))).toBe(false);
  });

  it("refuses when either day has logged work, and changes nothing", async () => {
    if (!dbAvailable) return;
    const before = await datesById();
    const pde = await db.query.planDayExercises.findFirst({
      where: inArray(
        planDayExercises.workoutBlockId,
        (await db.query.workoutBlocks.findMany({ where: eq(workoutBlocks.planDayId, ids.Strength) })).map((b) => b.id)
      ),
    });
    await db.insert(exerciseLogs).values({ planDayExerciseId: pde!.id, isComplete: true });

    await expect(planDayMoveService.movePlanDay(userId, ids.Yoga, day(0), TZ)).rejects.toThrow(
      "started"
    );
    await expect(planDayMoveService.movePlanDay(userId, ids.Strength, day(1), TZ)).rejects.toThrow(
      "started"
    );
    expect(await datesById()).toEqual(before);
  });

  it("refuses a skipped exercise as started", async () => {
    if (!dbAvailable) return;
    const blocks = await db.query.workoutBlocks.findMany({ where: eq(workoutBlocks.planDayId, ids.Run) });
    await db
      .update(planDayExercises)
      .set({ isSkipped: true })
      .where(inArray(planDayExercises.workoutBlockId, blocks.map((b) => b.id)));
    await expect(planDayMoveService.movePlanDay(userId, ids.Run, day(4), TZ)).rejects.toThrow("started");
  });

  it("refuses past dates, completed days, and dates outside the plan", async () => {
    if (!dbAvailable) return;
    await expect(planDayMoveService.movePlanDay(userId, ids.Done, day(1), TZ)).rejects.toThrow(
      "today and later"
    );
    await expect(planDayMoveService.movePlanDay(userId, ids.Yoga, day(-1), TZ)).rejects.toThrow(
      "today and later"
    );
    await expect(planDayMoveService.movePlanDay(userId, ids.Yoga, day(9), TZ)).rejects.toThrow(
      "inside your current plan"
    );
    await expect(planDayMoveService.movePlanDay(userId, ids.Yoga, day(2), TZ)).rejects.toThrow(
      "already on this day"
    );
    await expect(planDayMoveService.movePlanDay(userId, ids.Yoga, "next tuesday", TZ)).rejects.toThrow(
      "Invalid target date"
    );
  });

  it("refuses another user's plan day", async () => {
    if (!dbAvailable) return;
    await expect(planDayMoveService.movePlanDay(userId + 999999, ids.Yoga, day(0), TZ)).rejects.toThrow(
      "Plan day not found"
    );
  });
});
