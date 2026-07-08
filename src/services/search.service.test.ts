import { describe, it, expect } from "@jest/globals";
import { searchService } from "@/services/search.service";

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
});
