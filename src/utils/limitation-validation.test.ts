import { describe, it, expect } from "@jest/globals";
import {
  filterExercisesByLimitations,
  validateLimitationsAndFilter,
} from "@/utils/limitation-validation";

const noLimitationsProfile = { limitations: [] } as any;
const kneeProfile = { limitations: ["knee_pain"] } as any;
const shoulderProfile = { limitations: ["shoulder_pain"] } as any;
const backProfile = { limitations: ["lower_back_pain"] } as any;

describe("filterExercisesByLimitations [LR-013]", () => {
  it("returns everything unchanged when the user has no limitations", () => {
    const exercises = [{ name: "Box Jump" }] as any;
    const result = filterExercisesByLimitations(exercises, noLimitationsProfile);
    expect(result).toHaveLength(1);
  });

  it("excludes a contraindicated exercise for knee_pain", () => {
    const exercises = [
      { name: "Box Jump" },
      { name: "Goblet Squat" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, kneeProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Box Jump");
    expect(names).toContain("Goblet Squat");
  });

  it("excludes a contraindicated exercise for shoulder_pain", () => {
    const exercises = [
      { name: "Overhead Press" },
      { name: "Dumbbell Row" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, shoulderProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Overhead Press");
    expect(names).toContain("Dumbbell Row");
  });

  it("excludes a contraindicated exercise for lower_back_pain", () => {
    const exercises = [
      { name: "Barbell Deadlift" },
      { name: "Push-Up" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, backProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Barbell Deadlift");
    expect(names).toContain("Push-Up");
  });

  it("does not falsely exclude an unrelated exercise sharing no risky keyword", () => {
    const exercises = [{ name: "Air Squat" }] as any;
    const result = filterExercisesByLimitations(exercises, kneeProfile);
    expect(result).toHaveLength(1);
  });
});

describe("validateLimitationsAndFilter [LR-013]", () => {
  it("passes through unchanged when the user has no limitations", () => {
    const result = validateLimitationsAndFilter(
      [{ name: "Box Jump" }],
      [],
      noLimitationsProfile
    );
    expect(result.exercisesToAdd).toHaveLength(1);
  });

  it("drops a newly-introduced exercise that's contraindicated", () => {
    const result = validateLimitationsAndFilter(
      [{ name: "Box Jump" }, { name: "Wall Sit" }],
      [],
      kneeProfile
    );
    const names = result.exercisesToAdd.map((e: any) => e.name);
    expect(names).not.toContain("Box Jump");
    expect(names).toContain("Wall Sit");
  });

  it("removes block references to a dropped exercise, leaving other exercises intact", () => {
    const workoutPlan = [
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Box Jump" },
              { exerciseName: "Wall Sit" },
            ],
          },
        ],
      },
    ];

    const result = validateLimitationsAndFilter(
      [{ name: "Box Jump" }, { name: "Wall Sit" }],
      workoutPlan,
      kneeProfile
    );

    expect(result.exercisesToAdd).toHaveLength(1);
    expect(result.exercisesToAdd[0].name).toBe("Wall Sit");
    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(1);
    expect(result.workoutPlan[0].blocks[0].exercises[0].exerciseName).toBe(
      "Wall Sit"
    );
  });

  it("checks each of the user's limitations, not just the first", () => {
    const multiProfile = { limitations: ["knee_pain", "shoulder_pain"] } as any;
    const result = validateLimitationsAndFilter(
      [{ name: "Overhead Press" }, { name: "Box Jump" }, { name: "Push-Up" }],
      [],
      multiProfile
    );
    const names = result.exercisesToAdd.map((e: any) => e.name);
    expect(names).not.toContain("Overhead Press");
    expect(names).not.toContain("Box Jump");
    expect(names).toContain("Push-Up");
  });
});
