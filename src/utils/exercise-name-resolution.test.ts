import { describe, it, expect } from "@jest/globals";
import {
  normalizeExerciseName,
  singularizeNormalizedName,
  canonicalNameForAlias,
  EXERCISE_NAME_ALIASES,
} from "./exercise-name-resolution";

describe("normalizeExerciseName", () => {
  it("treats straight and curly apostrophes, spacing, hyphens and case as the same name", () => {
    expect(normalizeExerciseName("Farmer's Carry")).toBe("farmerscarry");
    expect(normalizeExerciseName("Farmer’s Carry")).toBe("farmerscarry");
    expect(normalizeExerciseName("Child's Pose")).toBe(normalizeExerciseName("Childs Pose"));
    expect(normalizeExerciseName("Push-Up")).toBe(normalizeExerciseName("push up"));
  });
});

describe("singularizeNormalizedName", () => {
  it("drops one trailing plural s", () => {
    expect(singularizeNormalizedName("kettlebellswings")).toBe("kettlebellswing");
    expect(singularizeNormalizedName("burpees")).toBe("burpee");
  });
  it("leaves ss endings and short tokens alone", () => {
    expect(singularizeNormalizedName("pushpress")).toBe("pushpress");
    expect(singularizeNormalizedName("abs")).toBe("abs");
  });
});

describe("canonicalNameForAlias", () => {
  it("maps fully-qualified aliases regardless of punctuation/case", () => {
    expect(canonicalNameForAlias("Barbell Deadlift")).toBe("Barbell Conventional Deadlift");
    expect(canonicalNameForAlias("barbell-deadlift")).toBe("Barbell Conventional Deadlift");
    expect(canonicalNameForAlias("Pull-Ups")).toBe("Strict Pull-Up");
    expect(canonicalNameForAlias("Bench Press")).toBe("Barbell Bench Press");
  });
  it("never aliases a bare movement family word", () => {
    expect(canonicalNameForAlias("Deadlift")).toBeUndefined();
    expect(canonicalNameForAlias("Squat")).toBeUndefined();
    expect(canonicalNameForAlias("Row")).toBeUndefined();
  });
  it("alias keys are themselves normalized (a typo'd key would silently never match)", () => {
    for (const key of Object.keys(EXERCISE_NAME_ALIASES)) {
      expect(key).toBe(normalizeExerciseName(key));
    }
  });
});
