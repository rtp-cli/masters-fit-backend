import { describe, it, expect } from "@jest/globals";
import {
  checkExerciseRepetition,
  capExerciseRepetition,
  isRampingLadder,
  MAX_RAMP_ENTRIES_PER_BLOCK,
  checkConsecutiveMuscleGroupOverload,
  buildMuscleRebalanceFeedback,
  reorderToMinimizeConsecutiveOverload,
} from "@/utils/workout-balance-validation";

describe("checkExerciseRepetition [LR-049]", () => {
  it("does not flag an exercise repeated exactly at the cap (2x)", () => {
    const findings = checkExerciseRepetition([
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Push-up" },
              { exerciseName: "Push-up" },
            ],
          },
        ],
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("flags an exercise repeated more than the cap within one day", () => {
    const findings = checkExerciseRepetition([
      {
        day: 1,
        blocks: [
          { exercises: [{ exerciseName: "Push-up" }, { exerciseName: "Push-up" }] },
          { exercises: [{ exerciseName: "Push-up" }] },
        ],
      },
    ]);
    expect(findings).toEqual([
      { dayNumber: 1, exerciseName: "Push-up", count: 3 },
    ]);
  });

  it("counts repeats across multiple blocks within the same day, not just one block", () => {
    const findings = checkExerciseRepetition([
      {
        day: 2,
        blocks: [
          { exercises: [{ exerciseName: "Squat" }] },
          { exercises: [{ exerciseName: "Squat" }] },
          { exercises: [{ exerciseName: "Squat" }] },
        ],
      },
    ]);
    expect(findings[0].count).toBe(3);
  });
});

describe("capExerciseRepetition [LR-049]", () => {
  it("leaves a plan with no over-repeats unchanged and reports no findings", () => {
    const plan = [
      {
        day: 1,
        blocks: [
          { exercises: [{ exerciseName: "Push-up" }, { exerciseName: "Push-up" }] },
        ],
      },
    ];
    const { workoutPlan, findings } = capExerciseRepetition(plan);
    expect(findings).toHaveLength(0);
    expect(workoutPlan).toBe(plan); // untouched (same reference) when nothing to cap
  });

  it("drops occurrences beyond the cap, keeping the first two, across blocks", () => {
    const { workoutPlan, findings } = capExerciseRepetition([
      {
        day: 1,
        blocks: [
          { exercises: [{ exerciseName: "Push-up" }, { exerciseName: "Push-up" }] },
          { exercises: [{ exerciseName: "Push-up" }, { exerciseName: "Row" }] },
        ],
      },
    ]);
    expect(findings).toEqual([{ dayNumber: 1, exerciseName: "Push-up", count: 3 }]);
    const remaining = workoutPlan[0].blocks
      .flatMap((b: any) => b.exercises)
      .map((e: any) => e.exerciseName);
    expect(remaining.filter((n: string) => n === "Push-up")).toHaveLength(2);
    expect(remaining).toContain("Row"); // non-repeated exercise preserved
  });

  it("caps repetition per-day independently (a 3rd copy on another day is its own count)", () => {
    const { workoutPlan } = capExerciseRepetition([
      { day: 1, blocks: [{ exercises: [{ exerciseName: "Squat" }, { exerciseName: "Squat" }, { exerciseName: "Squat" }] }] },
      { day: 2, blocks: [{ exercises: [{ exerciseName: "Squat" }, { exerciseName: "Squat" }] }] },
    ]);
    const day1 = workoutPlan[0].blocks.flatMap((b: any) => b.exercises);
    const day2 = workoutPlan[1].blocks.flatMap((b: any) => b.exercises);
    expect(day1).toHaveLength(2); // capped from 3
    expect(day2).toHaveLength(2); // untouched
  });
});

describe("buildMuscleRebalanceFeedback [LR-049]", () => {
  it("returns empty string when there are no overloads", () => {
    expect(buildMuscleRebalanceFeedback([])).toBe("");
  });

  it("names the offending day pairs and shared muscle groups", () => {
    const feedback = buildMuscleRebalanceFeedback([
      { firstDay: 1, secondDay: 2, sharedMuscleGroups: ["legs"] },
    ]);
    expect(feedback).toContain("Day 1 and Day 2");
    expect(feedback).toContain("legs");
    expect(feedback).toMatch(/no two consecutive training days share a primary muscle group/i);
  });
});

describe("checkConsecutiveMuscleGroupOverload [LR-049]", () => {
  it("flags two consecutive days sharing a primary muscle group", () => {
    const findings = checkConsecutiveMuscleGroupOverload([
      { day: 1, primaryMuscleGroups: ["legs", "glutes"] },
      { day: 2, primaryMuscleGroups: ["legs", "core"] },
    ]);
    expect(findings).toEqual([
      { firstDay: 1, secondDay: 2, sharedMuscleGroups: ["legs"] },
    ]);
  });

  it("does not flag non-consecutive days (a rest/other day between them)", () => {
    const findings = checkConsecutiveMuscleGroupOverload([
      { day: 1, primaryMuscleGroups: ["legs"] },
      { day: 3, primaryMuscleGroups: ["legs"] },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("does not flag consecutive days with no shared muscle group", () => {
    const findings = checkConsecutiveMuscleGroupOverload([
      { day: 1, primaryMuscleGroups: ["legs"] },
      { day: 2, primaryMuscleGroups: ["chest", "back"] },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("is case-insensitive when comparing muscle group names", () => {
    const findings = checkConsecutiveMuscleGroupOverload([
      { day: 1, primaryMuscleGroups: ["Legs"] },
      { day: 2, primaryMuscleGroups: ["legs"] },
    ]);
    expect(findings).toHaveLength(1);
  });
});

describe("reorderToMinimizeConsecutiveOverload [GQ-10]", () => {
  it("breaks up consecutive same-muscle days without dropping any", () => {
    // Two quad days adjacent (1,2); reorder should separate them.
    const days = [
      { day: 1, name: "A", primaryMuscleGroups: ["quads", "glutes"] },
      { day: 2, name: "B", primaryMuscleGroups: ["quads", "hamstrings"] },
      { day: 3, name: "C", primaryMuscleGroups: ["chest", "triceps"] },
      { day: 4, name: "D", primaryMuscleGroups: ["back", "biceps"] },
    ];
    const reordered = reorderToMinimizeConsecutiveOverload(days);
    expect(reordered).toHaveLength(4);
    // No dropped days — same set of names.
    expect(reordered.map((d) => d.name).sort()).toEqual(["A", "B", "C", "D"]);
    // Renumbered 1..N.
    expect(reordered.map((d) => d.day)).toEqual([1, 2, 3, 4]);
    // The two quad days are no longer adjacent.
    expect(checkConsecutiveMuscleGroupOverload(reordered)).toHaveLength(0);
  });

  it("is a stable no-op (renumber only) for 2 or fewer days", () => {
    const days = [
      { day: 1, primaryMuscleGroups: ["quads"] },
      { day: 2, primaryMuscleGroups: ["quads"] },
    ];
    expect(reorderToMinimizeConsecutiveOverload(days)).toEqual(days);
  });

  it("leaves an already-balanced week unchanged in overlap count", () => {
    const days = [
      { day: 1, primaryMuscleGroups: ["chest"] },
      { day: 2, primaryMuscleGroups: ["back"] },
      { day: 3, primaryMuscleGroups: ["legs"] },
    ];
    const reordered = reorderToMinimizeConsecutiveOverload(days);
    expect(checkConsecutiveMuscleGroupOverload(reordered)).toHaveLength(0);
  });
});

describe("ramping set ladders (Wendler / 5x5 work-ups) are exempt from the repeat cap", () => {
  const wendlerBench = (weights: number[], blockType = "traditional") => ({
    day: 1,
    blocks: [
      {
        blockType,
        exercises: weights.map((weight) => ({ exerciseName: "Barbell Bench Press", weight, sets: 1, reps: 5 })),
      },
    ],
  });

  it("isRampingLadder: distinct positive loads in a traditional block, 3+ entries", () => {
    expect(isRampingLadder([{ weight: 85 }, { weight: 105 }, { weight: 125 }], "traditional")).toBe(true);
    expect(isRampingLadder([{ weight: 85 }, { weight: 105 }, { weight: 125 }], undefined)).toBe(true);
    expect(isRampingLadder([{ weight: 85 }, { weight: 105 }], "traditional")).toBe(false); // <3 = ordinary
    expect(isRampingLadder([{ weight: 85 }, { weight: 85 }, { weight: 85 }], "traditional")).toBe(false); // same load
    expect(isRampingLadder([{ weight: 0 }, { weight: 0 }, { weight: 0 }], "traditional")).toBe(false); // bodyweight
    expect(isRampingLadder([{ weight: 85 }, { weight: 105 }, { weight: 125 }], "amrap")).toBe(false); // wrong block
  });

  it("keeps a full six-entry Wendler ladder intact with no findings", () => {
    const plan = [wendlerBench([85, 105, 127, 137, 158, 179])];
    const { workoutPlan, findings } = capExerciseRepetition(plan);
    expect(findings).toEqual([]);
    expect(workoutPlan).toBe(plan);
    expect(checkExerciseRepetition(plan)).toEqual([]);
  });

  it("still caps six identical-load entries (padding, not a ladder) to two", () => {
    const { workoutPlan, findings } = capExerciseRepetition([wendlerBench([135, 135, 135, 135, 135, 135])]);
    expect(findings).toEqual([{ dayNumber: 1, exerciseName: "Barbell Bench Press", count: 6 }]);
    expect(workoutPlan[0].blocks[0].exercises).toHaveLength(2);
  });

  it("does not treat distinct loads inside an AMRAP/circuit as a ladder", () => {
    const { workoutPlan } = capExerciseRepetition([wendlerBench([85, 105, 127, 137], "amrap")]);
    expect(workoutPlan[0].blocks[0].exercises).toHaveLength(2);
  });

  it("trims a ladder longer than MAX_RAMP_ENTRIES_PER_BLOCK to the first entries and reports it", () => {
    const weights = Array.from({ length: MAX_RAMP_ENTRIES_PER_BLOCK + 3 }, (_, i) => 100 + i * 10);
    const { workoutPlan, findings } = capExerciseRepetition([wendlerBench(weights)]);
    expect(workoutPlan[0].blocks[0].exercises).toHaveLength(MAX_RAMP_ENTRIES_PER_BLOCK);
    expect(findings[0]).toEqual({ dayNumber: 1, exerciseName: "Barbell Bench Press", count: weights.length });
  });

  it("a ladder does not consume the daily cap for the same lift elsewhere in the day", () => {
    const plan = [
      {
        day: 1,
        blocks: [
          wendlerBench([85, 105, 127, 137, 158, 179]).blocks[0],
          {
            blockType: "amrap",
            exercises: [
              { exerciseName: "Barbell Bench Press", weight: 95 },
              { exerciseName: "Barbell Bench Press", weight: 95 },
              { exerciseName: "Barbell Bench Press", weight: 95 },
              { exerciseName: "Row", weight: 0 },
            ],
          },
        ],
      },
    ];
    const { workoutPlan, findings } = capExerciseRepetition(plan);
    expect(workoutPlan[0].blocks[0].exercises).toHaveLength(6); // ladder untouched
    expect(workoutPlan[0].blocks[1].exercises.map((e: any) => e.exerciseName)).toEqual([
      "Barbell Bench Press",
      "Barbell Bench Press",
      "Row",
    ]); // 3rd identical METCON bench dropped
    expect(findings).toEqual([{ dayNumber: 1, exerciseName: "Barbell Bench Press", count: 9 }]);
  });
});
