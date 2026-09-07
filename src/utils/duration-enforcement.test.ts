import { describe, it, expect } from "@jest/globals";
import {
  fitDaysToTargetDuration,
  estimateBlockMinutes,
  reconcileDeclaredDurations,
} from "@/utils/duration-enforcement";

const day = (dayNum: number, blocks: any[]) => ({ day: dayNum, blocks });
// restTime matters now that padding prices a set by the work it really adds
// rather than by the block's self-reported minutes: a strength block with zero
// rest isn't something the generator produces, and a set added to one is worth
// only its ~35 seconds of reps.
const trad = (minutes: number, exercises: Array<{ sets: number }>) => ({
  blockType: "traditional",
  blockDurationMinutes: minutes,
  exercises: exercises.map((e, i) => ({
    exerciseName: `ex${i}`,
    sets: e.sets,
    reps: 10,
    restTime: 90,
  })),
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

describe("fitDaysToTargetDuration [duration backstop]", () => {
  it("leaves an in-range day unchanged", () => {
    const plan = [day(1, [warmup(), trad(38, [{ sets: 4 }, { sets: 4 }, { sets: 4 }]), cooldown()])]; // 44m
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(res.findings).toHaveLength(0);
    expect(total(res.workoutPlan[0])).toBe(44);
  });

  // BEHAVIOR CHANGE: over-target days used to be left alone entirely, which is
  // how a 30-min request shipped ~40 minutes of work. They are now trimmed.
  it("trims an over-target day by removing sets", () => {
    const plan = [day(1, [warmup(), trad(50, [{ sets: 4 }]), cooldown()])]; // 56m, target 45
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(res.trimFindings).toHaveLength(1);
    expect(res.trimFindings[0].setsRemoved).toBeGreaterThan(0);
    expect(total(res.workoutPlan[0])).toBeLessThan(56);
  });

  it("never trims a block below the per-exercise set floor", () => {
    // Wildly over target; the single exercise may not fall below 2 sets.
    const plan = [day(1, [trad(90, [{ sets: 3 }])])];
    const res = fitDaysToTargetDuration(plan, 20, 5);
    expect(res.workoutPlan[0].blocks[0].exercises[0].sets).toBeGreaterThanOrEqual(2);
  });

  it("does not trim a time-capped block (its duration is the cap)", () => {
    const amrap = {
      blockType: "amrap",
      blockDurationMinutes: 60,
      timeCapMinutes: 60,
      exercises: [{ exerciseName: "a", sets: 1, reps: 10 }],
    };
    const res = fitDaysToTargetDuration([day(1, [amrap])], 30, 5);
    expect(res.trimFindings).toHaveLength(0);
    expect(res.workoutPlan[0].blocks[0].blockDurationMinutes).toBe(60);
  });

  it("pads an under-target day toward the target by adding sets", () => {
    // 3 + 30 + 3 = 36m, target 60.
    //
    // It closes most of the gap but lands at 54, just under the 55 floor, and
    // that is the honest answer: 3 exercises capped at MAX_SETS_PER_EXERCISE
    // can absorb 9 more sets, worth ~2 min each at 90s rest. The old code
    // cleared 55 only because it priced each added set off the block's
    // self-reported 30 minutes for ~6 minutes of real work. Padding is now
    // bounded by what the user would actually perform, so the invariant is
    // "gets materially closer without overshooting", not "always reaches
    // floor".
    const plan = [day(1, [warmup(), trad(30, [{ sets: 3 }, { sets: 3 }, { sets: 3 }]), cooldown()])];
    const res = fitDaysToTargetDuration(plan, 60, 5);
    const after = total(res.workoutPlan[0]);
    expect(after).toBeGreaterThan(50); // closed most of the 36 -> 60 gap
    expect(after).toBeLessThanOrEqual(65); // never past target + tolerance
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].before).toBe(36);
    // Real work was added: sets increased.
    const mainBlock = res.workoutPlan[0].blocks[1];
    expect(mainBlock.exercises[0].sets).toBeGreaterThan(3);
  });

  it("pads a rounds-based circuit by adding rounds", () => {
    const plan = [day(1, [warmup(), circuit(20, 4, 4), cooldown()])]; // 26m, target 45
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBeGreaterThanOrEqual(40);
    const circuitBlock = res.workoutPlan[0].blocks[1];
    expect(circuitBlock.rounds).toBeGreaterThan(4);
  });

  it("does not mutate the input plan", () => {
    const plan = [day(1, [warmup(), trad(30, [{ sets: 3 }]), cooldown()])];
    const before = JSON.parse(JSON.stringify(plan));
    fitDaysToTargetDuration(plan, 60, 5);
    expect(plan).toEqual(before);
  });

  it("leaves a day with only warmup/cooldown unchanged (nothing padable)", () => {
    const plan = [day(1, [warmup(), cooldown()])]; // 6m
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBe(6);
    expect(res.findings).toHaveLength(0);
  });

  it("respects the per-exercise set cap (does not add unbounded sets)", () => {
    const plan = [day(1, [trad(10, [{ sets: 5 }])])]; // one exercise near the cap
    const res = fitDaysToTargetDuration(plan, 90, 5);
    const ex = res.workoutPlan[0].blocks[0].exercises[0];
    expect(ex.sets).toBeLessThanOrEqual(6); // capped; can't reach 90 but never runs away
  });

  it("does NOT pad a time-capped block (amrap) — would be fictitious minutes", () => {
    const amrap = { blockType: "amrap", blockDurationMinutes: 12, timeCapMinutes: 12, rounds: 5, exercises: [{ exerciseName: "a", sets: 1 }, { exerciseName: "b", sets: 1 }] };
    const plan = [day(1, [warmup(), amrap, cooldown()])]; // 18m, target 45
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBe(18); // unchanged
    expect(res.findings).toHaveLength(0);
    expect(res.workoutPlan[0].blocks[1].rounds).toBe(5); // rounds untouched
  });

  it("does NOT pad a rep-scheme block (for_time 21-15-9)", () => {
    const forTime = { blockType: "for_time", blockDurationMinutes: 15, rounds: 3, protocolConfig: { repScheme: [21, 15, 9] }, exercises: [{ exerciseName: "t", sets: 1 }] };
    const plan = [day(1, [warmup(), forTime, cooldown()])]; // 21m
    const res = fitDaysToTargetDuration(plan, 60, 5);
    expect(total(res.workoutPlan[0])).toBe(21);
    expect(res.workoutPlan[0].blocks[1].rounds).toBe(3);
  });

  it("does NOT overshoot past target+tolerance from one big-unit bump", () => {
    // Single circuit at rounds=1 worth 30m; one round would jump 36 -> 66 for a
    // 45m target (ceiling 50) — must be skipped, leaving the day under, not over.
    const bigCircuit = { blockType: "circuit", blockDurationMinutes: 30, rounds: 1, exercises: [{ exerciseName: "c", sets: 1 }, { exerciseName: "d", sets: 1 }] };
    const plan = [day(1, [warmup(), bigCircuit, cooldown()])]; // 36m
    const res = fitDaysToTargetDuration(plan, 45, 5);
    expect(total(res.workoutPlan[0])).toBeLessThanOrEqual(50); // never overshoots
    expect(res.workoutPlan[0].blocks[1].rounds).toBe(1); // not bumped
  });

  it("skips padding when target is unknown (0)", () => {
    const plan = [day(1, [trad(30, [{ sets: 3 }])])];
    const res = fitDaysToTargetDuration(plan, 0, 5);
    expect(res.findings).toHaveLength(0);
    expect(res.trimFindings).toHaveLength(0);
    expect(res.workoutPlan[0]).toBe(plan[0]); // untouched
  });
});

