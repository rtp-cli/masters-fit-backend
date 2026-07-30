import { describe, it, expect } from "@jest/globals";
import { stratifyCatalog, ExerciseMetadata } from "@/services/exercise.service";

const ex = (
  name: string,
  muscleGroup: string,
  extra: Partial<ExerciseMetadata> = {}
): ExerciseMetadata => ({
  name,
  equipment: null,
  muscleGroups: [muscleGroup],
  difficulty: null,
  ...extra,
});

describe("stratifyCatalog", () => {
  it("returns the pool unchanged when it fits within the limit", () => {
    const pool = [ex("A", "core"), ex("B", "glutes")];
    expect(stratifyCatalog(pool, { limit: 10 })).toHaveLength(2);
  });

  it("is deterministic — same inputs, same menu, same order", () => {
    const pool = Array.from({ length: 50 }, (_, i) =>
      ex(`Exercise ${i}`, ["core", "glutes", "chest", "back"][i % 4])
    );
    const first = stratifyCatalog(pool, { limit: 20 });
    const second = stratifyCatalog([...pool].reverse(), { limit: 20 });
    expect(first.map((e) => e.name)).toEqual(second.map((e) => e.name));
  });

  it("draws round-robin so every muscle group is represented", () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, i) => ex(`Core ${i}`, "core")),
      ex("Lone Calf Raise", "calves"),
    ];
    const result = stratifyCatalog(pool, { limit: 10 });
    expect(result.map((e) => e.name)).toContain("Lone Calf Raise");
  });

  it("prefers the user's preferred styles within a bucket", () => {
    const pool = [
      ex("Alpha Plain", "core"),
      ex("Zeta HIIT", "core", { tag: "hiit" }),
      ex("Other", "glutes"),
    ];
    const result = stratifyCatalog(pool, {
      preferredStyles: ["HIIT"],
      limit: 2,
    });
    // One slot per bucket at depth 0: core's slot must go to the style match
    // despite its later alphabetical name.
    expect(result.map((e) => e.name)).toContain("Zeta HIIT");
    expect(result.map((e) => e.name)).not.toContain("Alpha Plain");
  });

  it("prefers exercises with demos when style relevance ties", () => {
    const pool = [
      ex("Alpha No Demo", "core"),
      ex("Zeta With Demo", "core", { hasDemo: true }),
      ex("Other", "glutes"),
    ];
    const result = stratifyCatalog(pool, { limit: 2 });
    expect(result.map((e) => e.name)).toContain("Zeta With Demo");
  });

  it("merges muscle-group spelling variants into one bucket", () => {
    const pool = [
      ex("A", "lower back"),
      ex("B", "lower_back"),
      ex("C", "Lower Back"),
      ex("D", "glutes"),
    ];
    // 2 buckets; at limit 2 the round-robin takes exactly one from each.
    const result = stratifyCatalog(pool, { limit: 2 });
    const lowerBackCount = result.filter((e) =>
      e.muscleGroups[0].toLowerCase().includes("lower")
    ).length;
    expect(lowerBackCount).toBe(1);
    expect(result.map((e) => e.name)).toContain("D");
  });

  it("respects the limit exactly when the pool is larger", () => {
    const pool = Array.from({ length: 500 }, (_, i) =>
      ex(`Exercise ${i}`, `group${i % 7}`)
    );
    expect(stratifyCatalog(pool, { limit: 200 })).toHaveLength(200);
  });
});
