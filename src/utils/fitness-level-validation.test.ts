import { describe, it, expect } from "@jest/globals";
import {
  describeFitnessLevelProgramming,
  filterExercisesByFitnessLevel,
  fitnessLevelPromptSection,
  validateFitnessLevelAndFilter,
} from "@/utils/fitness-level-validation";

const beginner = { fitnessLevel: "beginner" } as any;
const intermediate = { fitnessLevel: "intermediate" } as any;
const advanced = { fitnessLevel: "advanced" } as any;
const unanswered = { fitnessLevel: null } as any;

const names = (rows: any[]) => rows.map((r: any) => r.name ?? r.exerciseName);

describe("filterExercisesByFitnessLevel [LR-073]", () => {
  it("drops high-difficulty exercises for a beginner", () => {
    const catalog = [
      { name: "Bulgarian Split Squat", difficulty: "high" },
      { name: "Goblet Squat", difficulty: "moderate" },
      { name: "Brisk Walk", difficulty: "moderate" },
      { name: "Seated Row Machine", difficulty: "low" },
    ];
    const result = filterExercisesByFitnessLevel(catalog, beginner);
    expect(names(result)).toEqual([
      "Goblet Squat",
      "Brisk Walk",
      "Seated Row Machine",
    ]);
  });

  it("drops an excluded movement even when the catalog rates it low or moderate", () => {
    // The observed prod failure was a mis-rated row, not only a `high` one:
    // the name rule has to stand on its own.
    const catalog = [
      { name: "Burpees", difficulty: "moderate" },
      { name: "Mountain Climbers", difficulty: "low" },
      { name: "Incline Walk", difficulty: "moderate" },
    ];
    const result = filterExercisesByFitnessLevel(catalog, beginner);
    expect(names(result)).toEqual(["Incline Walk"]);
  });

  it("leaves intermediate and advanced catalogs untouched", () => {
    const catalog = [
      { name: "Burpees", difficulty: "high" },
      { name: "Goblet Squat", difficulty: "moderate" },
    ];
    expect(filterExercisesByFitnessLevel(catalog, intermediate)).toHaveLength(2);
    expect(filterExercisesByFitnessLevel(catalog, advanced)).toHaveLength(2);
  });

  it("treats an unanswered fitness level as unconstrained, not as beginner", () => {
    // Assuming "beginner" for a null would silently de-load every plan
    // belonging to a profile that predates the field.
    const catalog = [{ name: "Burpees", difficulty: "high" }];
    expect(filterExercisesByFitnessLevel(catalog, unanswered)).toHaveLength(1);
  });

  it("does not match a substring inside an unrelated exercise name", () => {
    const catalog = [
      { name: "Jumping Jacks", difficulty: "low" },
      { name: "Farmer Carry", difficulty: "moderate" },
      { name: "Cleansing Breath Stretch", difficulty: "low" },
    ];
    expect(filterExercisesByFitnessLevel(catalog, beginner)).toHaveLength(3);
  });
});

describe("validateFitnessLevelAndFilter [LR-073]", () => {
  it("is a no-op for a non-beginner", () => {
    const toAdd = [{ name: "Burpees", difficulty: "high" }];
    const plan = [
      { day: 1, blocks: [{ exercises: [{ exerciseName: "Burpees" }] }] },
    ];
    const result = validateFitnessLevelAndFilter(toAdd, plan, advanced);
    expect(result.exercisesToAdd).toHaveLength(1);
    expect(result.workoutPlan[0].blocks[0].exercises).toHaveLength(1);
  });

  it("drops an invented exercise the model declared as high difficulty", () => {
    const toAdd = [
      { name: "Weighted Pistol Progression", difficulty: "high" },
      { name: "Wall Push-Up", difficulty: "low" },
    ];
    const result = validateFitnessLevelAndFilter(toAdd, [], beginner);
    expect(names(result.exercisesToAdd)).toEqual(["Wall Push-Up"]);
  });

  it("drops a plan-body exercise the model named without adding it", () => {
    // The daily/regen path never goes through the catalog pre-filter, so the
    // plan body can name anything — this is the 2026-09-04 Box Jump lesson.
    const plan = [
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Burpees" },
              { exerciseName: "Brisk Walk" },
            ],
          },
        ],
      },
    ];
    const result = validateFitnessLevelAndFilter([], plan, beginner);
    expect(names(result.workoutPlan[0].blocks[0].exercises)).toEqual([
      "Brisk Walk",
    ]);
  });

  it("removes plan references to an exercisesToAdd entry it dropped", () => {
    const toAdd = [{ name: "Explosive Step-Up", difficulty: "high" }];
    const plan = [
      {
        day: 1,
        blocks: [
          {
            exercises: [
              { exerciseName: "Explosive Step-Up" },
              { exerciseName: "Seated Row Machine" },
            ],
          },
        ],
      },
    ];
    const result = validateFitnessLevelAndFilter(toAdd, plan, beginner);
    expect(result.exercisesToAdd).toHaveLength(0);
    expect(names(result.workoutPlan[0].blocks[0].exercises)).toEqual([
      "Seated Row Machine",
    ]);
  });

  it("survives a day with no blocks and a block with no exercises", () => {
    const plan = [{ day: 1 }, { day: 2, blocks: [{}] }];
    const result = validateFitnessLevelAndFilter([], plan, beginner);
    expect(result.workoutPlan[0].blocks).toEqual([]);
    expect(result.workoutPlan[1].blocks[0].exercises).toEqual([]);
  });
});

