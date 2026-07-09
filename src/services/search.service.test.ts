import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { searchService } from "@/services/search.service";
import { logger } from "@/utils/logger";

// Integration-style test against the real local DB (same pattern already
// used by exercise.service.test.ts) — the exercises table has a small, known
// non-zero row count, enough to exercise the hasMore pagination logic
// without needing to seed/mock data.
describe("SearchService.searchExercises pagination", () => {
  it("reports hasMore=true when a small limit doesn't cover all matches", async () => {
    // "a" matches the overwhelming majority of exercise names/descriptions.
    const result = await searchService.searchExercises("a", { limit: 1 });
    expect(result.exercises.length).toBeLessThanOrEqual(1);
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore=false when the limit exceeds total matches", async () => {
    const result = await searchService.searchExercises("a", { limit: 10000 });
    expect(result.hasMore).toBe(false);
  });

  it("offset moves the window (page 2 doesn't repeat page 1's first result)", async () => {
    const page1 = await searchService.searchExercises("a", {
      limit: 5,
      offset: 0,
    });
    const page2 = await searchService.searchExercises("a", {
      limit: 5,
      offset: 5,
    });
    if (page1.exercises.length > 0 && page2.exercises.length > 0) {
      expect(page2.exercises[0].id).not.toBe(page1.exercises[0].id);
    }
  });

  it("no exercise appears on both of two sequential, non-overlapping pages", async () => {
    // Stronger than the "first item differs" check above, which wouldn't
    // catch an overlap at any OTHER position. Written while investigating a
    // real duplicate-React-key crash during "Load More" — this passes
    // whether or not the ORDER BY has an explicit id tiebreak (name ASC was
    // already fully deterministic on this data, since names are unique
    // locally), so it did NOT prove that was the bug's cause. The real
    // cause turned out to be a frontend double-invocation race (see
    // search-view.tsx's loadMoreExercises); this test stays as a genuine
    // backend pagination-continuity guard, not a claim about that bug.
    const page1 = await searchService.searchExercises("squat", {
      limit: 5,
      offset: 0,
    });
    const page2 = await searchService.searchExercises("squat", {
      limit: 5,
      offset: page1.exercises.length,
    });
    const page1Ids = new Set(page1.exercises.map((e) => e.id));
    const overlap = page2.exercises.filter((e) => page1Ids.has(e.id));
    expect(overlap).toEqual([]);
  });
});

describe("SearchService.searchExercises fuzzy matching [LR-022]", () => {
  it("finds a real exercise despite a typo in the query", async () => {
    // Matches the exact example from the ticket. Verified separately via
    // `SELECT similarity(...)` that this scores ~0.48 against the real
    // "Barbell Bench Press" row, comfortably over the 0.3 threshold.
    const result = await searchService.searchExercises("bencg press");
    const names = result.exercises.map((e) => e.name.toLowerCase());
    expect(names.some((n) => n.includes("bench press"))).toBe(true);
  });

  it("does not match on an unrelated query despite fuzzy matching being enabled", async () => {
    const result = await searchService.searchExercises(
      "zzzznonexistentqueryxyz123"
    );
    expect(result.exercises).toHaveLength(0);
  });
});

describe("SearchService.searchExercises relevance ordering [LR-057]", () => {
  it("ranks a name that starts with the query ahead of names that merely contain it", async () => {
    // Local catalog: "Squat Jumps" starts with "squat"; "Air Squat", "Goblet
    // Squat", etc. contain it but don't start with it. Previously these came
    // back in arbitrary DB scan order — this asserts the starts-with match
    // now always leads.
    const result = await searchService.searchExercises("squat", {
      limit: 50,
    });
    const names = result.exercises.map((e) => e.name);
    const startsWithIdx = names.findIndex((n) =>
      n.toLowerCase().startsWith("squat")
    );
    const containsOnlyIdx = names.findIndex(
      (n) => n.toLowerCase().includes("squat") && !n.toLowerCase().startsWith("squat")
    );
    expect(startsWithIdx).toBeGreaterThanOrEqual(0);
    expect(containsOnlyIdx).toBeGreaterThanOrEqual(0);
    expect(startsWithIdx).toBeLessThan(containsOnlyIdx);
  });

  it("ranks an exact case-insensitive name match first", async () => {
    // "Push-Up" is an exact match; "Wall Push-Up" only contains it.
    const result = await searchService.searchExercises("push-up", {
      limit: 50,
    });
    const names = result.exercises.map((e) => e.name.toLowerCase());
    if (names.includes("push-up")) {
      expect(names[0]).toBe("push-up");
    }
  });
});

describe("SearchService search telemetry [LR-025]", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("warns on a zero-result query, so dead searches are visible in logs", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    await searchService.searchExercises("zzzznonexistentqueryxyz123");
    expect(warnSpy).toHaveBeenCalledWith(
      "Search returned zero results",
      expect.objectContaining({ operation: "searchExercises" })
    );
  });

  it("logs at info level (not warn) for a query with results", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    await searchService.searchExercises("a");
    expect(infoSpy).toHaveBeenCalledWith(
      "Search executed",
      expect.objectContaining({ operation: "searchExercises" })
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      "Search returned zero results",
      expect.anything()
    );
  });
});
