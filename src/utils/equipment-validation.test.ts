import { describe, it, expect } from "@jest/globals";
import { validateEquipmentAndFilter } from "@/utils/equipment-validation";

const homeGymProfile = {
  environment: "home_gym",
  equipment: ["dumbbells", "resistance_bands"],
} as any;

const bodyweightProfile = {
  environment: "bodyweight_only",
  equipment: [],
} as any;

const commercialGymProfile = {
  environment: "commercial_gym",
  equipment: [],
} as any;

describe("validateEquipmentAndFilter [LR-012]", () => {
  it("keeps an exercise whose equipment the user actually has", () => {
    const result = validateEquipmentAndFilter(
      [{ name: "Dumbbell Row", equipment: ["dumbbells"] }],
      [],
      homeGymProfile
    );
    expect(result.exercisesToAdd).toHaveLength(1);
  });

  it("keeps bodyweight exercises for every environment", () => {
    const result = validateEquipmentAndFilter(
      [{ name: "Push-up", equipment: ["bodyweight"] }],
      [],
      homeGymProfile
    );
    expect(result.exercisesToAdd).toHaveLength(1);
  });

  it("drops an exercise requiring equipment the home-gym user doesn't have", () => {
    const result = validateEquipmentAndFilter(
      [{ name: "Squat Rack Squat", equipment: ["squat_rack"] }],
      [],
      homeGymProfile
    );
    expect(result.exercisesToAdd).toHaveLength(0);
  });

  it("drops any non-bodyweight exercise for a bodyweight_only user", () => {
    const result = validateEquipmentAndFilter(
      [{ name: "Dumbbell Row", equipment: ["dumbbells"] }],
      [],
      bodyweightProfile
    );
    expect(result.exercisesToAdd).toHaveLength(0);
  });

  it("keeps anything for a commercial_gym user (comprehensive equipment)", () => {
    const result = validateEquipmentAndFilter(
      [{ name: "Cable Fly", equipment: ["cable_machine"] }],
      [],
      commercialGymProfile
    );
    expect(result.exercisesToAdd).toHaveLength(1);
  });

  it("removes block references to a dropped exercise, leaving other exercises intact", () => {
    const workoutPlan = [
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Squat Rack Squat" },
              { exerciseName: "Dumbbell Row" },
            ],
          },
        ],
      },
    ];

    const result = validateEquipmentAndFilter(
      [
        { name: "Squat Rack Squat", equipment: ["squat_rack"] },
        { name: "Dumbbell Row", equipment: ["dumbbells"] },
      ],
      workoutPlan,
      homeGymProfile
    );

    expect(result.exercisesToAdd).toHaveLength(1);
    expect(result.exercisesToAdd[0].name).toBe("Dumbbell Row");
    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(1);
    expect(result.workoutPlan[0].blocks[0].exercises[0].exerciseName).toBe(
      "Dumbbell Row"
    );
  });
});