/**
 * [Duration honesty] Fixtures are the real blocks from prod user 41's plans 843
 * and 844 (2026-09-07), the report that prompted this work: "the prescribed
 * plan was too much volume". Each one declared a duration its own prescribed
 * REST already consumed, before a single rep was performed.
 */
const ex = (
  name: string,
  sets: number,
  reps: number,
  restTime: number
) => ({ exerciseName: name, sets, reps, restTime, weight: 0, duration: 0 });

describe("estimateBlockMinutes [duration honesty]", () => {
  it("prices the prod block that claimed 18 min against 25.5 min of rest", () => {
    // 843 Mon "Lower Body Strength": declared 18.
    const block = {
      blockType: "traditional",
      blockName: "Lower Body Strength",
      blockDurationMinutes: 18,
      exercises: [
        ex("Barbell Back Squat", 4, 5, 180),
        ex("Box Deadlift", 3, 5, 180),
        ex("Bulgarian Split Squat", 3, 8, 90),
      ],
    };
    // Rest alone is 25.5 min; the estimate must clear that and the declaration.
    expect(estimateBlockMinutes(block)!).toBeGreaterThan(25.5);
    expect(estimateBlockMinutes(block)!).toBeGreaterThan(18);
  });

  it("returns null for blocks whose duration is a cap, not a set count", () => {
    for (const blockType of ["amrap", "emom", "for_time", "tabata", "circuit", "flow"]) {
      expect(
        estimateBlockMinutes({
          blockType,
          blockDurationMinutes: 10,
          exercises: [ex("x", 1, 10, 0)],
        })
      ).toBeNull();
    }
  });

  it("uses a time-based entry's own seconds rather than a rep tempo", () => {
    const block = {
      blockType: "traditional",
      blockDurationMinutes: 5,
      exercises: [{ exerciseName: "Plank", sets: 3, reps: 0, duration: 60, restTime: 60 }],
    };
    // 3 x (60s hold + 60s rest) = 6 min.
    expect(estimateBlockMinutes(block)!).toBeCloseTo(6, 1);
  });

  it("returns null for an empty block rather than 0 minutes", () => {
    expect(
      estimateBlockMinutes({ blockType: "traditional", blockDurationMinutes: 15, exercises: [] })
    ).toBeNull();
  });
});

