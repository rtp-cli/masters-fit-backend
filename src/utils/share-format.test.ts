import { describe, it, expect } from "@jest/globals";

import {
  blockLabel,
  blockScore,
  isPlausibleDuration,
  summarizePrescription,
  summarizeSets,
} from "@/utils/share-format";

const set = (reps: number | null, weight: number | null, extra: object = {}) => ({
  reps,
  weight,
  durationSeconds: null,
  distanceM: null,
  ...extra,
});

describe("summarizeSets", () => {
  it("says so when nothing was logged, rather than inventing a prescription", () => {
    expect(summarizeSets([], 1)).toEqual({ summary: "Not logged", note: null });
  });

  it("collapses uniform sets", () => {
    const s = summarizeSets([set(12, 10), set(12, 10), set(12, 10)], 1);
    expect(s.summary).toBe("3 x 12 @ 10 lb");
    expect(s.note).toBeNull();
  });

  it("shows a ramp as a range, so the top set is visible", () => {
    // The v1 card collapsed this to the prescribed "4 x 8 @ 40 lb" and lost the 50.
    const s = summarizeSets([set(8, 40), set(8, 45), set(6, 50)], 1);
    expect(s.summary).toBe("3 x 6-8 @ 40-50 lb");
  });

  it("never prints 0 lb for bodyweight work", () => {
    const s = summarizeSets([set(10, 0), set(10, 0)], 1);
    expect(s.summary).toBe("2 x 10");
    expect(s.note).toBe("Bodyweight");
  });

  it("admits when reps were not captured instead of guessing", () => {
    const s = summarizeSets([set(null, 30), set(null, 30)], 1);
    expect(s.summary).toBe("2 sets @ 30 lb");
    expect(s.note).toBe("Reps not logged");
  });

  it("calls a bare completion tick what it is, not '1 x 1'", () => {
    // Real prod shape: a 15-min Zone 2 bike logged as a single tick. reps=1 and
    // nothing else — no load, no duration, no distance.
    const s = summarizeSets([set(1, null)], 1);
    expect(s.summary).toBe("Completed");
    // Not "Bodyweight" — nothing says it was unloaded, only unmeasured.
    expect(s.note).toBeNull();
  });

  it("reports a ticked circuit by its rounds", () => {
    const s = summarizeSets([set(1, null), set(1, null), set(1, null)], 3);
    expect(s.summary).toBe("3 rounds");
  });

  it("still treats a real single rep with load as a set", () => {
    // A 1RM attempt carries a weight, so it must not be mistaken for a tick.
    expect(summarizeSets([set(1, 315)], 1).summary).toBe("1 x 1 @ 315 lb");
  });

  it("does not swallow a timed or measured single effort", () => {
    expect(summarizeSets([set(1, null, { durationSeconds: 900 })], 1).summary).toBe("1 x 15m");
    expect(summarizeSets([set(1, null, { distanceM: 5000 })], 1).summary).toBe("5000 m");
  });

  it("keeps a circuit's round structure", () => {
    const s = summarizeSets(
      [set(10, 45, { round: 1 }), set(10, 45, { round: 2 }), set(10, 45, { round: 3 })],
      3
    );
    expect(s.summary).toBe("3 rounds x 10 @ 45 lb");
  });

  it("handles distance and duration efforts", () => {
    expect(summarizeSets([set(null, null, { distanceM: 400 })], 1).summary).toBe("400 m");
    expect(summarizeSets([set(null, null, { durationSeconds: 45 })], 1).summary).toBe("1 x 45s");
    expect(summarizeSets([set(null, null, { durationSeconds: 90 })], 1).summary).toBe("1 x 1m 30s");
  });

  it("trims the decimal noise the numeric column carries", () => {
    expect(summarizeSets([set(5, 42.5)], 1).summary).toBe("1 x 5 @ 42.5 lb");
    expect(summarizeSets([set(5, 45.0)], 1).summary).toBe("1 x 5 @ 45 lb");
  });
});

describe("summarizePrescription", () => {
  const base = { sets: null, reps: null, repsMin: null, repsMax: null, distanceM: null, duration: null };

  it("renders a rep range when the plan carries one", () => {
    expect(summarizePrescription({ ...base, sets: 3, reps: 10, repsMin: 8, repsMax: 12 })).toBe("3 x 8-12");
  });
  it("falls back to the single rep target", () => {
    expect(summarizePrescription({ ...base, sets: 4, reps: 8 })).toBe("4 x 8");
  });
  it("prefers distance and duration over reps", () => {
    expect(summarizePrescription({ ...base, sets: 1, reps: 10, distanceM: 400 })).toBe("400 m");
    expect(summarizePrescription({ ...base, sets: 3, duration: 45 })).toBe("3 x 45s");
  });
});

describe("blockLabel", () => {
  it("names the protocol and its shape", () => {
    expect(blockLabel("traditional", null, 15, null, null)).toBe("Strength · 15 min");
    expect(blockLabel("circuit", 3, 14, null, null)).toBe("Circuit · 3 rounds · 14 min");
  });
  it("prefers a time cap over a duration, and carries a score", () => {
    expect(blockLabel("amrap", null, 12, 8, "5 rounds + 6 reps")).toBe(
      "AMRAP · 8 min cap · scored 5 rounds + 6 reps"
    );
  });
  it("falls back to Strength for an unknown type", () => {
    expect(blockLabel("something_new", null, 10, null, null)).toBe("Strength · 10 min");
  });
});

describe("blockScore", () => {
  it("prefers an explicit score, then rounds, then elapsed", () => {
    expect(blockScore({ score: "21-15-9", roundsCompleted: 3, totalReps: 10, actualTimeMinutes: 9 })).toBe("21-15-9");
    expect(blockScore({ score: null, roundsCompleted: 5, totalReps: 6, actualTimeMinutes: null })).toBe("5 rounds + 6 reps");
    expect(blockScore({ score: null, roundsCompleted: 5, totalReps: null, actualTimeMinutes: null })).toBe("5 rounds");
    expect(blockScore({ score: null, roundsCompleted: null, totalReps: null, actualTimeMinutes: 9 })).toBe("9 min");
  });
  it("returns null when block_logs holds nothing usable", () => {
    expect(blockScore(undefined)).toBeNull();
    expect(blockScore({ score: null, roundsCompleted: null, totalReps: null, actualTimeMinutes: null })).toBeNull();
  });
});

describe("isPlausibleDuration", () => {
  it("accepts a believable session", () => {
    expect(isPlausibleDuration(2760, 12)).toBe(true); // 46 min, 12 sets
  });

  it("rejects the sub-minute timer artifact", () => {
    // Real prod shape: a full session logged, but the timer never ran.
    expect(isPlausibleDuration(34, 19)).toBe(false);
  });

  it("rejects a duration too short for the sets logged", () => {
    expect(isPlausibleDuration(120, 40)).toBe(false); // 2 min for 40 sets
    expect(isPlausibleDuration(600, 40)).toBe(true); // 10 min for 40 sets
  });

  it("treats a missing or zero duration as unusable", () => {
    expect(isPlausibleDuration(null, 10)).toBe(false);
    expect(isPlausibleDuration(0, 10)).toBe(false);
  });
});
