/**
 * [GQ-13] Offline generation-quality eval harness.
 *
 * Replays a fixed set of representative override scenarios (see
 * eval-scenarios.ts) through the REAL fan-out generation path and scores the
 * output with automated compliance checks (exclusions, equipment rules, format
 * asks, duration, day-scoped calendar asks). It is the regression gate for every
 * prompt/schema change in the generation-quality backlog: run it before a change
 * to capture a baseline, run it again after, and compare the deltas.
 *
 * This calls the live Anthropic API (Haiku fan-out) against the LOCAL exercise
 * catalog — it costs tokens but writes no workout data (generation results are
 * scored in-memory and discarded; only a compact score summary is written to
 * eval-runs/<label>.json). Scenarios fan out concurrently (bounded) so a full
 * run is minutes, not scenario-count × ~30s.
 *
 * Usage:
 *   npm run eval-generation -- --label baseline
 *   npm run eval-generation -- --label after --compare baseline
 *   npm run eval-generation -- --label smoke --only exclude-burpees --concurrency 1
 *   npm run eval-generation -- --label confirm --only muscle-balance-6day --repeat 2
 *
 * --repeat N runs each selected scenario N times and reports the MEDIAN, keeping
 * every sample. Generation is stochastic — muscle-balance-6day scored 67/100/89
 * across three runs on an untouched main — so a single number is a sample, not a
 * measurement. Used by the eval workflow to confirm a suspected regression
 * before failing a PR on it.
 */
import fs from "fs";
import path from "path";
import { WorkoutAgentService } from "@/services/workout-agent.service";
import { exerciseService } from "@/services/exercise.service";
import {
  getCurrentDateString,
  getCurrentDateStringInTimezone,
} from "@/utils/date.utils";
import {
  buildPlanDaySchedule,
  buildCalendarAlignedSchedule,
  computeAdjacentDayPairs,
} from "@/utils/plan-schedule";
import {
  computeDayMuscleLoad,
  findConsecutiveMuscleOverlap,
} from "@/utils/muscle-load";
import { normalizeMuscleGroups } from "@/constants/muscle-groups";
import {
  scoreWorkout,
  ExerciseMeta,
  ScoredWorkout,
  CheckResult,
} from "@/utils/generation-compliance";
import { SCENARIOS, EvalScenario } from "./eval-scenarios";

const EVAL_USER_ID = Number(process.env.EVAL_USER_ID || 1);
const OUT_DIR = path.join(process.cwd(), "eval-runs");

interface ScenarioResult {
  id: string;
  category: string;
  description: string;
  ok: boolean;
  error?: string;
  overall: number; // 0..1 — the median when repeated
  /** Every score observed, in run order. Only written when --repeat > 1. */
  samples?: number[];
  durationMs: number;
  checks: CheckResult[];
}

const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Collapse repeated runs of one scenario into a single result: median score,
 * every sample kept, and the CHECKS from the run that actually scored the
 * median — so the printed detail describes a real generation rather than an
 * average that never happened.
 */
