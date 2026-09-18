import { describe, it, expect } from "@jest/globals";

import { resolveInsertPosition } from "@/utils/plan-day-position.utils";

/**
 * These tests originally used only 1-based fixtures, which is exactly why the
 * base bug reached production: the helper returned "count of earlier days + 1"
 * and every test agreed with it. Production does not — 246 plans number their
 * days from 0, 50 from 1, one from 4, and 12 have no dayNumber at all. The
 * cases below cover each of those.
 */
describe("resolveInsertPosition", () => {
  describe("a plan numbered from 1", () => {
    const plan = [
      { date: "2026-09-14", dayNumber: 1 },
      { date: "2026-09-16", dayNumber: 2 },
      { date: "2026-09-18", dayNumber: 3 },
    ];

    it("slots a new date in after the day before it", () => {
      expect(resolveInsertPosition(plan, "2026-09-15")).toBe(2);
    });

    it("appends after the last day", () => {
      expect(resolveInsertPosition(plan, "2026-09-20")).toBe(4);
    });

    it("takes the plan's own first number when inserting at the front", () => {
      expect(resolveInsertPosition(plan, "2026-09-10")).toBe(1);
    });
  });

  /**
   * The production case. A 0-based plan (Rich's workout 894) previously got
   * "count + 1", so a bonus session on the 17th landed at 5 while the 18th sat
   * at 4 — the plan sorted the evening top-up after the following day.
   */
  describe("a plan numbered from 0", () => {
    const plan = [
      { date: "2026-09-14", dayNumber: 0 },
      { date: "2026-09-15", dayNumber: 1 },
      { date: "2026-09-16", dayNumber: 2 },
      { date: "2026-09-17", dayNumber: 3 },
      { date: "2026-09-18", dayNumber: 4 },
      { date: "2026-09-19", dayNumber: 5 },
    ];

    it("puts a bonus session on the 17th at 4, not 5", () => {
      expect(resolveInsertPosition(plan, "2026-09-17", true)).toBe(4);
    });

    it("keeps a bonus session ahead of the following day", () => {
      const bonus = resolveInsertPosition(plan, "2026-09-17", true);
      const nextDay = plan.find((d) => d.date === "2026-09-18")!.dayNumber;
      // The 18th gets pushed to 5 by the caller, so the bonus must be below it.
      expect(bonus).toBeLessThanOrEqual(nextDay);
    });

    it("takes 0 when inserting at the front", () => {
      expect(resolveInsertPosition(plan, "2026-09-01")).toBe(0);
    });
  });

  // One production plan starts at 4. Nothing should assume 0 or 1.
  it("respects an arbitrary base", () => {
    const plan = [
      { date: "2026-09-14", dayNumber: 4 },
      { date: "2026-09-16", dayNumber: 5 },
    ];
    expect(resolveInsertPosition(plan, "2026-09-15")).toBe(5);
    expect(resolveInsertPosition(plan, "2026-09-01")).toBe(4);
  });

  // 12 production plans have no dayNumber at all.
  it("treats a missing dayNumber as 0 rather than throwing", () => {
    const plan = [
      { date: "2026-09-14", dayNumber: null },
      { date: "2026-09-16" },
    ];
    expect(resolveInsertPosition(plan, "2026-09-15")).toBe(1);
  });

  describe("bonus sessions", () => {
    const plan = [
      { date: "2026-09-14", dayNumber: 1 },
      { date: "2026-09-17", dayNumber: 2 },
      { date: "2026-09-19", dayNumber: 3 },
    ];

    // Without the flag a same-date insert collides with the existing session
    // and pushes it down, so the plan reads as though the top-up came first.
    it("lands after the session it supplements", () => {
      expect(resolveInsertPosition(plan, "2026-09-17")).toBe(2);
      expect(resolveInsertPosition(plan, "2026-09-17", true)).toBe(3);
    });

    it("stacks a third session after the second", () => {
      const twice = [
        { date: "2026-09-17", dayNumber: 1 },
        { date: "2026-09-17", dayNumber: 2 },
      ];
      expect(resolveInsertPosition(twice, "2026-09-17", true)).toBe(3);
    });

    it("does not change placement when no day shares the date", () => {
      expect(resolveInsertPosition(plan, "2026-09-16")).toBe(2);
      expect(resolveInsertPosition(plan, "2026-09-16", true)).toBe(2);
    });
  });

  it("returns 1 for an empty plan", () => {
    expect(resolveInsertPosition([], "2026-09-17")).toBe(1);
  });

  // Dates are compared as strings; that only holds because YYYY-MM-DD sorts
  // lexicographically.
  it("orders correctly across month and year boundaries", () => {
    const plan = [
      { date: "2026-08-31", dayNumber: 1 },
      { date: "2026-12-31", dayNumber: 2 },
    ];
    expect(resolveInsertPosition(plan, "2026-09-01")).toBe(2);
    expect(resolveInsertPosition(plan, "2027-01-01")).toBe(3);
  });
});
