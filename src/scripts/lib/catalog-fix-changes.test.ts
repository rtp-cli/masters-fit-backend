import { describe, it, expect } from "@jest/globals";
import {
  parseChanges,
  rollbackArgs,
  sameValue,
} from "@/scripts/lib/catalog-fix-changes";

describe("parseChanges", () => {
  it("maps snake_case columns to drizzle keys and splits enum arrays", () => {
    expect(
      parseChanges(["muscle_groups= glutes, hamstrings,glutes", "difficulty=moderate"], []),
    ).toEqual([
      { column: "muscle_groups", key: "muscleGroups", value: ["glutes", "hamstrings"] },
      { column: "difficulty", key: "difficulty", value: "moderate" },
    ]);
  });

  it("keeps everything after the first '=' in a text value", () => {
    expect(parseChanges(["instructions=Keep hips = shoulders height"], [])[0].value).toBe(
      "Keep hips = shoulders height",
    );
  });

  it("clears a nullable column", () => {
    expect(parseChanges([], ["description"])).toEqual([
      { column: "description", key: "description", value: null },
    ]);
  });

  it("rejects values outside the enums", () => {
    expect(() => parseChanges(["difficulty=extreme"], [])).toThrow(/unknown value "extreme"/);
    expect(() => parseChanges(["equipment=dumbbells,kettlebell_typo"], [])).toThrow(
      /kettlebell_typo/,
    );
    expect(() => parseChanges(["muscle_groups=quadriceps"], [])).toThrow(/quadriceps/);
  });

  it("points link/has_demo at fix-exercise-link and refuses structural columns", () => {
    expect(() => parseChanges(["link=https://youtu.be/x"], [])).toThrow(/fix-exercise-link/);
    expect(() => parseChanges([], ["has_demo"])).toThrow(/fix-exercise-link/);
    expect(() => parseChanges(["owner_user_id=3"], [])).toThrow(/not editable/);
    expect(() => parseChanges(["nmae=Squat"], [])).toThrow(/Editable:/);
  });

  it("refuses to clear or empty a NOT NULL column", () => {
    expect(() => parseChanges([], ["name"])).toThrow(/cannot be cleared/);
    expect(() => parseChanges(["instructions=  "], [])).toThrow(/cannot be empty/);
    expect(() => parseChanges(["muscle_groups=,"], [])).toThrow(/at least one/);
  });

  it("refuses a column given twice, a malformed --set, and no changes at all", () => {
    expect(() => parseChanges(["tag=yoga"], ["tag"])).toThrow(/more than once/);
    expect(() => parseChanges(["difficulty"], [])).toThrow(/column=value/);
    expect(() => parseChanges([], [])).toThrow(/Nothing to change/);
  });
});

describe("sameValue", () => {
  it("compares arrays by order, since muscle_groups order is meaningful", () => {
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue("x", null)).toBe(false);
  });
});

describe("rollbackArgs", () => {
  it("restores old values, clearing what was NULL and shell-quoting text", () => {
    const changes = parseChanges(
      ["name=Dumbbell RDL", "equipment=dumbbells"],
      ["description"],
    );
    expect(
      rollbackArgs(changes, {
        name: "Dave's RDL",
        equipment: ["barbells", "bench"],
        description: null,
      }),
    ).toBe(`--set 'name=Dave'\\''s RDL' --set 'equipment=barbells,bench' --clear description`);
  });
});
