/**
 * Plan context for the adjust-today (day regeneration) prompt.
 *
 * The daily prompt used to carry NOTHING about the plan's other days, so a
 * request like "replace today's workout with the one from this past Wednesday
 * that I couldn't do" was unanswerable — the model said it had no record of
 * Wednesday and invented a fresh session (prod, 2026-10-16). This module turns
 * the current plan's days into a compact, dated summary for the prompt, and
 * resolves which day a request refers to so that day's exercises can be
 * pinned onto the generation menu.
 *
 * Pure: no DB, no timezone math. Every weekday and "past/upcoming" judgement
 * is made against the ADJUSTED plan day's own date, never the server clock.
 */

export interface PlanContextExercise {
  name: string;
  sets: number | null;
  reps: number | null;
  repsMin: number | null;
  repsMax: number | null;
  weight: number | null;
  duration: number | null; // seconds
  distanceM: number | null;
}

export interface PlanContextBlock {
  name: string | null;
  type: string | null;
  rounds: number | null;
  timeCapMinutes: number | null;
  repScheme: number[] | null;
  exercises: PlanContextExercise[];
}

export interface PlanContextDay {
  planDayId: number;
  date: string; // YYYY-MM-DD
  name: string | null;
  isComplete: boolean;
  blocks: PlanContextBlock[];
}

export interface PlanContext {
  targetPlanDayId: number;
  targetDate: string;
  days: PlanContextDay[]; // date order, includes the target day
}

/**
 * What the daily-regeneration agent receives: the rendered summary for the
 * prompt, plus the referenced days' exercise names to pin on the menu.
 */
export interface DailyPromptPlanContext {
  summary: string;
  referencedExerciseNames: string[];
}

/** Loose shape of a plan_days row loaded `with: { blocks: { exercises: { exercise } } }`. */
export interface PlanDayRowLike {
  id: number;
  date: string;
  name: string | null;
  isComplete: boolean | null;
  blocks?: Array<{
    blockName: string | null;
    blockType: string | null;
    rounds: number | null;
    timeCapMinutes: number | null;
    protocolConfig?: { repScheme?: number[] | null } | null;
    exercises?: Array<{
      sets: number | null;
      reps: number | null;
      repsMin?: number | null;
      repsMax?: number | null;
      weight: number | null;
      duration: number | null;
      distanceM?: number | null;
      exercise: { name: string } | null;
    }>;
  }>;
}

// "This past Wednesday" is at most 7 days back and "last Wednesday" can reach
// 13; upcoming days matter less. The window also bounds the token cost if a
// plan ever spans more than a week.
const WINDOW_DAYS_BEFORE = 13;
const WINDOW_DAYS_AFTER = 6;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_FULL = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const toUtcMs = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number =>
  Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
const weekdayIndex = (date: string): number => new Date(toUtcMs(date)).getUTCDay();

/** "2026-10-14" → "Wed 2026-10-14" */
export function labelDate(date: string): string {
  return `${WEEKDAY_SHORT[weekdayIndex(date)]} ${date}`;
}

export function buildPlanContext(
  target: { id: number; date: string },
  rows: PlanDayRowLike[]
): PlanContext {
  const days = rows
    .filter((row) => {
      const offset = daysBetween(target.date, row.date);
      return (
        row.id === target.id ||
        (offset >= -WINDOW_DAYS_BEFORE && offset <= WINDOW_DAYS_AFTER)
      );
    })
    .map(
      (row): PlanContextDay => ({
        planDayId: row.id,
        date: row.date,
        name: row.name,
        isComplete: !!row.isComplete,
        blocks: (row.blocks ?? []).map((block) => ({
          name: block.blockName,
          type: block.blockType,
          rounds: block.rounds,
          timeCapMinutes: block.timeCapMinutes,
          repScheme: block.protocolConfig?.repScheme ?? null,
          exercises: (block.exercises ?? [])
            .filter((ex) => !!ex.exercise?.name)
            .map((ex) => ({
              name: ex.exercise!.name,
              sets: ex.sets,
              reps: ex.reps,
              repsMin: ex.repsMin ?? null,
              repsMax: ex.repsMax ?? null,
              weight: ex.weight,
              duration: ex.duration,
              distanceM: ex.distanceM ?? null,
            })),
        })),
      })
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.planDayId - b.planDayId);
  return { targetPlanDayId: target.id, targetDate: target.date, days };
}

const isTarget = (ctx: PlanContext, day: PlanContextDay) =>
  day.planDayId === ctx.targetPlanDayId;

const hasExercises = (day: PlanContextDay) =>
  day.blocks.some((b) => b.exercises.length > 0);

function dayStatus(ctx: PlanContext, day: PlanContextDay): string {
  if (isTarget(ctx, day)) return "THIS DAY (the current workout being replaced)";
  if (!hasExercises(day)) return "rest day";
  if (day.isComplete) return "done";
  return day.date < ctx.targetDate ? "MISSED" : "upcoming";
}

const formatSeconds = (s: number): string =>
  s >= 120 && s % 60 === 0 ? `${s / 60}min` : `${s}s`;

/** "4x8 @95", "3x45s", "400m", "8-12" — empty when nothing is prescribed. */
function formatPrescription(ex: PlanContextExercise): string {
  let amount = "";
  if (ex.repsMin && ex.repsMax) amount = `${ex.repsMin}-${ex.repsMax}`;
  else if (ex.reps && ex.reps > 0) amount = `${ex.reps}`;
  else if (ex.duration && ex.duration > 0) amount = formatSeconds(ex.duration);
  else if (ex.distanceM && ex.distanceM > 0) amount = `${ex.distanceM}m`;
  let out = amount && ex.sets && ex.sets > 1 ? `${ex.sets}x${amount}` : amount;
  if (ex.weight && ex.weight > 0) out += `${out ? " " : ""}@${ex.weight}`;
  return out;
}

