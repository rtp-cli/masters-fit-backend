import { describe, it, expect } from "@jest/globals";
import {
  describeCautions,
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

  it("excludes a contraindicated exercise for shoulder_pain but keeps caution-tier presses", () => {
    const exercises = [
      { name: "Barbell Snatch" },
      { name: "Overhead Press" },
      { name: "Dumbbell Row" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, shoulderProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Barbell Snatch");
    // Tiered policy (2026-07-30): graded overhead pressing is caution, not banned.
    expect(names).toContain("Overhead Press");
    expect(names).toContain("Dumbbell Row");
  });

  it("excludes hard-banned movements for lower_back_pain but keeps the deadlift family", () => {
    const exercises = [
      { name: "Good Morning" },
      { name: "Stiff Leg Deadlift" },
      { name: "Barbell Deadlift" },
      { name: "Kettlebell Deadlift" },
      { name: "Push-Up" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, backProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Good Morning");
    expect(names).not.toContain("Stiff Leg Deadlift");
    // Tiered policy (2026-07-30): hinge loading is caution, not banned — the
    // original blanket ban made "give me a deadlift workout" unsatisfiable.
    expect(names).toContain("Barbell Deadlift");
    expect(names).toContain("Kettlebell Deadlift");
    expect(names).toContain("Push-Up");
  });

  it("sciatica bans heavier deadlifts but keeps light-implement hinges", () => {
    const sciaticaProfile = { limitations: ["sciatica"] } as any;
    const exercises = [
      { name: "Barbell Conventional Deadlift" },
      { name: "Trap Bar Deadlift" },
      { name: "Kettlebell Deadlift" },
      { name: "Single-Leg Dumbbell Deadlift" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, sciaticaProfile);
    const names = result.map((e: any) => e.name);
    expect(names).not.toContain("Barbell Conventional Deadlift");
    expect(names).not.toContain("Trap Bar Deadlift");
    expect(names).toContain("Kettlebell Deadlift");
    expect(names).toContain("Single-Leg Dumbbell Deadlift");
  });

  it("keeps knee-friendly cardio sprints available for knee_pain (caution tier)", () => {
    const exercises = [
      { name: "Bike Interval Sprint" },
      { name: "Box Jump" },
    ] as any;
    const result = filterExercisesByLimitations(exercises, kneeProfile);
    const names = result.map((e: any) => e.name);
    expect(names).toContain("Bike Interval Sprint");
    expect(names).not.toContain("Box Jump");
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
      [{ name: "Barbell Snatch" }, { name: "Box Jump" }, { name: "Push-Up" }],
      [],
      multiProfile
    );
    const names = result.exercisesToAdd.map((e: any) => e.name);
    expect(names).not.toContain("Barbell Snatch");
    expect(names).not.toContain("Box Jump");
    expect(names).toContain("Push-Up");
  });
});

describe("describeCautions (tiered policy 2026-07-30)", () => {
  it("returns a labeled line per limitation with a caution rule", () => {
    const lines = describeCautions(["lower_back_pain"] as any);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Lower Back Pain: /);
    expect(lines[0]).toContain("deadlift");
  });

  it("skips limitations with no caution tier (hard-ban only)", () => {
    expect(describeCautions(["osteoporosis", "neck_pain"] as any)).toHaveLength(0);
  });

  it("is empty for null/empty limitations", () => {
    expect(describeCautions(null)).toHaveLength(0);
    expect(describeCautions([] as any)).toHaveLength(0);
  });
});