describe("reconcileDeclaredDurations [duration honesty]", () => {
  // The four prod blocks whose declared minutes their rest alone consumed.
  const cases = [
    { label: "843 Mon Lower Body Strength", declared: 18, exercises: [ex("Barbell Back Squat", 4, 5, 180), ex("Box Deadlift", 3, 5, 180), ex("Bulgarian Split Squat", 3, 8, 90)] },
    { label: "843 Thu Bench Press Strength", declared: 12, exercises: [ex("Barbell Bench Press", 6, 5, 120), ex("Dumbbell Floor Skullcrusher", 5, 8, 90)] },
    { label: "844 Fri Overhead Press", declared: 15, exercises: [ex("Barbell Strict Press", 6, 5, 150), ex("Dumbbell Z-Press", 4, 8, 90)] },
    { label: "844 Wed Bench Press Strength", declared: 15, exercises: [ex("Barbell Bench Press", 6, 5, 120), ex("Dumbbell Floor Skullcrusher", 4, 8, 60)] },
  ];

  for (const c of cases) {
    it(`corrects ${c.label} upward (declared ${c.declared} min)`, () => {
      const block = {
        blockType: "traditional",
        blockName: c.label,
        blockDurationMinutes: c.declared,
        exercises: c.exercises,
      };
      const findings = reconcileDeclaredDurations({ day: 1, blocks: [block] });
      expect(findings).toHaveLength(1);
      expect(findings[0].declared).toBe(c.declared);
      expect(block.blockDurationMinutes).toBeGreaterThan(c.declared);
    });
  }

  it("leaves an OVERSTATED block alone (correction is one-directional)", () => {
    // Declares 30 min for ~4 min of work — wrong, but correcting it downward
    // would feed the padder and add volume nothing has validated.
    const block = {
      blockType: "traditional",
      blockDurationMinutes: 30,
      exercises: [ex("Goblet Squat", 2, 10, 30)],
    };
    const findings = reconcileDeclaredDurations({ day: 1, blocks: [block] });
    expect(findings).toHaveLength(0);
    expect(block.blockDurationMinutes).toBe(30);
  });

  it("ignores a gap inside the tolerance margin", () => {
    // ~13.2 min of work declared as 12 — within the 3-min margin.
    const block = {
      blockType: "traditional",
      blockDurationMinutes: 12,
      exercises: [ex("Barbell Row", 4, 8, 165)],
    };
    expect(reconcileDeclaredDurations({ day: 1, blocks: [block] })).toHaveLength(0);
    expect(block.blockDurationMinutes).toBe(12);
  });
});

describe("fitDaysToTargetDuration [end to end on the prod regression]", () => {
  it("brings user 41's 30-min Monday back inside its budget", () => {
    // 843 day 0 exactly as it shipped: declared 18 + 12 = 30, so every existing
    // check passed — while the strength block alone prescribed ~28 min.
    const strength = {
      blockType: "traditional",
      blockName: "Lower Body Strength",
      blockDurationMinutes: 18,
      exercises: [
        ex("Barbell Back Squat", 4, 5, 180),
        ex("Box Deadlift", 3, 5, 180),
        ex("Bulgarian Split Squat", 3, 8, 90),
      ],
    };
    const finisher = {
      blockType: "circuit",
      blockName: "Metabolic Cardio Finisher",
      blockDurationMinutes: 12,
      rounds: 3,
      exercises: [ex("Stationary Bike Sprint", 1, 0, 15)],
    };
    const plan = [day(0, [strength, finisher])];
    const res = fitDaysToTargetDuration(plan, 30, 5);

    // The understatement is caught and named.
    expect(res.reconcileFindings).toHaveLength(1);
    expect(res.reconcileFindings[0].blockName).toBe("Lower Body Strength");
    expect(res.reconcileFindings[0].declared).toBe(18);
    // And the day is trimmed back to the 30-min budget she asked for.
    expect(res.trimFindings).toHaveLength(1);
    expect(total(res.workoutPlan[0])).toBeLessThanOrEqual(35);
    // The cardio finisher is untouched — only set-based blocks are trimmed.
    expect(res.workoutPlan[0].blocks[1].blockDurationMinutes).toBe(12);
    expect(res.workoutPlan[0].blocks[1].rounds).toBe(3);
  });

  it("does not mutate the caller's plan while trimming", () => {
    const strength = {
      blockType: "traditional",
      blockDurationMinutes: 18,
      exercises: [ex("Barbell Back Squat", 4, 5, 180), ex("Box Deadlift", 3, 5, 180)],
    };
    const plan = [day(0, [strength])];
    const snapshot = JSON.stringify(plan);
    fitDaysToTargetDuration(plan, 30, 5);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});
