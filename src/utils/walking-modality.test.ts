import { describe, it, expect } from "@jest/globals";
import { PreferredStyles } from "@/constants/profile";
import { getStyleInterpretationGuide } from "@/utils/prompt-generator";
import { determineBlockType as determineBlockTypeA } from "@/utils/workout-block-configuration.utils";
import { determineBlockType as determineBlockTypeB } from "@/utils/workout-generation.utils";
import { CANONICAL_BASICS_STYLES } from "@/utils/requested-exercises";

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
    // It must not be demoted to a warm-up when combined with another style.
    expect(guide).toMatch(/does not become a\s*\n?warm-up/i);
  });
});