function collapseRepeats(runs: ScenarioResult[]): ScenarioResult {
  if (runs.length === 1) return runs[0];
  const samples = runs.map((r) => r.overall);
  const med = medianOf(samples);
  const representative =
    [...runs].sort(
      (a, b) => Math.abs(a.overall - med) - Math.abs(b.overall - med)
    )[0] ?? runs[0];
  return {
    ...representative,
    overall: med,
    samples,
    // Total wall-clock across the repeats, so the cost stays visible.
    durationMs: runs.reduce((sum, r) => sum + r.durationMs, 0),
    ok: runs.every((r) => r.ok),
  };
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = val;
    }
  }
  return args;
}

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildExerciseMeta(
  workout: ScoredWorkout,
  exercisesToAdd: Array<{ name?: string; equipment?: string[]; muscleGroups?: string[] }>
): Promise<Map<string, ExerciseMeta>> {
  const names = new Set<string>();
  for (const day of workout.workoutPlan || []) {
    for (const block of day.blocks || []) {
      for (const ex of block.exercises || []) {
        if (ex.exerciseName) names.add(ex.exerciseName);
      }
    }
  }
  const meta = new Map<string, ExerciseMeta>();
  if (names.size > 0) {
    const dbExercises = await exerciseService.getExercisesByNames([...names]);
    for (const e of dbExercises) {
      meta.set(e.name.trim().toLowerCase(), {
        equipment: Array.isArray(e.equipment) ? (e.equipment as string[]) : [],
        muscleGroups: Array.isArray(e.muscleGroups) ? (e.muscleGroups as string[]) : [],
      });
    }
  }
  // Model-invented exercises carry their own equipment inline — merge them so
  // the "bodyweight-only day" scorer sees them (they won't be in the DB).
  for (const added of exercisesToAdd || []) {
    if (!added?.name) continue;
    meta.set(added.name.trim().toLowerCase(), {
      equipment: Array.isArray(added.equipment) ? added.equipment : [],
      muscleGroups: Array.isArray(added.muscleGroups) ? added.muscleGroups : [],
    });
  }
  return meta;
}

function scoreSchedule(
  expect: EvalScenario["expectSchedule"],
  schedule: Array<{ dayNumber: number; weekday: string; date: string }>,
  workout: ScoredWorkout
): CheckResult[] {
  if (!expect) return [];
  const out: CheckResult[] = [];
  const weekdays = schedule.map((s) => s.weekday);
  if (expect.dayCount != null) {
    const planDays = (workout.workoutPlan || []).length;
    const passed = schedule.length === expect.dayCount && planDays === expect.dayCount;
    out.push({
      id: "sched-daycount",
      label: `${expect.dayCount} workout days`,
      type: "schedule",
      score: passed ? 1 : 0,
      passed,
      detail: `schedule=${schedule.length}, plan=${planDays}, want ${expect.dayCount}`,
    });
  }
  if (expect.weekdays) {
    const want = new Set(expect.weekdays.map((w) => w.toLowerCase()));
    const got = new Set(weekdays);
    const passed = want.size === got.size && [...want].every((w) => got.has(w));
    out.push({
      id: "sched-weekdays",
      label: `days = ${expect.weekdays.join("/")}`,
      type: "schedule",
      score: passed ? 1 : 0,
      passed,
      detail: `got ${weekdays.join("/") || "(none)"}`,
    });
  }
  if (expect.firstWeekday) {
    const passed = weekdays[0] === expect.firstWeekday.toLowerCase();
    out.push({
      id: "sched-first",
      label: `starts on ${expect.firstWeekday}`,
      type: "schedule",
      score: passed ? 1 : 0,
      passed,
      detail: `first = ${weekdays[0] || "(none)"}`,
    });
  }
  return out;
}

function scoreMuscleBalance(
  workout: ScoredWorkout,
  meta: Map<string, { equipment: string[]; muscleGroups: string[] }>,
  schedule: Array<{ dayNumber: number; weekday: string; date: string }>
): CheckResult[] {
  // Canonical muscle map for the load model.
  const muscleByExercise = new Map<string, string[]>();
  for (const [name, m] of meta) {
    muscleByExercise.set(name, normalizeMuscleGroups(m.muscleGroups).groups);
  }
  const adjacency = computeAdjacentDayPairs(schedule as any);
  const loads = (workout.workoutPlan || []).map((d) =>
    computeDayMuscleLoad(d, muscleByExercise)
  );
  const overlaps = findConsecutiveMuscleOverlap(loads, adjacency);
  const score = Math.max(0, 1 - overlaps.length / 3);
  return [
    {
      id: "muscle-overlap",
      label: "no consecutive-day muscle overload",
      type: "muscleBalance",
      score,
      passed: overlaps.length === 0,
      detail:
        overlaps.length === 0
          ? "no muscle heavily loaded on back-to-back days"
          : overlaps
              .map((o) => `${o.muscle} d${o.firstDay}+d${o.secondDay}`)
              .join(", "),
    },
  ];
}

