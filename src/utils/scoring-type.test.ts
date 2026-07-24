import { describe, it, expect } from "@jest/globals";
import { deriveScoringType } from "@/utils/scoring-type";

describe("deriveScoringType", () => {
  it.each([
    ["amrap", "rounds_reps"],
    ["emom", "rounds_reps"],
    ["circuit", "rounds_reps"],
    ["for_time", "time"],
    ["tabata", "reps"],
    ["warmup", "completion"],
    ["cooldown", "completion"],
    ["flow", "completion"],
    ["traditional", "load"],
    ["superset", "load"],
  ])("%s -> %s", (blockType, expected) => {
    expect(deriveScoringType(blockType)).toBe(expected);
  });

  it("defaults unknown/missing types to load (renders as traditional set-by-set)", () => {
    expect(deriveScoringType("ladder")).toBe("load");
    expect(deriveScoringType(null)).toBe("load");
    expect(deriveScoringType(undefined)).toBe("load");
  });
});
