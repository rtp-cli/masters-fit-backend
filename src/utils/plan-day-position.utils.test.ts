import { describe, it, expect } from "@jest/globals";

import { resolveInsertPosition } from "@/utils/plan-day-position.utils";

describe("resolveInsertPosition", () => {
  // A normal rest-day fill-in: the plan has Mon/Wed/Fri and the user adds
  // Tuesday. It slots between them.
  it("places a new date between the days around it", () => {
    const existing = ["2026-09-14", "2026-09-16", "2026-09-18"];
    expect(resolveInsertPosition(existing, "2026-09-15")).toBe(2);
  });

  it("places an earlier date first and a later date last", () => {
    const existing = ["2026-09-14", "2026-09-16"];
    expect(resolveInsertPosition(existing, "2026-09-10")).toBe(1);
    expect(resolveInsertPosition(existing, "2026-09-20")).toBe(3);
  });

  it("returns 1 for the first day of an empty plan", () => {
    expect(resolveInsertPosition([], "2026-09-17")).toBe(1);
  });

  /**
   * [LR-069] The bonus-session case, and the reason this function exists.
   *
   * Without the flag, a second session on a date takes the SAME position as the
   * session already there, which pushes the original down — so the plan reads
   * as though the evening top-up happened before the morning workout. The flag
   * counts same-date days as already ahead, so the bonus lands after.
   */
  it("places a bonus session AFTER the session it supplements", () => {
    const existing = ["2026-09-14", "2026-09-17", "2026-09-19"];
    // Without the flag it would collide with the existing 09-17 day at 2.
    expect(resolveInsertPosition(existing, "2026-09-17")).toBe(2);
    expect(resolveInsertPosition(existing, "2026-09-17", true)).toBe(3);
  });

  it("stacks a third session on the same date after the second", () => {
    const existing = ["2026-09-17", "2026-09-17"];
    expect(resolveInsertPosition(existing, "2026-09-17", true)).toBe(3);
  });

  // The flag must only affect same-date ties, never ordinary placement.
  it("does not change placement when no day shares the date", () => {
    const existing = ["2026-09-14", "2026-09-19"];
    expect(resolveInsertPosition(existing, "2026-09-17")).toBe(2);
    expect(resolveInsertPosition(existing, "2026-09-17", true)).toBe(2);
  });

  // Dates arrive as YYYY-MM-DD text and are compared as strings; that only
  // holds because the format sorts lexicographically.
  it("orders correctly across month and year boundaries", () => {
    const existing = ["2026-08-31", "2026-12-31"];
    expect(resolveInsertPosition(existing, "2026-09-01")).toBe(2);
    expect(resolveInsertPosition(existing, "2027-01-01")).toBe(3);
  });
});