async function runScenario(scenario: EvalScenario): Promise<ScenarioResult> {
  const { profile } = scenario;
  // [Calendar-aligned series] A scenario may pin its start date so the window
  // shape doesn't depend on the run day; the check schedule mirrors the same
  // builder the agent will use under the flag.
  const startDate =
    scenario.startDate ??
    (profile.timezone
      ? getCurrentDateStringInTimezone(profile.timezone)
      : getCurrentDateString());
  const schedule =
    process.env.CALENDAR_ALIGNED_SERIES === "true"
      ? buildCalendarAlignedSchedule(profile.availableDays, startDate)
      : buildPlanDaySchedule(profile.availableDays, startDate);
  const checks = scenario.buildChecks(schedule, profile);

  const startedAt = Date.now();
  try {
    const agent = WorkoutAgentService.createForUser(profile);
    const result = await agent.generateWeeklyWorkout(
      EVAL_USER_ID,
      profile,
      scenario.customFeedback,
      { scheduleStartDate: startDate }
    );
    const durationMs = Date.now() - startedAt;
    const workout = result.workout as unknown as ScoredWorkout;
    const meta = await buildExerciseMeta(
      workout,
      (result.workout as any).exercisesToAdd || []
    );
    const scored = scoreWorkout(workout, meta, checks);
    // [GQ-02] Score the RETURNED schedule (reflects the scheduling override)
    // against the scenario's expectations, as extra checks.
    const scheduleChecks = scoreSchedule(
      scenario.expectSchedule,
      (result as any).schedule || [],
      workout
    );
    const muscleChecks = scenario.checkMuscleBalance
      ? scoreMuscleBalance(workout, meta, schedule)
      : [];
    const allChecks = [...scored.results, ...scheduleChecks, ...muscleChecks];
    const overall = allChecks.length
      ? allChecks.reduce((s, c) => s + c.score, 0) / allChecks.length
      : 0;
    return {
      id: scenario.id,
      category: scenario.category,
      description: scenario.description,
      ok: true,
      overall,
      durationMs,
      checks: allChecks,
    };
  } catch (error) {
    return {
      id: scenario.id,
      category: scenario.category,
      description: scenario.description,
      ok: false,
      error: (error as Error).message,
      overall: 0,
      durationMs: Date.now() - startedAt,
      checks: checks.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
        score: 0,
        passed: false,
        detail: "generation failed",
      })),
    };
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function printReport(label: string, results: ScenarioResult[]) {
  console.log(`\n${"=".repeat(72)}\nEVAL RUN: ${label}\n${"=".repeat(72)}`);
  for (const r of results) {
    const status = r.ok ? "" : " [GENERATION FAILED]";
    const spread = r.samples
      ? ` (median of ${r.samples.map(pct).join("/")})`
      : "";
    console.log(`\n▸ ${r.id} (${r.category}) — ${pct(r.overall)}${spread}${status}`);
    console.log(`  ${r.description}  [${(r.durationMs / 1000).toFixed(1)}s]`);
    if (r.error) console.log(`  ERROR: ${r.error}`);
    for (const c of r.checks) {
      console.log(`  ${c.passed ? "✓" : "✗"} ${c.label}: ${pct(c.score)} — ${c.detail}`);
    }
  }
  const overall = results.reduce((s, r) => s + r.overall, 0) / (results.length || 1);
  const byCategory = new Map<string, number[]>();
  for (const r of results) {
    const arr = byCategory.get(r.category) || [];
    arr.push(r.overall);
    byCategory.set(r.category, arr);
  }
  console.log(`\n${"-".repeat(72)}\nSUMMARY (${label})`);
  for (const [cat, scores] of [...byCategory].sort()) {
    const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
    console.log(`  ${cat.padEnd(12)} ${pct(avg)}  (${scores.length} scenarios)`);
  }
  console.log(`  ${"OVERALL".padEnd(12)} ${pct(overall)}  (${results.length} scenarios)`);
  console.log("-".repeat(72));
}

