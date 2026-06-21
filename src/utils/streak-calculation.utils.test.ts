import { describe, it, expect } from "@jest/globals";
import {
  calculateScheduledWorkoutStreak,
  StreakDayData,
} from "./streak-calculation.utils";

describe("calculateScheduledWorkoutStreak", () => {
  it("counts a normal run of consecutive completed scheduled workouts", () => {
    const days: StreakDayData[] = [
      { date: "2026-06-15", isComplete: true },
      { date: "2026-06-17", isComplete: true }, // rest day on 16th is simply absent
      { date: "2026-06-19", isComplete: true },
    ];
    // today is after the last scheduled day; all three count.
    expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(3);
  });

  it("does not break the streak when today's scheduled workout is not yet done", () => {
    const days: StreakDayData[] = [
      { date: "2026-06-17", isComplete: true },
      { date: "2026-06-19", isComplete: true },
      { date: "2026-06-20", isComplete: false }, // today, pending
    ];
    // today's incomplete day neither counts nor breaks; prior two still count.
    expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(2);
  });

  it("breaks the streak on a past missed scheduled day", () => {
    const days: StreakDayData[] = [
      { date: "2026-06-15", isComplete: true },
      { date: "2026-06-17", isComplete: false }, // missed in the past
      { date: "2026-06-19", isComplete: true },
    ];
    // Walking newest-first: 19th counts, 17th is a past miss → stop. Streak = 1.
    expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(1);
  });

  it("ignores future scheduled workouts entirely", () => {
    const days: StreakDayData[] = [
      { date: "2026-06-19", isComplete: true },
      { date: "2026-06-21", isComplete: false }, // future, ignored
      { date: "2026-06-23", isComplete: true }, // future, ignored
    ];
    expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(1);
  });

  it("counts a date once even with multiple plan days, complete if any is complete", () => {
    const days: StreakDayData[] = [
      { date: "2026-06-19", isComplete: false },
      { date: "2026-06-19", isComplete: true }, // same date, one complete
    ];
    expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(1);
  });

  describe("timezone correctness", () => {
    // Scenario: a user west of UTC in the evening. The server's UTC clock has
    // already rolled to the next calendar day (2026-06-21), but the user's real
    // local day is still 2026-06-20, where they have a pending (incomplete)
    // workout. With a UTC "today", that pending workout looks like a PAST miss
    // and wrongly breaks the streak. With the user's local "today" it must not.
    const days: StreakDayData[] = [
      { date: "2026-06-18", isComplete: true },
      { date: "2026-06-19", isComplete: true },
      { date: "2026-06-20", isComplete: false }, // user's local today, pending
    ];

    it("would wrongly break the streak when 'today' is the UTC date", () => {
      // Using the UTC-rolled date treats 2026-06-20 as a past miss → streak resets.
      expect(calculateScheduledWorkoutStreak(days, "2026-06-21")).toBe(0);
    });

    it("preserves the streak when 'today' is the user's local date", () => {
      // The pending workout is on the user's local today, so it neither counts
      // nor breaks; the two prior completed days still form a streak of 2.
      expect(calculateScheduledWorkoutStreak(days, "2026-06-20")).toBe(2);
    });
  });
});
