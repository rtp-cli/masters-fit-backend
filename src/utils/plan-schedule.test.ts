import { describe, it, expect } from "@jest/globals";
import {
  buildPlanDaySchedule,
  formatSlotLabel,
  renderScheduleLines,
  mentionsWeekday,
  mentionsScheduleChange,
  mentionsEquipmentFreeDay,
  resolveEffectiveSchedule,
  scheduleClampConflict,
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

  // [GQ-17] A missing/empty availableDays used to fall back to all 7 weekdays,
  // producing a zero-rest daily grind (the workout-468 symptom). It now falls
  // back to the conservative DEFAULT_AVAILABLE_DAYS spread (Mon/Wed/Fri) — rest
  // built in, never 7 consecutive workout days.
  it("falls back to the Mon/Wed/Fri spread (not 7 days) when availableDays is empty", () => {
    const schedule = buildPlanDaySchedule([], "2026-08-03"); // 2026-08-03 is a Monday
    expect(schedule).toHaveLength(3);
    expect(schedule.map((s) => s.weekday)).toEqual([
      "monday",
      "wednesday",
      "friday",
    ]);
    expect(schedule.map((s) => s.date)).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-07",
    ]);
  });

  it("falls back to the same spread when availableDays is null", () => {
    const schedule = buildPlanDaySchedule(null, "2026-08-03");
    expect(schedule).toHaveLength(3);
    expect(schedule.map((s) => s.weekday)).toEqual([
      "monday",
      "wednesday",
      "friday",
    ]);
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

describe("scheduleClampConflict [GQ-04]", () => {
  it("reports a conflict when the requested day count exceeds available days", () => {
    const conflict = scheduleClampConflict(
      { dayCount: 6 },
      { availableDays: ["monday", "wednesday", "friday"], startDate: "2026-08-03", dayCount: 3, overridden: true }
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.request).toContain("6 workout days");
    expect(conflict!.reason).toContain("3 training days");
    expect(conflict!.reason).toContain("uses 3");
  });

  it("returns null when the requested count fits within available days", () => {
    const conflict = scheduleClampConflict(
      { dayCount: 3 },
      { availableDays: ["monday", "wednesday", "friday"], startDate: "2026-08-03", dayCount: 3, overridden: false }
    );
    expect(conflict).toBeNull();
  });

  it("ignores all-invalid daysOfWeek (matches resolveEffectiveSchedule) and still reports the day-count clamp", () => {
    const conflict = scheduleClampConflict(
      { daysOfWeek: ["someday", "funday"], dayCount: 6 },
      { availableDays: ["monday", "wednesday", "friday"], startDate: "2026-08-03", dayCount: 3, overridden: true }
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.request).toContain("6 workout days");
  });

  it("returns null for a named-days request (can't clamp — the user gets exactly what they named)", () => {
    const conflict = scheduleClampConflict(
      { daysOfWeek: ["saturday", "sunday"] },
      { availableDays: ["saturday", "sunday"], startDate: "2026-08-08", dayCount: 2, overridden: true }
    );
    expect(conflict).toBeNull();
  });

  it("returns null when there is no override", () => {
    expect(
      scheduleClampConflict(undefined, {
        availableDays: ["monday", "tuesday"],
        startDate: "2026-08-03",
        dayCount: 2,
        overridden: false,
      })
    ).toBeNull();
  });

  it("uses the singular 'day' when exactly one day is available", () => {
    const conflict = scheduleClampConflict(
      { dayCount: 4 },
      { availableDays: ["monday"], startDate: "2026-08-03", dayCount: 1, overridden: true }
    );
    expect(conflict!.reason).toContain("1 training day,");
  });
});

describe("mentionsEquipmentFreeDay [GQ-06 plausibility gate]", () => {
  it("matches explicit bodyweight / no-equipment / travel-workout requests", () => {
    for (const t of [
      "make Wednesday a bodyweight-only workout",
      "I travel Wednesdays — no equipment that day",
      "give me an equipment-free day",
      "Thursday should be calisthenics",
      "no gear on Friday please",
    ]) {
      expect(mentionsEquipmentFreeDay(t)).toBe(true);
    }
  });

  it("does not match unrelated feedback (so a stale note can't strip equipment)", () => {
    for (const t of [
      "keep Fridays easy",
      "more upper body this week",
      "I prefer dumbbells over barbells",
      "",
      undefined,
    ]) {
      expect(mentionsEquipmentFreeDay(t)).toBe(false);
    }
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

// ─── Calendar-aligned series (docs/CALENDAR_ALIGNED_SERIES.md) ───────────────
// 2026-09-07 is a Monday; the whole table below is anchored to that week.
import {
  calendarAlignedEndDate,
  buildCalendarAlignedSchedule,
  spansMultipleCalendarWeeks,
} from "@/utils/plan-schedule";

describe("calendarAlignedEndDate", () => {
  // Series must span >= 7 days inclusive and end on a Sunday: a Monday start
  // ends the SAME week's Sunday (7 days); every other weekday ends the
  // FOLLOWING week's Sunday (8-13 days).
  const cases: Array<[string, string, string, number]> = [
    ["monday", "2026-09-07", "2026-09-13", 7],
    ["tuesday", "2026-09-08", "2026-09-20", 13],
    ["wednesday", "2026-09-09", "2026-09-20", 12],
    ["thursday", "2026-09-10", "2026-09-20", 11],
    ["friday", "2026-09-11", "2026-09-20", 10],
    ["saturday", "2026-09-12", "2026-09-20", 9],
    ["sunday", "2026-09-13", "2026-09-20", 8],
  ];
  it.each(cases)(
    "%s start -> ends %s (%s days inclusive)",
    (_weekday, start, expectedEnd, expectedSpan) => {
      const end = calendarAlignedEndDate(start);
      expect(end).toBe(expectedEnd);
      // Inclusive span check via date walking.
      let span = 1;
      for (let d = start; d < end; d = addDays(d, 1)) span++;
      expect(span).toBe(expectedSpan);
    }
  );

  it("always lands on a Sunday", () => {
    for (const [, start] of cases) {
      const end = calendarAlignedEndDate(start);
      const [y, m, d] = end.split("-").map(Number);
      expect(new Date(y, m - 1, d).getDay()).toBe(0);
    }
  });
});

describe("buildCalendarAlignedSchedule", () => {
  const SIX_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  it("Monday start with 6 available days = one clean Mon-Sat week", () => {
    const slots = buildCalendarAlignedSchedule(SIX_DAYS, "2026-09-07");
    expect(slots).toHaveLength(6);
    expect(slots[0]).toEqual({
      dayNumber: 1,
      weekday: "monday",
      date: "2026-09-07",
    });
    expect(slots[5].date).toBe("2026-09-12");
  });

  it("Thursday start visits each available weekday of BOTH weeks (11-day window)", () => {
    const slots = buildCalendarAlignedSchedule(SIX_DAYS, "2026-09-10");
    // Thu/Fri/Sat of week 1 + Mon-Sat of week 2 = 9 slots, dates strictly ascending.
    expect(slots).toHaveLength(9);
    expect(slots[0].date).toBe("2026-09-10");
    expect(slots[slots.length - 1].date).toBe("2026-09-19");
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].date > slots[i - 1].date).toBe(true);
      expect(slots[i].dayNumber).toBe(i + 1);
    }
  });

  it("only places slots on available weekdays", () => {
    const slots = buildCalendarAlignedSchedule(
      ["monday", "wednesday", "friday"],
      "2026-09-10" // Thursday
    );
    // Week 1 remainder: Fri. Week 2: Mon/Wed/Fri.
    expect(slots.map((s) => s.date)).toEqual([
      "2026-09-11",
      "2026-09-14",
      "2026-09-16",
      "2026-09-18",
    ]);
  });

  it("maxDaysPerWeek caps each calendar week, earliest days first (GQ-02 dayCount)", () => {
    const slots = buildCalendarAlignedSchedule(SIX_DAYS, "2026-09-10", 3);
    // Week 1 (Thu-Sun): Thu, Fri, Sat = 3. Week 2: Mon, Tue, Wed = 3.
    expect(slots.map((s) => s.weekday)).toEqual([
      "thursday",
      "friday",
      "saturday",
      "monday",
      "tuesday",
      "wednesday",
    ]);
  });

  it("cap equal to available-day count is a no-op (the no-override case)", () => {
    const capped = buildCalendarAlignedSchedule(SIX_DAYS, "2026-09-10", 6);
    const uncapped = buildCalendarAlignedSchedule(SIX_DAYS, "2026-09-10");
    expect(capped).toEqual(uncapped);
  });

  it("Sunday start: the start day itself counts toward its own (ending) week", () => {
    const slots = buildCalendarAlignedSchedule(
      ["sunday", "monday"],
      "2026-09-13", // Sunday
      1
    );
    // Sun 9/13 is week 1's only day (cap 1); week 2 gets Mon 9/14; ends 9/20 (Sunday, capped out by Monday).
    expect(slots.map((s) => s.date)).toEqual(["2026-09-13", "2026-09-14"]);
  });

  it("falls back to the safe default spread for empty availableDays", () => {
    const slots = buildCalendarAlignedSchedule([], "2026-09-07");
    expect(slots.map((s) => s.weekday)).toEqual([
      "monday",
      "wednesday",
      "friday",
    ]);
  });
});

describe("spansMultipleCalendarWeeks", () => {
  it("false for a single Mon-Sun week", () => {
    const slots = buildCalendarAlignedSchedule(["monday", "friday"], "2026-09-07");
    expect(spansMultipleCalendarWeeks(slots)).toBe(false);
  });

  it("true when the window crosses into the next week", () => {
    const slots = buildCalendarAlignedSchedule(["monday", "friday"], "2026-09-10");
    expect(spansMultipleCalendarWeeks(slots)).toBe(true);
  });

  it("false for empty/single-slot schedules", () => {
    expect(spansMultipleCalendarWeeks([])).toBe(false);
    expect(
      spansMultipleCalendarWeeks([
        { dayNumber: 1, weekday: "monday", date: "2026-09-07" },
      ])
    ).toBe(false);
  });
});
