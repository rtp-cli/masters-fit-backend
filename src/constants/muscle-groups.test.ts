import { describe, it, expect } from "@jest/globals";
import {
  normalizeMuscleGroups,
  RAW_MUSCLE_LABEL_MAP,
  CANONICAL_MUSCLE_GROUPS,
} from "@/constants/muscle-groups";

describe("normalizeMuscleGroups [GQ-09]", () => {
  it("collapses casing/separator/synonym variants to one canonical", () => {
    expect(normalizeMuscleGroups(["lower back"]).groups).toEqual(["lower_back"]);
    expect(normalizeMuscleGroups(["lower_back"]).groups).toEqual(["lower_back"]);
    expect(normalizeMuscleGroups(["quadriceps"]).groups).toEqual(["quads"]);
    expect(normalizeMuscleGroups(["cardiovascular"]).groups).toEqual(["cardio"]);
  });

  it("splits multi-packed cells into multiple canonicals, order-preserving", () => {
    expect(normalizeMuscleGroups(["lats triceps shoulders"]).groups).toEqual([
      "back",
      "triceps",
      "shoulders",
    ]);
  });

  it("dedupes across the whole array preserving first-seen order", () => {
    // 'back' from upper_back, then 'shoulders', then 'back' again should not repeat.
    expect(
      normalizeMuscleGroups(["upper_back", "shoulders", "lats"]).groups
    ).toEqual(["back", "shoulders"]);
  });

  it("drops junk labels and the empty string", () => {
    expect(normalizeMuscleGroups(["resistance_bands"]).groups).toEqual([]);
    expect(normalizeMuscleGroups(["mind"]).groups).toEqual([]);
    expect(normalizeMuscleGroups([""]).groups).toEqual([]);
    // ...and reports nothing as unmapped (they're explicitly mapped to []).
    expect(normalizeMuscleGroups(["", "mind"]).unmapped).toEqual([]);
  });

  it("expands umbrella labels", () => {
    expect(normalizeMuscleGroups(["legs"]).groups).toEqual([
      "quads",
      "hamstrings",
      "glutes",
    ]);
    expect(normalizeMuscleGroups(["arms"]).groups).toEqual(["biceps", "triceps"]);
  });

  it("reports unknown labels as unmapped without including them", () => {
    const res = normalizeMuscleGroups(["chest", "totally_new_label"]);
    expect(res.groups).toEqual(["chest"]);
    expect(res.unmapped).toEqual(["totally_new_label"]);
  });

  it("every mapping value is itself a canonical group", () => {
    const canonical = new Set(CANONICAL_MUSCLE_GROUPS);
    for (const [raw, mapped] of Object.entries(RAW_MUSCLE_LABEL_MAP)) {
      for (const m of mapped) {
        expect(canonical.has(m)).toBe(true);
      }
      expect(raw).toBe(raw.toLowerCase());
    }
  });
});