function formatBlock(block: PlanContextBlock): string {
  const meta = [block.type || "block"];
  if (block.rounds && block.rounds > 1) meta.push(`${block.rounds} rounds`);
  if (block.repScheme?.length) meta.push(block.repScheme.join("-"));
  if (block.timeCapMinutes) meta.push(`${block.timeCapMinutes}min cap`);
  const exercises = block.exercises
    .map((ex) => {
      const rx = formatPrescription(ex);
      return rx ? `${ex.name} ${rx}` : ex.name;
    })
    .join("; ");
  return `${block.name || "Block"} [${meta.join(", ")}]: ${exercises}`;
}

/**
 * The compact plan summary the daily prompt carries. One header line per day
 * and one line per block — sized for a ~30k-token prompt (a 5-day plan is a
 * few hundred tokens).
 */
export function formatPlanContext(
  ctx: PlanContext,
  referenced: PlanContextDay[] = []
): string {
  const lines: string[] = [
    `THIS DAY (the day being adjusted): ${labelDate(ctx.targetDate)}.`,
    `Status: done = completed; MISSED = earlier date, never completed; upcoming = later date. Prescriptions: sets x reps, s = seconds, min = minutes, m = meters, @ = weight.`,
  ];
  if (referenced.length > 0) {
    lines.push(
      `Days the request mentions (resolved from its wording): ${referenced
        .map((d) => `${labelDate(d.date)} (${d.name || "unnamed"})`)
        .join(", ")}.`
    );
  }
  lines.push("");
  for (const day of ctx.days) {
    lines.push(
      `- ${labelDate(day.date)} · ${day.name || "Unnamed"} · ${dayStatus(ctx, day)}`
    );
    for (const block of day.blocks) {
      if (block.exercises.length > 0) lines.push(`  ${formatBlock(block)}`);
    }
  }
  return lines.join("\n");
}

// A day-referencing phrase, not just any negative ("I didn't sleep well" must
// not match): "missed workout", "the one I skipped", "the workout I was
// unable to do", "the session I couldn't finish".
const NOT_DONE = String.raw`(?:missed|skipped|(?:couldn'?t|could not|was unable to|wasn'?t able to|didn'?t|did not|never)\s+(?:do|did|finish|make|get to|got to))`;
const MISSED_RE = new RegExp(
  String.raw`\b(?:missed|skipped)\s+(?:workout|session|day)\b|\b(?:workout|session|one|day)\s+(?:that\s+)?i\s+${NOT_DONE}\b`,
  "i"
);
const FORWARD_RE = /\b(next|coming|upcoming)\b/i;
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;

/**
 * Which OTHER plan day(s) the request refers to, resolved against the target
 * day's date. Recognizes ISO dates, weekday names ("this past Wednesday" =
 * the most recent one before the target; "next Wednesday" = the first after
 * it), "yesterday"/"tomorrow", and — only when none of those appear — a
 * missed/skipped/couldn't-do phrase, which picks the most recent MISSED day.
 * Rest days are never returned: there is nothing to reproduce.
 */
export function findReferencedPlanDays(
  request: string | null | undefined,
  ctx: PlanContext
): PlanContextDay[] {
  const text = request?.toLowerCase() ?? "";
  if (!text.trim()) return [];
  const candidates = ctx.days.filter((d) => !isTarget(ctx, d) && hasExercises(d));
  if (candidates.length === 0) return [];

  const found: PlanContextDay[] = [];
  const add = (day: PlanContextDay | undefined) => {
    if (day && !found.includes(day)) found.push(day);
  };
  const onDate = (date: string) => candidates.find((d) => d.date === date);
  const offsetDate = (offset: number) =>
    new Date(toUtcMs(ctx.targetDate) + offset * DAY_MS).toISOString().slice(0, 10);

  for (const match of text.matchAll(ISO_DATE_RE)) add(onDate(match[1]));

  if (/\bday before yesterday\b/.test(text)) add(onDate(offsetDate(-2)));
  else if (/\byesterday\b/.test(text)) add(onDate(offsetDate(-1)));
  if (/\btomorrow\b/.test(text)) add(onDate(offsetDate(1)));

  const forward = FORWARD_RE.test(text);
  WEEKDAY_FULL.forEach((weekday, index) => {
    if (!new RegExp(`\\b${weekday}(?:'?s)?\\b`).test(text)) return;
    const sameWeekday = candidates.filter((d) => weekdayIndex(d.date) === index);
    const past = sameWeekday.filter((d) => d.date < ctx.targetDate);
    const future = sameWeekday.filter((d) => d.date > ctx.targetDate);
    add(forward ? future[0] ?? past[past.length - 1] : past[past.length - 1] ?? future[0]);
  });

  if (found.length === 0 && MISSED_RE.test(text)) {
    const missed = candidates.filter(
      (d) => !d.isComplete && d.date < ctx.targetDate
    );
    add(missed[missed.length - 1]);
  }
  return found;
}

/** Exercise names of the referenced days, deduped, in plan order. */
export function referencedExerciseNames(days: PlanContextDay[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const day of days) {
    for (const block of day.blocks) {
      for (const ex of block.exercises) {
        const key = ex.name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(ex.name);
      }
    }
  }
  return names;
}
