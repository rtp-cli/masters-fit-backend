import { describe, it, expect } from "@jest/globals";
import {
  checkExerciseRepetition,
  checkConsecutiveMuscleGroupOverload,
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
