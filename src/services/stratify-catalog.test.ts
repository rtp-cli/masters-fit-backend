import { describe, it, expect } from "@jest/globals";
import {
  stratifyCatalog,
  MIN_SLOTS_PER_BUCKET,
  ExerciseMetadata,
} from "@/services/exercise.service";

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
  // [#101] The bucket-depth lottery. Drawing one row per bucket per pass gave
  // every bucket the same number of slots regardless of size, so on the real
  // prod catalog a commercial-gym user saw 3% of the 326-row `core` bucket and
  // 100% of a 2-row bucket. Bucket depth is an artifact of how muscle_groups[0]
  // happens to be written, not a training judgement.
  describe("[#101] proportional bucket quotas", () => {
    const lopsidedPool = [
      ...Array.from({ length: 300 }, (_, i) => ex(`Core ${i}`, "core")),
      ...Array.from({ length: 100 }, (_, i) => ex(`Glute ${i}`, "glutes")),
      ...Array.from({ length: 4 }, (_, i) => ex(`Neck ${i}`, "neck")),
    ];

    const countsByBucket = (menu: ExerciseMetadata[]) => {
      const counts = new Map<string, number>();
      for (const e of menu) {
        const k = e.muscleGroups[0];
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return counts;
    };

    it("gives a big bucket more slots than a small one", () => {
      const counts = countsByBucket(stratifyCatalog(lopsidedPool, { limit: 100 }));
      expect(counts.get("core")!).toBeGreaterThan(counts.get("glutes")!);
      expect(counts.get("glutes")!).toBeGreaterThan(counts.get("neck")!);
    });

    it("admits roughly the same FRACTION of each bucket", () => {
      const counts = countsByBucket(stratifyCatalog(lopsidedPool, { limit: 100 }));
      const coreShare = counts.get("core")! / 300;
      const gluteShare = counts.get("glutes")! / 100;
      // Before this change core was admitted at a fraction of the glute rate
      // purely because it was bigger. Within a few points is the whole point.
      expect(Math.abs(coreShare - gluteShare)).toBeLessThan(0.05);
    });

    it("never starves a small family below the floor", () => {
      const counts = countsByBucket(stratifyCatalog(lopsidedPool, { limit: 100 }));
      // 4 rows of 404 would round to 1 slot; the floor keeps the family audible.
      expect(counts.get("neck")!).toBeGreaterThanOrEqual(
        Math.min(MIN_SLOTS_PER_BUCKET, 4)
      );
    });

    it("still fills the menu exactly when quotas round down", () => {
      expect(stratifyCatalog(lopsidedPool, { limit: 137 })).toHaveLength(137);
    });
  });

  // [#101] `styleMatch` is binary and `hasDemo` is nearly universal (309 of 326
  // real core rows have one), so for most of the catalog the tiebreak that
  // actually decided visibility was `name.localeCompare` — the 11 core rows a
  // strength+HIIT user could see were the first 11 from A to H, and anything
  // later in the alphabet was permanently invisible.
  describe("[#101] alphabet-blind tiebreak", () => {
    it("does not systematically prefer names early in the alphabet", () => {
      const pool = Array.from({ length: 260 }, (_, i) =>
        ex(`${String.fromCharCode(65 + (i % 26))}${i} movement`, "core")
      );
      const menu = stratifyCatalog(pool, { limit: 26 });
      const firstLetters = new Set(menu.map((e) => e.name[0]));
      // Alphabetical ordering would return 26 rows all starting with "A".
      expect(firstLetters.size).toBeGreaterThan(5);
    });

    it("admits late-alphabet rows when they compete with early-alphabet ones", () => {
      // 26 "A…" against 26 "Z…" for 26 slots. Under `localeCompare` the menu is
      // all 26 A-rows and no Z-row ever appears, which is the real defect: a
      // qualifying movement is hidden for the life of the catalog because of
      // how it is spelled. Asserting "roughly a fair split" rather than one
      // specific row, so the test measures the property and not hash luck.
      const pool = [
        ...Array.from({ length: 26 }, (_, i) => ex(`A movement ${i}`, "core")),
        ...Array.from({ length: 26 }, (_, i) => ex(`Z movement ${i}`, "core")),
      ];
      const menu = stratifyCatalog(pool, { limit: 26 });
      const zCount = menu.filter((e) => e.name.startsWith("Z")).length;
      expect(zCount).toBeGreaterThan(5);
      expect(zCount).toBeLessThan(21);
    });

    it("keeps the tiebreak stable across calls and processes", () => {
      const pool = Array.from({ length: 80 }, (_, i) => ex(`Move ${i}`, "core"));
      const a = stratifyCatalog(pool, { limit: 30 }).map((e) => e.name);
      const b = stratifyCatalog([...pool].reverse(), { limit: 30 }).map((e) => e.name);
      expect(a).toEqual(b);
    });

    it("still lets style and demo outrank the tiebreak", () => {
      const pool = [
        ...Array.from({ length: 40 }, (_, i) => ex(`Filler ${i}`, "core", { hasDemo: true })),
        ex("Zebra Hold", "core", { tag: "crossfit" }),
      ];
      const menu = stratifyCatalog(pool, { preferredStyles: ["crossfit"], limit: 5 });
      expect(menu[0].name).toBe("Zebra Hold");
    });
  });
});
