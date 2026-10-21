import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { eq, inArray, sql } from "drizzle-orm";

// The rewrite LLM is stubbed: these tests prove the DB wiring (the guard, the
// name pass, the stale-stamp check), not the model's prose.
const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@/services/ai-provider.service", () => ({
  aiProviderService: {
    createLLMInstance: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  },
}));

import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { prompts } from "@/models/prompts.schema";
import { exercises } from "@/models/exercise.schema";
import { workouts, planDays, workoutBlocks, planDayExercises } from "@/models/workout.schema";
import { swapTextReconcileService, SwapTextContext } from "@/services/swap-text-reconcile.service";

/**
 * Integration test for keeping day + block prose in step with an exercise
 * swap. Runs against the LOCAL database and skips cleanly when none is
 * reachable.
 */
let dbAvailable = false;
const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

let userId: number;
let promptId: number;
let workoutId: number;
let oldExerciseId: number;
let newExerciseId: number;
let planDayId: number;
let blockId: number;
let pdeIds: number[];

const ctx = (): SwapTextContext => ({
  planDayId,
  workoutBlockId: blockId,
  oldExerciseId,
  oldExerciseName: "Barbell Back Squat",
  newExerciseName: "Deadlift",
});

async function readBack() {
  const day = await db.query.planDays.findFirst({ where: eq(planDays.id, planDayId) });
  const block = await db.query.workoutBlocks.findFirst({ where: eq(workoutBlocks.id, blockId) });
  return { day: day!, block: block! };
}

async function clearDay() {
  if (!planDayId) return;
  await db.delete(planDayExercises).where(eq(planDayExercises.workoutBlockId, blockId));
  await db.delete(workoutBlocks).where(eq(workoutBlocks.id, blockId));
  await db.delete(planDays).where(eq(planDays.id, planDayId));
}

describe("swap prose reconcile (integration, local DB)", () => {
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
      .values({ email: `swap-prose-${tag}@testers.mastersfit.ai`, name: "Test Person" })
      .returning({ id: users.id });
    userId = user.id;
    const [prompt] = await db
      .insert(prompts)
      .values({ userId, prompt: "swap-prose test", response: "{}" })
      .returning({ id: prompts.id });
    promptId = prompt.id;
    const [w] = await db
      .insert(workouts)
      .values({
        userId,
        promptId,
        name: "Swap-prose test plan",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        isActive: true,
        completed: false,
      })
      .returning({ id: workouts.id });
    workoutId = w.id;
    const two = await db.select({ id: exercises.id }).from(exercises).limit(2);
    oldExerciseId = two[0].id;
    newExerciseId = two[1].id;
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    mockInvoke.mockReset();
    await clearDay();
    // The real case: warm-up row + working row, both the old exercise.
    const [day] = await db
      .insert(planDays)
      .values({
        workoutId,
        date: "2026-10-21",
        name: "Strength — Barbell Back Squat + Metcon",
        description: "Back squat strength work followed by a finisher.",
        instructions: "Begin with the squat progression.",
      })
      .returning({ id: planDays.id });
    planDayId = day.id;
    const [block] = await db
      .insert(workoutBlocks)
      .values({ planDayId, blockName: "Barbell Back Squat", instructions: "Keep knees tracking over toes.", order: 1 })
      .returning({ id: workoutBlocks.id });
    blockId = block.id;
    const rows = await db
      .insert(planDayExercises)
      .values([
        { workoutBlockId: blockId, exerciseId: oldExerciseId, sets: 1, reps: 6, order: 1 },
        { workoutBlockId: blockId, exerciseId: oldExerciseId, sets: 4, reps: 6, order: 2 },
      ])
      .returning({ id: planDayExercises.id });
    pdeIds = rows.map((r) => r.id);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await clearDay();
    await db.delete(workouts).where(eq(workouts.id, workoutId));
    await db.delete(prompts).where(eq(prompts.id, promptId));
    await db.delete(users).where(eq(users.id, userId));
  });

  /** What replaceExercise does before calling the service. */
  async function swapRows(ids: number[]) {
    await db
      .update(planDayExercises)
      .set({ exerciseId: newExerciseId })
      .where(inArray(planDayExercises.id, ids));
  }

  it("leaves the prose alone while the old exercise is still in the day", async () => {
    if (!dbAvailable) return;
    await swapRows([pdeIds[0]]); // only the warm-up row
    const result = await swapTextReconcileService.applyNameReplacement(ctx());
    expect(result).toBeNull();
    const { day, block } = await readBack();
    expect(day.name).toBe("Strength — Barbell Back Squat + Metcon");
    expect(block.blockName).toBe("Barbell Back Squat");
  });

  it("replaces the exact name once the last old row is swapped", async () => {
    if (!dbAvailable) return;
    await swapRows(pdeIds);
    const result = await swapTextReconcileService.applyNameReplacement(ctx());
    expect(result).not.toBeNull();
    const { day, block } = await readBack();
    expect(day.name).toBe("Strength — Deadlift + Metcon");
    expect(block.blockName).toBe("Deadlift");
    // Paraphrases are pass 2's job.
    expect(day.description).toBe("Back squat strength work followed by a finisher.");
  });

  it("applies the LLM rewrite when nothing changed since the name pass", async () => {
    if (!dbAvailable) return;
    await swapRows(pdeIds);
    const pass1 = (await swapTextReconcileService.applyNameReplacement(ctx()))!;
    mockInvoke.mockResolvedValue({
      dayDescription: "Deadlift strength work followed by a finisher.",
      dayInstructions: "Begin with the deadlift progression.",
      blockInstructions: "Brace hard and keep the bar close.",
    });
    await swapTextReconcileService.applyLlmRewrite(ctx(), pass1.prose, pass1.stampedAt);
    const { day, block } = await readBack();
    expect(day.description).toBe("Deadlift strength work followed by a finisher.");
    expect(day.instructions).toBe("Begin with the deadlift progression.");
    expect(block.instructions).toBe("Brace hard and keep the bar close.");
    expect(day.name).toBe("Strength — Deadlift + Metcon");
  });

  it("drops a late rewrite if the day was edited after the name pass", async () => {
    if (!dbAvailable) return;
    await swapRows(pdeIds);
    const pass1 = (await swapTextReconcileService.applyNameReplacement(ctx()))!;
    await db
      .update(planDays)
      .set({ name: "Regenerated Day", updatedAt: new Date(pass1.stampedAt.getTime() + 1000) })
      .where(eq(planDays.id, planDayId));
    mockInvoke.mockResolvedValue({
      dayDescription: "Deadlift strength work.",
      blockInstructions: "Brace hard.",
    });
    await swapTextReconcileService.applyLlmRewrite(ctx(), pass1.prose, pass1.stampedAt);
    const { day, block } = await readBack();
    expect(day.name).toBe("Regenerated Day");
    expect(day.description).toBe("Back squat strength work followed by a finisher.");
    // Rolled back as a pair — the block didn't get its half either.
    expect(block.instructions).toBe("Keep knees tracking over toes.");
  });
});
