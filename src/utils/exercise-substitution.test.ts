import { describe, it, expect } from "@jest/globals";
import { nextSubstitutedFrom } from "./exercise-substitution";

describe("nextSubstitutedFrom", () => {
  it("records the prescribed movement on a first swap", () => {
    expect(nextSubstitutedFrom({ exerciseId: 10, substitutedFromExerciseId: null }, 20)).toBe(10);
  });

  it("keeps the FIRST prescription across repeated swaps", () => {
    expect(nextSubstitutedFrom({ exerciseId: 20, substitutedFromExerciseId: 10 }, 30)).toBe(10);
  });

  it("clears when the user swaps back to what was prescribed", () => {
    expect(nextSubstitutedFrom({ exerciseId: 20, substitutedFromExerciseId: 10 }, 10)).toBeNull();
  });

  it("is a no-op record when re-selecting the same never-swapped movement", () => {
    expect(nextSubstitutedFrom({ exerciseId: 10, substitutedFromExerciseId: null }, 10)).toBeNull();
  });
});
