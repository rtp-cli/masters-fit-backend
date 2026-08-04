import { describe, it, expect } from "@jest/globals";
import {
  buildPlanDaySchedule,
  formatSlotLabel,
  renderScheduleLines,
  mentionsWeekday,
} from "@/utils/plan-schedule";
import { getDateForWeekday, addDays } from "@/utils/date.utils";

// Reference implementation of the OLD inline stamping rotation
// (workout.service, pre-GQ-01). buildPlanDaySchedule must stay byte-identical
// to this so switching the persistence layer over doesn't move any dates.
function legacySchedule(availableDays: string[], startDate: string): string[] {
  const daysOfWeek = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const [y, m, d] = startDate.split("-").map(Number);
  const todayIndex = new Date(y, m - 1, d).getDay();
  const rotated = availableDays
    .map((day) => ({ day, index: daysOfWeek.indexOf(day) }))
    .sort(
      (a, b) => ((a.index - todayIndex + 7) % 7) - ((b.index - todayIndex + 7) % 7)
    )
    .map((o) => o.day);
  const dates: string[] = [];
  let ref = startDate;
  for (let i = 0; i < rotated.length; i++) {
    const date = getDateForWeekday(rotated[i], ref);
    ref = addDays(date, 1);
    dates.push(date);
  }
  return dates;
}

describe("buildPlanDaySchedule [GQ-01]", () => {
  it("assigns sequential dates rotated by proximity to the start date's weekday", () => {
    // 2026-08-03 is a Monday.
    const schedule = buildPlanDaySchedule(
      ["monday", "wednesday", "friday"],
      "2026-08-03"
    );
    expect(schedule).toEqual([
      { dayNumber: 1, weekday: "monday", date: "2026-08-03" },
      { dayNumber: 2, weekday: "wednesday", date: "2026-08-05" },
      { dayNumber: 3, weekday: "friday", date: "2026-08-07" },
    ]);
  });

  it("rotates so the soonest available day (relative to today) is Day 1", () => {
    // Start on Wednesday 2026-08-05; available Mon/Wed/Fri -> Wed is soonest.
    const schedule = buildPlanDaySchedule(
      ["monday", "wednesday", "friday"],
      "2026-08-05"
    );
    expect(schedule.map((s) => s.weekday)).toEqual([
      "wednesday",
      "friday",
      "monday",
    ]);
    // Monday wraps to the following week.
    expect(schedule[0].date).toBe("2026-08-05");
    expect(schedule[2].date).toBe("2026-08-10");
  });

  it("cycles available days for a larger dayCount with UNIQUE, later dates (no duplicates)", () => {
    // 2 available weekdays, 5 plan days -> weekdays cycle but dates must be unique.
    const schedule = buildPlanDaySchedule(["monday", "thursday"], "2026-08-03", 5);
    expect(schedule).toHaveLength(5);
    const dates = schedule.map((s) => s.date);
    expect(new Set(dates).size).toBe(5); // all distinct
    expect(schedule.map((s) => s.weekday)).toEqual([
      "monday",
      "thursday",
      "monday",
      "thursday",
      "monday",
    ]);
    // Cycled Monday lands the FOLLOWING week, not a repeat of the first.
    expect(schedule[2].date).toBe("2026-08-10");
    expect(dates).toEqual([...dates].sort()); // strictly increasing
  });

  it("defaults to a full 7-day week when availableDays is empty", () => {
    const schedule = buildPlanDaySchedule([], "2026-08-03");
    expect(schedule).toHaveLength(7);
    expect(schedule[0]).toEqual({
      dayNumber: 1,
      weekday: "monday",
      date: "2026-08-03",
    });
  });

  it("stays byte-identical to the legacy stamping rotation across cases", () => {
    const cases: Array<[string[], string]> = [
      [["monday", "wednesday", "friday"], "2026-08-03"],
      [["tuesday", "thursday", "saturday"], "2026-08-05"],
      [["monday", "tuesday", "thursday", "friday", "saturday"], "2026-08-04"],
      [["sunday", "wednesday"], "2026-08-07"],
    ];
    for (const [days, start] of cases) {
      const mine = buildPlanDaySchedule(days, start).map((s) => s.date);
      expect(mine).toEqual(legacySchedule(days, start));
    }
  });
});

describe("mentionsWeekday [GQ-10 reorder gate]", () => {
  it("detects weekday and weekend references", () => {
    expect(mentionsWeekday("keep Fridays easy")).toBe(true);
    expect(mentionsWeekday("long run on Saturday")).toBe(true);
    expect(mentionsWeekday("no workouts on weekends")).toBe(true);
    expect(mentionsWeekday("MONDAY should be light")).toBe(true);
  });
  it("returns false for non-calendar requests and empty input", () => {
    expect(mentionsWeekday("no deadlifts, more upper body")).toBe(false);
    expect(mentionsWeekday("")).toBe(false);
    expect(mentionsWeekday(null)).toBe(false);
    expect(mentionsWeekday(undefined)).toBe(false);
    // Must not false-match substrings inside other words.
    expect(mentionsWeekday("summon strength, satiate hunger")).toBe(false);
  });
});

describe("formatSlotLabel [GQ-01]", () => {
  it("formats a slot as 'Weekday, Mon D'", () => {
    expect(
      formatSlotLabel({ dayNumber: 2, weekday: "thursday", date: "2026-08-06" })
    ).toBe("Thursday, Aug 6");
  });
});

describe("renderScheduleLines [GQ-01]", () => {
  it("marks the current generation day", () => {
    const schedule = buildPlanDaySchedule(["monday", "wednesday"], "2026-08-03");
    const rendered = renderScheduleLines(schedule, 2);
    expect(rendered).toContain("- Day 1 — Monday, Aug 3");
    expect(rendered).toContain(
      "- Day 2 — Wednesday, Aug 5  ← YOU ARE GENERATING THIS DAY"
    );
  });
});