function printComparison(baseline: ScenarioResult[], current: ScenarioResult[]) {
  const baseById = new Map(baseline.map((r) => [r.id, r]));
  console.log(`\n${"=".repeat(72)}\nCOMPARISON vs baseline (▲ improved, ▼ regressed)\n${"=".repeat(72)}`);
  for (const cur of current) {
    const base = baseById.get(cur.id);
    if (!base) {
      console.log(`  ${cur.id.padEnd(34)} ${pct(cur.overall)}  (new)`);
      continue;
    }
    const delta = cur.overall - base.overall;
    const arrow = delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "=";
    const sign = delta >= 0 ? "+" : "";
    console.log(
      `  ${arrow} ${cur.id.padEnd(34)} ${pct(base.overall)} → ${pct(cur.overall)}  (${sign}${Math.round(delta * 100)}pt)`
    );
  }
  const baseOverall = baseline.reduce((s, r) => s + r.overall, 0) / (baseline.length || 1);
  const curOverall = current.reduce((s, r) => s + r.overall, 0) / (current.length || 1);
  const d = curOverall - baseOverall;
  console.log("-".repeat(72));
  console.log(
    `  OVERALL ${pct(baseOverall)} → ${pct(curOverall)}  (${d >= 0 ? "+" : ""}${Math.round(d * 100)}pt)`
  );
  console.log("=".repeat(72));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const label = args.label || "run";
  const concurrency = Number(args.concurrency || 3);
  const only = args.only ? new Set(args.only.split(",")) : null;
  const repeat = Math.max(1, Number(args.repeat || 1));

  // [Calendar-aligned series] Alignment scenarios are only meaningful with the
  // flag on — their expected day counts assume the calendar window.
  const eligible = SCENARIOS.filter(
    (s) =>
      !s.requiresCalendarAlignment ||
      process.env.CALENDAR_ALIGNED_SERIES === "true"
  );
  const scenarios = only ? eligible.filter((s) => only.has(s.id)) : eligible;
  if (scenarios.length === 0) {
    console.error("No scenarios matched --only filter.");
    process.exit(1);
  }

  console.log(
    `Running ${scenarios.length} scenario(s)${
      repeat > 1 ? ` × ${repeat} repeats (median scored)` : ""
    } at concurrency ${concurrency} (eval user ${EVAL_USER_ID}, local catalog)...`
  );

  // Flatten scenario × repeat into one task list so concurrency still applies
  // across repeats — 3 repeats of 1 scenario parallelise like 3 scenarios do.
  const tasks = scenarios.flatMap((s) =>
    Array.from({ length: repeat }, (_, attempt) => ({ scenario: s, attempt }))
  );

  const runs = await pool(tasks, concurrency, async ({ scenario, attempt }) => {
    const tag = repeat > 1 ? `${scenario.id} (${attempt + 1}/${repeat})` : scenario.id;
    console.log(`  … ${tag}`);
    const r = await runScenario(scenario);
    console.log(`  ${r.ok ? "done" : "FAIL"} ${tag} — ${pct(r.overall)} (${(r.durationMs / 1000).toFixed(1)}s)`);
    return r;
  });

  // Group back by scenario, preserving the order of `scenarios`.
  const results = scenarios.map((s) =>
    collapseRepeats(runs.filter((r) => r.id === s.id))
  );

  printReport(label, results);

  // Persist a compact summary (no full workout bodies) for CP-1 evidence + diffs.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${label}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ label, ranAt: new Date().toISOString(), results }, null, 2)
  );
  console.log(`\nSaved summary → ${outPath}`);

  if (args.compare) {
    const basePath = path.join(OUT_DIR, `${args.compare}.json`);
    if (!fs.existsSync(basePath)) {
      console.warn(`\nBaseline "${args.compare}" not found at ${basePath}; skipping comparison.`);
    } else {
      const baseline = JSON.parse(fs.readFileSync(basePath, "utf-8")).results as ScenarioResult[];
      printComparison(baseline, results);
    }
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
