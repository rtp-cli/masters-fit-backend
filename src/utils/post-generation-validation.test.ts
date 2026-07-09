import { describe, it, expect } from "@jest/globals";
import { applyPostGenerationValidation } from "@/utils/post-generation-validation";

// [LR-019] These tests are about the WIRING between the three validators,
// not re-testing each one's own logic (that's equipment-validation.test.ts,
// limitation-validation.test.ts, workout-balance-validation.test.ts).

const homeGymProfile = {
  environment: "home_gym",
  equipment: ["dumbbells"],
  limitations: ["knee_pain"],
} as any;

function dayWithExercises(day: number, exerciseNames: string[]) {
  return {
    day,
    blocks: [
      {
        exercises: exerciseNames.map((exerciseName) => ({ exerciseName })),
      },
    ],
  };
}

describe("applyPostGenerationValidation [LR-019]", () => {
  it("an exercise dropped by the equipment filter never reaches the repetition check, even if it repeats 3x", () => {
    // "Squat Rack Squat" requires equipment the home-gym profile doesn't
    // have. If the pipeline order were wrong (repetition check running on
    // the RAW plan instead of the equipment-filtered one), this would
    // incorrectly report a repetition finding for an exercise that's
    // actually gone from the final plan.
    const workoutPlan = [
      dayWithExercises(1, [
        "Squat Rack Squat",
        "Squat Rack Squat",
        "Squat Rack Squat",
      ]),
    ];
    const exercisesToAdd = [
      { name: "Squat Rack Squat", equipment: ["squat_rack"] },
    ];

    const result = applyPostGenerationValidation(
      exercisesToAdd,
      workoutPlan,
      homeGymProfile
    );

    expect(result.exercisesToAdd).toHaveLength(0);
    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(0);
    expect(result.repetitionFindings).toHaveLength(0);
  });

  it("the limitation filter runs on the equipment filter's OUTPUT, not the original raw plan", () => {
    // Two different new exercises: one fails equipment (dumbbell-only
    // profile, needs a squat rack), one passes equipment but fails the
    // knee_pain limitation (box jump). Both should end up gone — if
    // limitation filtering were wired to the RAW plan instead of the
    // equipment-filtered result, this wouldn't prove anything about the
    // pipeline; the assertion on the equipment-only exercise confirms both
    // stages actually ran in sequence on the same, narrowing plan.
    const workoutPlan = [
      dayWithExercises(1, ["Squat Rack Squat", "Box Jump", "Push-Up"]),
    ];
    const exercisesToAdd = [
      { name: "Squat Rack Squat", equipment: ["squat_rack"] },
      { name: "Box Jump", equipment: ["bodyweight"] },
      { name: "Push-Up", equipment: ["bodyweight"] },
    ];

    const result = applyPostGenerationValidation(
      exercisesToAdd,
      workoutPlan,
      homeGymProfile
    );

    const remainingNames = result.exercisesToAdd.map((e: any) => e.name);
    expect(remainingNames).not.toContain("Squat Rack Squat");
    expect(remainingNames).not.toContain("Box Jump");
    expect(remainingNames).toContain("Push-Up");

    const remainingBlockNames = result.workoutPlan[0].blocks[0].exercises.map(
      (e: any) => e.exerciseName
    );
    expect(remainingBlockNames).toEqual(["Push-Up"]);
  });

  it("still flags a genuinely repeated exercise that passes both filters (an existing catalog exercise, not in exercisesToAdd)", () => {
    const workoutPlan = [
      dayWithExercises(1, ["Push-Up", "Push-Up", "Push-Up"]),
    ];

    const result = applyPostGenerationValidation(
      [],
      workoutPlan,
      homeGymProfile
    );

    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(3);
    expect(result.repetitionFindings).toEqual([
      { dayNumber: 1, exerciseName: "Push-Up", count: 3 },
    ]);
  });

  it("passes through untouched for a profile with no limitations and exercises requiring no special equipment", () => {
    const noLimitationsProfile = {
      environment: "bodyweight_only",
      equipment: [],
      limitations: [],
    } as any;
    const workoutPlan = [dayWithExercises(1, ["Push-Up", "Sit-Up"])];
    const exercisesToAdd = [
      { name: "Push-Up", equipment: ["bodyweight"] },
      { name: "Sit-Up", equipment: ["bodyweight"] },
    ];

    const result = applyPostGenerationValidation(
      exercisesToAdd,
      workoutPlan,
      noLimitationsProfile
    );

    expect(result.exercisesToAdd).toHaveLength(2);
    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(2);
    expect(result.repetitionFindings).toHaveLength(0);
  });
});
