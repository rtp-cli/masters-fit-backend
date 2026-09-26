import { describe, it, expect } from "@jest/globals";
import { spreadTrainingDays, trainingDaysFor } from "@/utils/plan-schedule";

const ALL = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

describe("spreadTrainingDays [LR-085]", () => {
  it("spreads a seven-day user to Mon/Wed/Fri, not Mon/Tue/Wed", () => {
    // The earliest-days cap would give three days in a row then four off.
    expect(spreadTrainingDays(ALL, 3)).toEqual(["monday", "wednesday", "friday"]);
  });

  it("includes today when an equally spread set does", () => {
    // Any rotation of 2-2-3 gaps is equally good for a seven-day user, so the
    // plan can start today — a session on day one is what gets people started.
    expect(spreadTrainingDays(ALL, 3, "thursday")).toContain("thursday");
    expect(spreadTrainingDays(ALL, 3, "saturday")).toContain("saturday");
  });

  it("never trades a back-to-back day for today", () => {
    // Mon/Wed/Fri: preferring Tuesday would force two adjacent days.
    const out = spreadTrainingDays(["monday", "tuesday", "wednesday", "friday"], 3, "tuesday");
    expect(out).toEqual(["monday", "wednesday", "friday"]);
  });

  it("picks Mon/Wed/Fri out of a weekdays-only schedule", () => {
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    expect(spreadTrainingDays(weekdays, 3)).toEqual(["monday", "wednesday", "friday"]);
  });

  it("leaves someone with three or fewer free days alone", () => {
    expect(spreadTrainingDays(["saturday", "sunday"], 3)).toEqual(["saturday", "sunday"]);
    expect(spreadTrainingDays(["tuesday", "thursday", "saturday"], 3)).toEqual([
      "tuesday",
      "thursday",
      "saturday",
    ]);
  });

  it("uses the week wrap: Sunday and Monday are adjacent", () => {
    // From Fri/Sat/Sun/Mon every triple has one adjacency; it must not pretend
    // Sun→Mon is a six-day gap.
    const out = spreadTrainingDays(["friday", "saturday", "sunday", "monday"], 2);
    // Best pair is two days apart either way (Fri/Sun or Sat/Mon), not Sun/Mon.
    expect(out).not.toEqual(["monday", "sunday"]);
    expect(out.length).toBe(2);
  });

  it("normalises and dedupes messy input", () => {
    expect(spreadTrainingDays(["Monday", "monday", " FRIDAY ", "bogus"], 3)).toEqual([
      "monday",
      "friday",
    ]);
  });
});

describe("trainingDaysFor [LR-085]", () => {
  // 2026-09-24 is a Thursday.
  it("spreads a beginner's days and includes today when it can", () => {
    const out = trainingDaysFor("beginner", ALL, "2026-09-24");
    expect(out).toHaveLength(3);
    expect(out).toContain("thursday");
  });

  it("gives everyone else every day they're free", () => {
    expect(trainingDaysFor("intermediate", ALL, "2026-09-24")).toEqual(ALL);
    expect(trainingDaysFor("advanced", ["monday", "friday"], "2026-09-24")).toEqual([
      "monday",
      "friday",
    ]);
  });

  it("treats an unanswered level as unconstrained, not as beginner", () => {
    expect(trainingDaysFor(null, ALL, "2026-09-24")).toEqual(ALL);
  });

  it("respects BEGINNER_DAYS_PER_WEEK", () => {
    const prev = process.env.BEGINNER_DAYS_PER_WEEK;
    process.env.BEGINNER_DAYS_PER_WEEK = "2";
    try {
      expect(trainingDaysFor("beginner", ALL, "2026-09-24")).toHaveLength(2);
    } finally {
      if (prev === undefined) delete process.env.BEGINNER_DAYS_PER_WEEK;
      else process.env.BEGINNER_DAYS_PER_WEEK = prev;
    }
  });
});
