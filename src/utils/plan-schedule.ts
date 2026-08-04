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

export interface ScheduleOverride {
  daysOfWeek?: string[];
  dayCount?: number;
  startWeekday?: string;
}

export interface EffectiveSchedule {
  availableDays: string[];
  startDate: string;
  dayCount: number;
  /** True when any override field actually changed the effective schedule. */
  overridden: boolean;
}

/**
 * [GQ-02] Resolves the user's explicit scheduling override (extracted by the
 * planning call) into concrete effective schedule inputs, deterministically:
 *   - daysOfWeek  -> replaces the profile's available days for this week
 *   - startWeekday-> shifts the start to that weekday's next occurrence
 *   - dayCount    -> number of workout days (clamped to 1..7)
 * `todayStartDate` is the already-timezone-resolved YYYY-MM-DD "today". Invalid /
 * absent fields fall back to the profile defaults, so a normal week (no override)
 * returns exactly what the pre-GQ-02 code did (overridden=false).
 */
export function resolveEffectiveSchedule(
  override: ScheduleOverride | undefined,
  profileAvailableDays: string[] | null | undefined,
  todayStartDate: string
): EffectiveSchedule {
  const clean = (arr?: string[]) => [
    // Dedupe: an LLM enum array commonly repeats a value ("saturday",
    // "saturday", "sunday"); without dedup the day count would be inflated and
    // then mismatch the planner's real day entries, forcing the serial fallback.
    ...new Set(
      (arr || [])
        .map((d) => (d || "").trim().toLowerCase())
        .filter((d) => DAYS_OF_WEEK.includes(d))
    ),
  ];

  const baseDays =
    profileAvailableDays && profileAvailableDays.length > 0
      ? profileAvailableDays
      : [...DAYS_OF_WEEK];

  const overrideDays = clean(override?.daysOfWeek);
  const availableDays = overrideDays.length > 0 ? overrideDays : baseDays;

  const startWeekday = (override?.startWeekday || "").trim().toLowerCase();
  const hasStart = DAYS_OF_WEEK.includes(startWeekday);
  const startDate = hasStart
    ? getDateForWeekday(startWeekday, todayStartDate)
    : todayStartDate;

  // Day count. When specific days are named, the count IS the number of named
  // days (a contradictory dayCount is ignored). Otherwise honor dayCount but
  // never exceed the available weekdays — asking for more days than you have
  // available would otherwise cycle a weekday across multiple weeks and turn a
  // "week" into a multi-week span.
  const hasDayCount =
    override?.dayCount != null && Number.isFinite(override.dayCount);
  let dayCount: number;
  if (overrideDays.length > 0) {
    dayCount = overrideDays.length;
  } else if (hasDayCount) {
    dayCount = Math.max(
      1,
      Math.min(availableDays.length, Math.round(override!.dayCount as number))
    );
  } else {
    dayCount = availableDays.length;
  }

  const overridden =
    overrideDays.length > 0 ||
    hasStart ||
    (hasDayCount && dayCount !== baseDays.length);

  return { availableDays, startDate, dayCount, overridden };
}

const WEEKDAY_MENTION_RE =
  /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?)\b/i;

/**
 * True when the text references a specific weekday or weekend — i.e. the user's
 * request is calendar-sensitive (e.g. "keep Fridays easy", "long run Saturday").
 * Used to protect date-locked day content from muscle-balance reordering.
 */
export function mentionsWeekday(text: string | null | undefined): boolean {
  return !!text && WEEKDAY_MENTION_RE.test(text);
}

// [GQ-02] Explicit "change my schedule" signals — distinct from merely naming a
// weekday for CONTENT ("keep Fridays easy"). Requires a day count, a
// restriction word next to a day, "weekends/weekdays only", or a start phrase.
const SCHEDULE_CHANGE_RE = new RegExp(
  [
    // a count of days/workouts: "3 days", "only two workouts this week"
    "\\b(\\d+|one|two|three|four|five|six|seven|couple)\\s+(days?|workouts?|sessions?|times?)\\b",
    // "just/only Mondays", "only on Mon and Wed"
    "\\b(just|only)\\b[^.!?]{0,30}\\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?)\\b",
    // "weekends only" / "weekdays only"
    "\\b(weekends?|weekdays?)\\s+only\\b",
    // "start/begin ... monday/next week/tomorrow"
    "\\b(start|starting|begin|beginning)\\b[^.!?]{0,30}\\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|next week|tomorrow|this week)\\b",
  ].join("|"),
  "i"
);

/**
 * [GQ-02] True when the LIVE request explicitly asks to change WHEN or HOW MANY
 * days the user trains. A code-side plausibility gate on the planner's
 * `constraints.schedule` extraction: the override is only honored when the
 * user's own words corroborate it, so a mis-extraction from calendar-content
 * language ("keep Fridays easy") or a stale recent-feedback note can't silently
 * shrink or shift a normal week. Deliberately checks the live customFeedback
 * only — scheduling changes come from the current request, not background notes.
 */
export function mentionsScheduleChange(text: string | null | undefined): boolean {
  return !!text && SCHEDULE_CHANGE_RE.test(text);
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
