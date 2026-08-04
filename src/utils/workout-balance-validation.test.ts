import { describe, it, expect } from "@jest/globals";
import {
  checkExerciseRepetition,
  capExerciseRepetition,
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
