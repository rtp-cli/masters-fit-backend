import { describe, it, expect } from "@jest/globals";
import {
  buildPlanDaySchedule,
  formatSlotLabel,
  renderScheduleLines,
  mentionsWeekday,
  mentionsScheduleChange,
  resolveEffectiveSchedule,
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

describe("resolveEffectiveSchedule [GQ-02]", () => {
  const profileDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const today = "2026-08-04"; // Tuesday

  it("no override -> identical to profile defaults (overridden=false)", () => {
    const r = resolveEffectiveSchedule(undefined, profileDays, today);
    expect(r).toEqual({
      availableDays: profileDays,
      startDate: today,
      dayCount: 5,
      overridden: false,
    });
    expect(resolveEffectiveSchedule({}, profileDays, today).overridden).toBe(false);
  });

  it("daysOfWeek override replaces available days and sets count", () => {
    const r = resolveEffectiveSchedule(
      { daysOfWeek: ["monday", "wednesday", "friday"] },
      profileDays,
      today
    );
    expect(r.availableDays).toEqual(["monday", "wednesday", "friday"]);
    expect(r.dayCount).toBe(3);
    expect(r.overridden).toBe(true);
  });

  it("dayCount is clamped to 1..availableDays (no multi-week span)", () => {
    expect(resolveEffectiveSchedule({ dayCount: 3 }, profileDays, today).dayCount).toBe(3);
    expect(resolveEffectiveSchedule({ dayCount: 0 }, profileDays, today).dayCount).toBe(1);
    // 99 requested but only 5 available weekdays -> capped at 5 (a normal week).
    expect(resolveEffectiveSchedule({ dayCount: 99 }, profileDays, today).dayCount).toBe(5);
    // ...and a 2-day profile can't be stretched to 5.
    const r = resolveEffectiveSchedule({ dayCount: 5 }, ["monday", "wednesday"], today);
    expect(r.dayCount).toBe(2);
  });

  it("dedupes daysOfWeek and derives the count from the named days", () => {
    const r = resolveEffectiveSchedule(
      { daysOfWeek: ["saturday", "saturday", "sunday"], dayCount: 3 },
      profileDays,
      today
    );
    expect(r.availableDays).toEqual(["saturday", "sunday"]); // deduped
    expect(r.dayCount).toBe(2); // named-days count wins over a contradictory dayCount
  });

  it("startWeekday shifts the start date to that weekday's next occurrence", () => {
    // From Tue 2026-08-04, next Monday is 2026-08-10.
    const r = resolveEffectiveSchedule({ startWeekday: "monday" }, profileDays, today);
    expect(r.startDate).toBe("2026-08-10");
    expect(r.overridden).toBe(true);
  });

  it("ignores invalid weekday names and non-finite counts (falls back, not overridden)", () => {
    const r = resolveEffectiveSchedule(
      { daysOfWeek: ["funday", ""], startWeekday: "someday", dayCount: NaN },
      profileDays,
      today
    );
    expect(r.availableDays).toEqual(profileDays);
    expect(r.startDate).toBe(today);
    expect(r.dayCount).toBe(5);
    expect(r.overridden).toBe(false);
  });

  it("combines daysOfWeek + startWeekday", () => {
    const r = resolveEffectiveSchedule(
      { daysOfWeek: ["saturday", "sunday"], startWeekday: "saturday" },
      profileDays,
      today
    );
    expect(r.availableDays).toEqual(["saturday", "sunday"]);
    expect(r.dayCount).toBe(2);
    expect(r.startDate).toBe("2026-08-08"); // next Saturday
    // buildPlanDaySchedule with these effective inputs lands on Sat/Sun.
    const sched = buildPlanDaySchedule(r.availableDays, r.startDate, r.dayCount);
    expect(sched.map((s) => s.weekday)).toEqual(["saturday", "sunday"]);
  });
});

describe("mentionsScheduleChange [GQ-02 plausibility gate]", () => {
  it("accepts explicit schedule-change requests", () => {
    expect(mentionsScheduleChange("only 3 days this week")).toBe(true);
    expect(mentionsScheduleChange("just Mondays and Wednesdays please")).toBe(true);
    expect(mentionsScheduleChange("weekends only")).toBe(true);
    expect(mentionsScheduleChange("start my plan next Monday")).toBe(true);
    expect(mentionsScheduleChange("I only have time for two workouts")).toBe(true);
  });
  it("rejects calendar-CONTENT language that must NOT trigger a reschedule", () => {
    // The critical false-positive class: naming a weekday for content.
    expect(mentionsScheduleChange("keep Fridays easy before my long run")).toBe(false);
    expect(mentionsScheduleChange("go heavy on legs")).toBe(false);
    expect(mentionsScheduleChange("no deadlifts")).toBe(false);
    expect(mentionsScheduleChange("")).toBe(false);
    expect(mentionsScheduleChange(null)).toBe(false);
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
