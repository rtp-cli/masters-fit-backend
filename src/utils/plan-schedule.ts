import { getDateForWeekday, addDays } from "./date.utils";

/**
 * [GQ-01] Calendar fidelity for weekly generation.
 *
 * The day-number -> {weekday, date} mapping used to exist only implicitly in the
 * persistence layer (workout.service stamped dates AFTER generation), so the LLM
 * never saw which real weekday/date each "Day N" landed on — making calendar
 * language ("keep legs fresh before my Saturday run", "rest day mid-week")
 * structurally unenforceable. This module computes that mapping ONCE, so the
 * prompt builders can label every slot "Day 3 — Thursday, Aug 6" and the
 * date-stamping code can consume the exact same schedule: the dates the model
 * sees are byte-identical to the dates that get saved.
 */

const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface PlanDaySlot {
  /** 1-based; matches the planning call's day numbering and workoutPlan index+1. */
  dayNumber: number;
  /** Lowercase weekday name, e.g. "thursday". */
  weekday: string;
  /** Scheduled calendar date, YYYY-MM-DD. */
  date: string;
}

/**
 * Deterministic day-number -> {weekday, date} schedule for a generated week.
 *
 * Mirrors exactly what workout.service does when it stamps plan-day dates:
 * rotate the user's available days so the soonest one relative to `startDate`
 * comes first, then walk forward assigning each subsequent available weekday its
 * next calendar occurrence. Extracting it here lets the prompts and the
 * persistence layer share one source of truth (see module doc).
 *
 * `startDate` must already be resolved to the user's timezone (YYYY-MM-DD); the
 * rotation key is that date's weekday, so both callers must pass the same
 * "today". When `afterDate` is supplied the underlying getDateForWeekday is
 * timezone-agnostic (pure date arithmetic), so this function is deterministic
 * and timezone-safe.
 *
 * `dayCount` defaults to the number of available days. Pass a larger count to
 * schedule more plan days than there are available weekdays: the available days
 * cycle, but a walking reference date guarantees every slot gets a UNIQUE, later
 * calendar date (never a duplicate) — matching the old inline walking rotation.
 */
export function buildPlanDaySchedule(
  availableDays: string[] | null | undefined,
  startDate: string,
  dayCount?: number
): PlanDaySlot[] {
  // Onboarding requires >=1 available day; default to the full week (in calendar
  // order from today) if somehow absent, so callers never divide by an empty list.
  const days =
    availableDays && availableDays.length > 0
      ? availableDays
      : [...DAYS_OF_WEEK];

  const [year, month, day] = startDate.split("-").map(Number);
  const todayIndex = new Date(year, month - 1, day).getDay();

  const rotated = days
    .map((d) => ({ day: d, index: DAYS_OF_WEEK.indexOf(d.toLowerCase()) }))
    .sort(
      (a, b) =>
        ((a.index - todayIndex + 7) % 7) - ((b.index - todayIndex + 7) % 7)
    )
    .map((o) => o.day);

  const count = dayCount != null && dayCount > 0 ? dayCount : rotated.length;
  const slots: PlanDaySlot[] = [];
  let referenceDate = startDate;
  for (let i = 0; i < count; i++) {
    const weekday = rotated[i % rotated.length];
    const date = getDateForWeekday(weekday, referenceDate);
    // Advance past this date so the next slot gets its following occurrence
    // (prevents two slots landing on the same date, even when weekdays cycle).
    referenceDate = addDays(date, 1);
    slots.push({ dayNumber: i + 1, weekday: weekday.toLowerCase(), date });
  }
  return slots;
}

/**
 * Human/LLM-friendly label for a slot, e.g. "Thursday, Aug 6". Pure string math
 * off the YYYY-MM-DD date — never constructs a Date in a way that could shift
 * across a timezone boundary.
 */
export function formatSlotLabel(slot: PlanDaySlot): string {
  const [, month, day] = slot.date.split("-").map(Number);
  const weekday =
    slot.weekday.charAt(0).toUpperCase() + slot.weekday.slice(1);
  return `${weekday}, ${MONTHS_SHORT[month - 1]} ${day}`;
}

/**
 * Renders the week's schedule as bullet lines for a prompt, optionally marking
 * one day as the current generation target:
 *   - Day 1 — Monday, Aug 4
 *   - Day 2 — Wednesday, Aug 6  ← YOU ARE GENERATING THIS DAY
 */
export function renderScheduleLines(
  schedule: PlanDaySlot[],
  currentDayNumber?: number
): string {
  return schedule
    .map((slot) => {
      const marker =
        currentDayNumber != null && slot.dayNumber === currentDayNumber
          ? "  ← YOU ARE GENERATING THIS DAY"
          : "";
      return `- Day ${slot.dayNumber} — ${formatSlotLabel(slot)}${marker}`;
    })
    .join("\n");
}
