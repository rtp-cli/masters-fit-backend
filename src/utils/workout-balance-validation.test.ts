import { describe, it, expect } from "@jest/globals";
import {
  checkExerciseRepetition,
  capExerciseRepetition,
  checkConsecutiveMuscleGroupOverload,
  buildMuscleRebalanceFeedback,
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