describe("describeFitnessLevelProgramming [LR-073]", () => {
  it("returns programming semantics for a beginner", () => {
    const text = describeFitnessLevelProgramming("beginner")!;
    expect(text).toContain("BEGINNER");
    expect(text).toMatch(/burpees/i);
    expect(text).toMatch(/walking/i);
  });

  it("returns null for every other level so the section is omitted", () => {
    expect(describeFitnessLevelProgramming("intermediate")).toBeNull();
    expect(describeFitnessLevelProgramming("advanced")).toBeNull();
    expect(describeFitnessLevelProgramming(null)).toBeNull();
    expect(describeFitnessLevelProgramming(undefined)).toBeNull();
  });

  it("renders an empty prompt section for a non-beginner and a padded one for a beginner", () => {
    expect(fitnessLevelPromptSection("advanced")).toBe("");
    expect(fitnessLevelPromptSection("beginner")).toMatch(/\n\n$/);
  });
});

describe("BEGINNER_EXCLUDED_MOVEMENTS catalog realities [LR-073]", () => {
  it("keeps 'Plyo Box' step exercises — that is equipment, not a plyometric", () => {
    // Regression: `plyo\w*` matched these, and both are rated `low`.
    const catalog = [
      { name: "Plyo Box Step Down", difficulty: "low" },
      { name: "Plyo Box Step Ups", difficulty: "low" },
      { name: "Plyo Box Step-Up to Knee Drive", difficulty: "moderate" },
      { name: "Plyo Box Lateral Shuffles", difficulty: "moderate" },
    ];
    expect(filterExercisesByFitnessLevel(catalog, beginner)).toHaveLength(4);
  });

  it("still excludes the explosive box work by name, not just by difficulty", () => {
    const catalog = [
      { name: "Modified Plyo Box Jump", difficulty: "moderate" },
      { name: "Plyometric Lunge", difficulty: "moderate" },
      { name: "Jump Squat", difficulty: "moderate" },
    ];
    expect(filterExercisesByFitnessLevel(catalog, beginner)).toHaveLength(0);
  });

  it("excludes scaled burpee and mountain-climber variants too (deliberate)", () => {
    const catalog = [
      { name: "Knee-Friendly Burpees", difficulty: "moderate" },
      { name: "Modified Burpee", difficulty: "moderate" },
      { name: "Shoulder-Safe Burpee", difficulty: "moderate" },
      { name: "Slow Mountain Climbers", difficulty: "low" },
    ];
    expect(filterExercisesByFitnessLevel(catalog, beginner)).toHaveLength(0);
  });

  it("excludes machine sprint intervals but keeps steady-state machine work", () => {
    const catalog = [
      { name: "Stationary Bike Sprint", difficulty: "moderate" },
      { name: "Rowing Machine Sprint", difficulty: "high" },
      { name: "Bike Steady State", difficulty: "low" },
      { name: "Brisk Walk", difficulty: "moderate" },
    ];
    expect(names(filterExercisesByFitnessLevel(catalog, beginner))).toEqual([
      "Bike Steady State",
      "Brisk Walk",
    ]);
  });
});
