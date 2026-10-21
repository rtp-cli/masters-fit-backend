import { describe, it, expect } from "@jest/globals";
import {
  SwapProse,
  replaceExerciseName,
  replaceInProse,
  movementKeywords,
  proseMentionsMovement,
  acceptRewrite,
  proseChanged,
} from "./swap-text-reconcile";

/**
 * The real case (prod user 3, 2026-10-21): repeated a squat day, swapped both
 * Barbell Back Squat rows for Deadlift, and the day + block prose kept saying
 * squat.
 */
const SQUAT_DAY: SwapProse = {
  dayName: "Strength — Barbell Back Squat + Metcon",
  dayDescription:
    "Back squat strength work followed by a 4-round for-time conditioning finisher.",
  dayInstructions:
    "Begin with the squat progression, building from empty bar to working weight. Move into the metcon.",
  blockName: "Barbell Back Squat",
  blockInstructions:
    "Warm up with empty bar, then perform 4 working sets of 6 reps. Keep knees tracking over toes.",
};

describe("replaceExerciseName", () => {
  it("replaces the exact catalog name, case-insensitively", () => {
    expect(replaceExerciseName("Strength — Barbell Back Squat + Metcon", "Barbell Back Squat", "Deadlift"))
      .toBe("Strength — Deadlift + Metcon");
    expect(replaceExerciseName("barbell back squat day", "Barbell Back Squat", "Deadlift"))
      .toBe("Deadlift day");
  });

  it("absorbs a plural on the old name", () => {
    expect(replaceExerciseName("4 sets of Barbell Back Squats", "Barbell Back Squat", "Deadlift"))
      .toBe("4 sets of Deadlift");
  });

  it("doesn't match inside a longer word", () => {
    expect(replaceExerciseName("Row Machine Rowing", "Row", "Ski Erg")).toBe("Ski Erg Machine Rowing");
  });

  it("treats regex characters in names literally", () => {
    expect(replaceExerciseName("Do the Push-Up (Knees) now", "Push-Up (Knees)", "Wall Push-Up"))
      .toBe("Do the Wall Push-Up now");
  });

  it("passes null through", () => {
    expect(replaceExerciseName(null, "Barbell Back Squat", "Deadlift")).toBeNull();
  });

  it("only catches the exact name — paraphrases need the LLM pass", () => {
    const out = replaceInProse(SQUAT_DAY, "Barbell Back Squat", "Deadlift");
    expect(out.dayName).toBe("Strength — Deadlift + Metcon");
    expect(out.blockName).toBe("Deadlift");
    expect(out.dayDescription).toBe(SQUAT_DAY.dayDescription);
  });
});

describe("movementKeywords / proseMentionsMovement", () => {
  it("drops equipment and position words", () => {
    expect(movementKeywords("Barbell Back Squat")).toEqual(["squat"]);
    expect(movementKeywords("Dumbbell Romanian Deadlift")).toEqual(["romanian", "deadlift"]);
  });

  it("flags leftover paraphrases after the name pass", () => {
    const afterPass1 = replaceInProse(SQUAT_DAY, "Barbell Back Squat", "Deadlift");
    expect(proseMentionsMovement(afterPass1, "Barbell Back Squat", "Deadlift")).toBe(true);
  });

  it("skips prose that never mentions the movement (the common case)", () => {
    const generic: SwapProse = {
      dayName: "Lower Body Strength + Metcon",
      dayDescription: "Heavy lower-body work, then conditioning.",
      dayInstructions: "Build to working weight; steady pace on the metcon.",
      blockName: "Strength",
      blockInstructions: "4 working sets, 2 minutes rest.",
    };
    expect(proseMentionsMovement(generic, "Barbell Back Squat", "Deadlift")).toBe(false);
  });

  it("ignores a key word the new exercise shares", () => {
    const prose = { ...SQUAT_DAY, dayDescription: "Squat strength work.", dayInstructions: null, blockInstructions: null, dayName: null, blockName: null };
    expect(proseMentionsMovement(prose, "Barbell Back Squat", "Front Squat")).toBe(false);
  });
});

describe("acceptRewrite", () => {
  const current = replaceInProse(SQUAT_DAY, "Barbell Back Squat", "Deadlift");

  it("takes good fields", () => {
    const out = acceptRewrite(current, { dayDescription: "Deadlift strength work followed by a finisher." }, "Barbell Back Squat");
    expect(out.dayDescription).toBe("Deadlift strength work followed by a finisher.");
    expect(out.dayName).toBe(current.dayName);
  });

  it("rejects empty, ballooned, and still-naming-the-old-exercise fields", () => {
    const out = acceptRewrite(
      current,
      {
        dayDescription: "   ",
        dayInstructions: "x".repeat(5000),
        blockInstructions: "Barbell Back Squat cues kept.",
        blockName: 42,
      },
      "Barbell Back Squat"
    );
    expect(proseChanged(current, out)).toBe(false);
  });

  it("never fills a field that was null", () => {
    const out = acceptRewrite({ ...current, dayInstructions: null }, { dayInstructions: "New text" }, "Barbell Back Squat");
    expect(out.dayInstructions).toBeNull();
  });
});
