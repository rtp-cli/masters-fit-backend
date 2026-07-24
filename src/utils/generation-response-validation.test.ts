import { describe, it, expect } from "@jest/globals";
import {
  validateDailyGenerationResponse,
  validateWeeklyGenerationResponse,
} from "@/utils/generation-response-validation";

const validExercise = {
  exerciseName: "Goblet Squat",
  sets: 3,
  reps: 10,
  weight: 25,
  duration: 0,
  restTime: 90,
  notes: "Chest tall",
  order: 1,
};

const validBlock = {
  blockType: "traditional",
  blockName: "Main Strength",
  blockDurationMinutes: 20,
  timeCapMinutes: 0,
  rounds: 1,
  instructions: "Standard sets",
  order: 1,
  exercises: [validExercise],
};

const validDay = {
  day: 1,
  name: "Upper Strength",
  description: "Push focus",
  instructions: "Warm up first",
  blocks: [validBlock],
};

describe("validateWeeklyGenerationResponse (serial path)", () => {
  it("accepts a well-formed weekly plan unchanged", () => {
    const result = validateWeeklyGenerationResponse({
      name: "Plan",
      description: "Desc",
      workoutPlan: [validDay],
    });
    expect(result.workoutPlan).toHaveLength(1);
    expect(result.workoutPlan[0].blocks[0].exercises[0].exerciseName).toBe(
      "Goblet Squat"
    );
  });

  it("heals scalar damage: string numbers, null strings, missing fields", () => {
    const result = validateWeeklyGenerationResponse({
      name: null,
      workoutPlan: [
        {
          ...validDay,
          blocks: [
            {
              ...validBlock,
              rounds: "3", // string number from the LLM
              timeCapMinutes: null,
              instructions: null,
              exercises: [
                { ...validExercise, reps: "12", weight: null, notes: null },
              ],
            },
          ],
        },
      ],
    });
    const block = result.workoutPlan[0].blocks[0];
    expect(result.name).toBe("Workout Plan");
    expect(block.rounds).toBe(3);
    expect(block.timeCapMinutes).toBe(0);
    expect(block.exercises[0].reps).toBe(12);
    expect(block.exercises[0].weight).toBe(0);
    expect(block.exercises[0].notes).toBe("");
  });

  it("passes through unknown extra keys instead of stripping them", () => {
    const result = validateWeeklyGenerationResponse({
      workoutPlan: [{ ...validDay, extraDayKey: "kept" }],
    });
    expect((result.workoutPlan[0] as any).extraDayKey).toBe("kept");
  });

  it("rejects structural damage: missing workoutPlan", () => {
    expect(() =>
      validateWeeklyGenerationResponse({ name: "Plan", days: [validDay] })
    ).toThrow(/failed validation/);
  });

  it("rejects structural damage: day with no blocks", () => {
    expect(() =>
      validateWeeklyGenerationResponse({
        workoutPlan: [{ ...validDay, blocks: [] }],
      })
    ).toThrow(/failed validation/);
  });

  it("rejects structural damage: block with no exercises", () => {
    expect(() =>
      validateWeeklyGenerationResponse({
        workoutPlan: [{ ...validDay, blocks: [{ ...validBlock, exercises: [] }] }],
      })
    ).toThrow(/failed validation/);
  });

  it("rejects an exercise without a name (would be silently dropped at persistence)", () => {
    expect(() =>
      validateWeeklyGenerationResponse({
        workoutPlan: [
          {
            ...validDay,
            blocks: [
              { ...validBlock, exercises: [{ ...validExercise, exerciseName: "" }] },
            ],
          },
        ],
      })
    ).toThrow(/failed validation/);
  });

  it("drops a mangled exercisesToAdd array instead of failing generation", () => {
    const result = validateWeeklyGenerationResponse({
      workoutPlan: [validDay],
      exercisesToAdd: [{ description: "no name field" }],
    });
    expect(result.exercisesToAdd).toEqual([]);
  });

  it("keeps off-list blockType values (frontend falls back to traditional rendering)", () => {
    const result = validateWeeklyGenerationResponse({
      workoutPlan: [
        { ...validDay, blocks: [{ ...validBlock, blockType: "superset" }] },
      ],
    });
    expect(result.workoutPlan[0].blocks[0].blockType).toBe("superset");
  });
});

describe("validateDailyGenerationResponse (serial path)", () => {
  it("accepts a well-formed single day", () => {
    const result = validateDailyGenerationResponse({
      ...validDay,
      exercisesToAdd: [],
    });
    expect(result.blocks).toHaveLength(1);
  });

  it("rejects a weekly-shaped response on the daily path", () => {
    expect(() =>
      validateDailyGenerationResponse({ workoutPlan: [validDay] })
    ).toThrow(/failed validation/);
  });
});
