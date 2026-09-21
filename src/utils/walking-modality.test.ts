import { describe, it, expect } from "@jest/globals";
import { PreferredStyles } from "@/constants/profile";
import { getStyleInterpretationGuide } from "@/utils/prompt-generator";
import { determineBlockType as determineBlockTypeA } from "@/utils/workout-block-configuration.utils";
import { determineBlockType as determineBlockTypeB } from "@/utils/workout-generation.utils";
import { CANONICAL_BASICS_STYLES } from "@/utils/requested-exercises";
import {
  filterExercisesForWalkingModality,
  isNonWalkingCardio,
} from "@/utils/walking-modality";

const WALKING = PreferredStyles.WALKING_MOVEMENT;

describe("Walking & Movement modality [LR-084]", () => {
  it("is a real style value", () => {
    expect(WALKING).toBe("walking_movement");
  });

  it("maps to a traditional block, NOT a circuit", () => {
    // `cardio` maps to "circuit", which is how a beginner with knee pain ended
    // up with rounds of "Jogging in Place". A walk is one continuous effort.
    expect(determineBlockTypeA([WALKING])).toBe("traditional");
    expect(determineBlockTypeB([WALKING])).toBe("traditional");
    expect(determineBlockTypeA(["cardio"])).toBe("circuit");
  });

  it("does NOT pin the canonical barbell staples", () => {
    // A walker must not get Back Squat/Deadlift reserved at the front of the
    // menu just because they picked a style.
    expect(CANONICAL_BASICS_STYLES.has(WALKING)).toBe(false);
  });

  it("still lets an explicit lifting style win the block mapping", () => {
    // Order matters: the first matching style wins, so a walker who also lifts
    // does not lose their strength structure.
    expect(determineBlockTypeA(["strength", WALKING])).toBe("traditional");
    expect(determineBlockTypeA(["crossfit", WALKING])).toBe("amrap");
  });

  it("teaches the generator what the style means, including what NOT to do", () => {
    const guide = getStyleInterpretationGuide();
    expect(guide).toContain("Walking & Movement Programming");
    // The specific failure observed on prod: a beginner walker prescribed
    // "Light jog in place" / "High Knees".
    expect(guide).toMatch(/NEVER prescribe jogging, running, jumping/i);
    expect(guide).toMatch(/sit-to-stand/i);
    expect(guide).toMatch(/rucking/i);
    // The bottom of the ladder is lower than it looks: 52, 70 lb overweight,
    // 15 years off, a 10-minute walk is the ceiling. The guide must not imply
    // a minimum duration, and must not pad a short walk out to the user's
    // stated session length.
    expect(guide).toMatch(/A 10-minute walk is a real session/i);
    // It must not be demoted to a warm-up when combined with another style.
    expect(guide).toMatch(/does not become a\s*\n?warm-up/i);
  });
});

describe("filterExercisesForWalkingModality [LR-085]", () => {
  const ex = (name: string) => ({ name });
  const profileWith = (styles: string[]) => ({ preferredStyles: styles }) as never;

  const CATALOG = [
    ex("Walking"),
    ex("Brisk Walk"),
    ex("Standing Marches"),
    ex("Chair Sit-to-Stand"),
    ex("Walking in Place"),
    ex("Gentle Walking in Place"),
    ex("Marching on the Spot"),
    ex("Light jog in place"),
    ex("High Knees"),
    ex("Jumping Jacks"),
  ];

  it("strips in-place, jogging and jumping cardio for a walking-only user", () => {
    const names = filterExercisesForWalkingModality(CATALOG, profileWith([WALKING])).map(
      (e) => e.name
    );
    expect(names).toEqual([
      "Walking",
      "Brisk Walk",
      "Standing Marches",
      "Chair Sit-to-Stand",
    ]);
  });

  it("keeps the real walks it exists to protect", () => {
    const names = filterExercisesForWalkingModality(CATALOG, profileWith([WALKING])).map(
      (e) => e.name
    );
    expect(names).toContain("Walking");
    expect(names).toContain("Brisk Walk");
  });

  // The combined-style case the prompt describes: walking gets its own days and
  // the other style gets the rest, so a Walking+HIIT user still needs jacks.
  it("is a no-op for a Walking + HIIT user, whose HIIT days need the jumping work", () => {
    const out = filterExercisesForWalkingModality(CATALOG, profileWith([WALKING, "hiit"]));
    expect(out).toHaveLength(CATALOG.length);
    expect(out.map((e) => e.name)).toContain("Jumping Jacks");
  });

  it("is a no-op for users who never mentioned walking", () => {
    const out = filterExercisesForWalkingModality(CATALOG, profileWith(["strength"]));
    expect(out).toHaveLength(CATALOG.length);
  });

  it("is a no-op when no styles are set rather than assuming walking", () => {
    expect(filterExercisesForWalkingModality(CATALOG, profileWith([]))).toHaveLength(
      CATALOG.length
    );
  });

  it("does not mistake a plain walk for in-place cardio", () => {
    expect(isNonWalkingCardio("Walking")).toBe(false);
    expect(isNonWalkingCardio("Brisk Walk")).toBe(false);
    expect(isNonWalkingCardio("Incline Walk")).toBe(false);
    expect(isNonWalkingCardio("Walking in Place")).toBe(true);
    expect(isNonWalkingCardio("Marching on the Spot")).toBe(true);
  });
});

describe("NON_WALKING_CARDIO breadth [#109]", () => {
  // Surfaced by the replace-suggestion audit: "Driveway Hill Run" was the
  // SECOND movement offered to a walking-only beginner, because the old
  // pattern matched the gerund "running" but not the noun "Run".
  it.each([
    "Driveway Hill Run",
    "Incline Driveway Run",
    "Bike Interval Sprint",
    "Rower Sprint Intervals",
    "Wall Tap Sprints",
  ])("strips %s", (name) => {
    expect(isNonWalkingCardio(name)).toBe(true);
  });

  it("does not catch 'run' inside a longer word", () => {
    // Word boundaries keep these safe — they are stretches, not running.
    expect(isNonWalkingCardio("Runner's Lunge")).toBe(false);
    expect(isNonWalkingCardio("Runner's Stretch")).toBe(false);
  });

  it("still leaves the real walks alone", () => {
    for (const n of ["Walking", "Brisk Walk", "Incline Walk", "Hiking", "Rucking"]) {
      expect(isNonWalkingCardio(n)).toBe(false);
    }
  });
});
