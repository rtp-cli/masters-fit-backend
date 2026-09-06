import { PlanDaySlot } from "@/utils/plan-schedule";
import { WeekConstraints, WeekPlanDay } from "@/utils/fanout-prompt-generator";

/**
 * [P1-a 2026-09-06] Deterministic cross-check of the planner's emitted week
 * against its OWN extracted weekday constraints.
 *
 * Prod forensics (user 3, 9/3): the planner extracted the constraints
 * perfectly — "Saturday (Day 3) must be Wendler 531 squat", "Monday (Day 4)
 * deadlift" — then emitted a plan that contradicted them (squat on Day 2 =
 * Friday, deadlift on Day 5 = Tuesday), the "lift/rest/lift" template instead
 * of the named days. The per-day calls faithfully built the wrong plan.
 * Nothing compared the plan to the constraints; this does.
 *
 * The check is deliberately LENIENT — it exists to catch content on the
 * flat-out wrong weekday, not to grade phrasing:
 * - Only `must` rules that mention at least one weekday are checked.
 * - A rule passes for a weekday when ANY of its content tokens appears in
 *   that weekday's day name/focus/styles. Generic scaffolding words are
 *   stopworded so they can't produce a free pass.
 * - Unschedulable weekdays (not in this week's slots) and rules with no
 *   usable content tokens are skipped.
 * A false alarm costs one planning retry; a miss is the status quo — so every
 * heuristic choice here biases toward passing.
 *
 * Day identity: `days[i]` corresponds to schedule slot `dayNumber === i + 1`,
 * matching the caller's post-loop renumbering (`day: index + 1`).
 */

export interface WeekdayComplianceViolation {
  /** The must rule that failed. */
  rule: string;
  /** The weekday the rule names. */
  weekday: string;
  /** 1-based day slot scheduled on that weekday. */
  dayNumber: number;
  /** The emitted day's name (what's there instead). */
  dayName: string;
}

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAYS.join("|")})s?\\b`, "gi");

// Scaffolding words common in constraint phrasing that say nothing about the
// day's CONTENT — without stopwording them, "must include ... as the strength
// block" would match almost any day. Content words (recovery, squat, wendler,
// metcon, cardio, ...) are deliberately NOT listed.
const STOPWORDS = new Set([
  "must",
  "include",
  "includes",
  "included",
  "including",
  "with",
  "that",
  "this",
  "then",
  "than",
  "them",
  "from",
  "into",
  "each",
  "every",
  "only",
  "also",
  "should",
  "shall",
  "will",
  "week",
  "weeks",
  "days",
  "workout",
  "workouts",
  "session",
  "sessions",
  "block",
  "blocks",
  "first",
  "second",
  "third",
  "followed",
  "following",
  "have",
  "does",
  "been",
  "being",
  "some",
  "somewhat",
  "might",
  "would",
  "could",
  "other",
  "between",
  "generate",
  "generated",
  "series",
  "starting",
  "today",
]);

/** Lowercased content tokens of a rule: length >= 4, no weekdays/stopwords. */
function contentTokens(rule: string): string[] {
  return (rule.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
    (token) =>
      !STOPWORDS.has(token) && !WEEKDAYS.includes(token as any)
  );
}

/** True when `token` (or its singular) appears in the haystack. */
function tokenMatches(token: string, haystack: string): boolean {
  if (haystack.includes(token)) return true;
  return token.endsWith("s") && haystack.includes(token.slice(0, -1));
}

export function checkWeekdayConstraintCompliance(
  weekPlan: { days: WeekPlanDay[]; constraints?: WeekConstraints },
  schedule: PlanDaySlot[]
): WeekdayComplianceViolation[] {
  const mustRules = weekPlan.constraints?.must ?? [];
  if (mustRules.length === 0) return [];

  const slotByWeekday = new Map(
    schedule.map((slot) => [slot.weekday.toLowerCase(), slot])
  );

  const violations: WeekdayComplianceViolation[] = [];

  for (const rule of mustRules) {
    const weekdayMentions = [
      ...new Set(
        [...rule.matchAll(WEEKDAY_RE)].map((m) => m[1].toLowerCase())
      ),
    ];
    if (weekdayMentions.length === 0) continue;

    const tokens = contentTokens(rule);
    if (tokens.length === 0) continue;

    for (const weekday of weekdayMentions) {
      const slot = slotByWeekday.get(weekday);
      if (!slot) continue; // weekday not scheduled this week — can't check

      const day = weekPlan.days[slot.dayNumber - 1];
      if (!day) continue; // short week — handled by the day-count check

      const haystack = `${day.name} ${day.focus} ${(day.styles || []).join(" ")}`.toLowerCase();
      const matched = tokens.some((token) => tokenMatches(token, haystack));
      if (!matched) {
        violations.push({
          rule,
          weekday,
          dayNumber: slot.dayNumber,
          dayName: day.name,
        });
      }
    }
  }

  return violations;
}
