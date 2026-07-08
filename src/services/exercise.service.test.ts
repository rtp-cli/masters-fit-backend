import { describe, it, expect } from "@jest/globals";
import { exerciseService } from "@/services/exercise.service";
import { InsertExercise } from "@/models";

const baseExercise: InsertExercise = {
  name: "Test Exercise",
  equipment: ["dumbbells"],
  muscleGroups: ["chest"],
  difficulty: "moderate",
  instructions: "Do the thing.",
  tag: "test",
};

describe("ExerciseService.validateExerciseData", () => {
  it("returns no problems for valid data", () => {
    expect(exerciseService.validateExerciseData(baseExercise)).toEqual([]);
  });

  it("flags an unknown difficulty", () => {
    const problems = exerciseService.validateExerciseData({
      ...baseExercise,
      difficulty: "extreme" as InsertExercise["difficulty"],
    });
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("difficulty")])
    );
  });

  it("flags an unknown equipment value (e.g. singular medicine_ball, not the real plural enum value)", () => {
    const problems = exerciseService.validateExerciseData({
      ...baseExercise,
      equipment: ["medicine_ball"] as unknown as InsertExercise["equipment"],
    });
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("medicine_ball")])
    );
  });

  it("accepts the real plural medicine_balls value", () => {
    const problems = exerciseService.validateExerciseData({
      ...baseExercise,
      equipment: ["medicine_balls"],
    });
    expect(problems).toEqual([]);
  });

  it("flags empty muscleGroups", () => {
    const problems = exerciseService.validateExerciseData({
      ...baseExercise,
      muscleGroups: [],
    });
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("muscleGroups")])
    );
  });
});
