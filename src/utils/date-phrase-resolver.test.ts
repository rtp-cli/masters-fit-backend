import { describe, it, expect } from "@jest/globals";
import {
  isRecognizedDatePhrase,
  resolveDatePhrase,
} from "@/utils/date-phrase-resolver";

const TODAY = "2026-07-15"; // arbitrary fixed reference date, a Wednesday

describe("isRecognizedDatePhrase [LR-024]", () => {
  it("recognizes all four supported phrases, case-insensitively", () => {
    expect(isRecognizedDatePhrase("today")).toBe(true);
    expect(isRecognizedDatePhrase("Today")).toBe(true);
    expect(isRecognizedDatePhrase("yesterday")).toBe(true);
    expect(isRecognizedDatePhrase("this week")).toBe(true);
    expect(isRecognizedDatePhrase("Last Week")).toBe(true);
  });

  it("does not recognize an exact date string as a phrase", () => {
    expect(isRecognizedDatePhrase("2026-07-15")).toBe(false);
  });

  it("does not recognize an unsupported phrase", () => {
    expect(isRecognizedDatePhrase("next week")).toBe(false);
    expect(isRecognizedDatePhrase("tomorrow")).toBe(false);
  });
});

describe("resolveDatePhrase [LR-024]", () => {
  it('resolves "today" to the exact reference date', () => {
    expect(resolveDatePhrase("today", TODAY)).toEqual({
      type: "single",
      date: "2026-07-15",
    });
  });

  it('resolves "yesterday" to one day before', () => {
    expect(resolveDatePhrase("yesterday", TODAY)).toEqual({
      type: "single",
      date: "2026-07-14",
    });
  });

  it('resolves "this week" to a rolling 7-day window ending today', () => {
    expect(resolveDatePhrase("this week", TODAY)).toEqual({
      type: "range",
      startDate: "2026-07-09",
      endDate: "2026-07-15",
    });
  });

  it('resolves "last week" to the 7-day window before this week, no overlap', () => {
    expect(resolveDatePhrase("last week", TODAY)).toEqual({
      type: "range",
      startDate: "2026-07-02",
      endDate: "2026-07-08",
    });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveDatePhrase("  Today  ", TODAY)).toEqual({
      type: "single",
      date: "2026-07-15",
    });
  });

  it("returns null for anything not a recognized phrase (caller falls back to exact-date parsing)", () => {
    expect(resolveDatePhrase("2026-07-15", TODAY)).toBeNull();
    expect(resolveDatePhrase("next week", TODAY)).toBeNull();
  });

  it("correctly handles a month boundary (today near the start of a month)", () => {
    expect(resolveDatePhrase("yesterday", "2026-08-01")).toEqual({
      type: "single",
      date: "2026-07-31",
    });
  });
});
