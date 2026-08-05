import { describe, it, expect } from "@jest/globals";
import { padDaysToTargetDuration } from "@/utils/duration-enforcement";

const day = (dayNum: number, blocks: any[]) => ({ day: dayNum, blocks });
const trad = (minutes: number, exercises: Array<{ sets: number }>) => ({
  blockType: "traditional",
  blockDurationMinutes: minutes,
  exercises: exercises.map((e, i) => ({ exerciseName: `ex${i}`, sets: e.sets, reps: 10 })),
});
const circuit = (minutes: number, rounds: number, exCount: number) => ({
  blockType: "circuit",
  blockDurationMinutes: minutes,
  rounds,
  exercises: Array.from({ length: exCount }, (_, i) => ({ exerciseName: `c${i}`, sets: 1 })),
});
const warmup = () => ({ blockType: "warmup", blockDurationMinutes: 3, exercises: [{ exerciseName: "w", sets: 1 }] });
const cooldown = () => ({ blockType: "cooldown", blockDurationMinutes: 3, exercises: [{ exerciseName: "cd", sets: 1 }] });

const total = (d: any) => d.blocks.reduce((s: number, b: any) => s + b.blockDurationMinutes, 0);

describe("padDaysToTargetDuration [duration backstop]", () => {
  it("leaves an in-range day unchanged", () => {
    const plan = [day(1, [warmup(), trad(38, [{ sets: 4 }, { sets: 4 }, { sets: 4 }]), cooldown()])]; // 44m
    const res = padDaysToTargetDuration(plan, 45, 5);
    expect(res.findings).toHaveLength(0);
    expect(total(res.workoutPlan[0])).toBe(44);
  });

  it("leaves an over-target day unchanged", () => {
    const plan = [day(1, [warmup(), trad(50, [{ sets: 4 }]), cooldown()])]; // 56m, target 45
    const res = padDaysToTargetDuration(plan, 45, 5);
    expect(res.findings).toHaveLength(0);
  });

  it("pads an under-target day to within tolerance by adding sets", () => {
    // 3 + 30 + 3 = 36m, target 60 -> must reach >= 55.
    const plan = [day(1, [warmup(), trad(30, [{ sets: 3 }, { sets: 3 }, { sets: 3 }]), cooldown()])];
    const res = padDaysToTargetDuration(plan, 60, 5);
    expect(total(res.workoutPlan[0])).toBeGreaterThanOrEqual(55);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].before).toBe(36);
    expect(res.findings[0].after).toBeGreaterThanOrEqual(55);
    // Real work was added: sets increased.
    const mainBlock = res.workoutPlan[0].blocks[1];
    expect(mainBlock.exercises[0].sets).toBeGreaterThan(3);
  });

  it("pads a rounds-based circuit by adding rounds", () => {
    const plan = [day(1, [warmup(), circuit(20, 4, 4), cooldown()])]; // 26m, target 45
    const res = padDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBeGreaterThanOrEqual(40);
    const circuitBlock = res.workoutPlan[0].blocks[1];
    expect(circuitBlock.rounds).toBeGreaterThan(4);
  });

  it("does not mutate the input plan", () => {
    const plan = [day(1, [warmup(), trad(30, [{ sets: 3 }]), cooldown()])];
    const before = JSON.parse(JSON.stringify(plan));
    padDaysToTargetDuration(plan, 60, 5);
    expect(plan).toEqual(before);
  });

  it("leaves a day with only warmup/cooldown unchanged (nothing padable)", () => {
    const plan = [day(1, [warmup(), cooldown()])]; // 6m
    const res = padDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBe(6);
    expect(res.findings).toHaveLength(0);
  });

  it("respects the per-exercise set cap (does not add unbounded sets)", () => {
    const plan = [day(1, [trad(10, [{ sets: 5 }])])]; // one exercise near the cap
    const res = padDaysToTargetDuration(plan, 90, 5);
    const ex = res.workoutPlan[0].blocks[0].exercises[0];
    expect(ex.sets).toBeLessThanOrEqual(6); // capped; can't reach 90 but never runs away
  });

  it("skips padding when target is unknown (0)", () => {
    const plan = [day(1, [trad(30, [{ sets: 3 }])])];
    const res = padDaysToTargetDuration(plan, 0, 5);
    // floor = -5, 30 >= -5 so no-op.
    expect(res.findings).toHaveLength(0);
  });
});
