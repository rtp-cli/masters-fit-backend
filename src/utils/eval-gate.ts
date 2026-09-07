/**
 * Pass/fail gate for a generation-eval run.
 *
 * [GQ-13] gave us `npm run eval-generation` — 20 scored scenarios through the
 * real fan-out path — but nothing consumed its output automatically: the
 * harness prints a report and always exits 0, so a generation regression was
 * only ever caught by a human noticing a bad week. That is how the
 * 2026-09-07 Wendler/calisthenics failures reached production (named movements
 * substituted, set ladders truncated, loads invented) — every one of them
 * scored 0-40% on scenarios that now exist.
 *
 * This turns a run into a verdict by comparing it against a committed
 * reference (eval-baseline/reference.json):
 *   - any scenario below `scenarioFloor` fails, even if the reference was also
 *     low — a scenario scoring under 60% is not "expected", it's broken;
 *   - any scenario dropping more than `maxScenarioDropPt` from the reference
 *     fails, which is what catches "this prompt change helped X and broke Y";
 *   - the mean across scenarios may not drop more than `maxOverallDropPt`.
 * Scenarios missing from the run (e.g. the calendar-alignment ones, which need
 * CALENDAR_ALIGNED_SERIES=true) are reported, never failed — a skipped
 * scenario is a coverage gap, not a regression.
 *
 * Pure and exported for tests; the CLI wrapper lives in scripts/eval-gate.ts.
 */

export interface EvalScenarioResult {
  id: string;
  category?: string;
  overall: number;
  ok?: boolean;
}

export interface EvalRunFile {
  label?: string;
  ranAt?: string;
  results: EvalScenarioResult[];
}

export interface GateThresholds {
  /** A scenario scoring below this fails outright (0..1). */
  scenarioFloor: number;
  /** Percentage points a single scenario may fall below the reference. */
  maxScenarioDropPt: number;
  /** Percentage points the mean may fall below the reference. */
  maxOverallDropPt: number;
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  scenarioFloor: 0.6,
  maxScenarioDropPt: 15,
  maxOverallDropPt: 5,
};

export type GateFailureKind = "below-floor" | "scenario-regression" | "overall-regression";

export interface GateFailure {
  kind: GateFailureKind;
  /** Absent for the overall check. */
  scenarioId?: string;
  message: string;
}

export interface GateScenarioRow {
  id: string;
  category?: string;
  reference: number | null;
  current: number | null;
  /** current - reference, in percentage points; null when either side is missing. */
  deltaPt: number | null;
}

export interface GateReport {
  passed: boolean;
  failures: GateFailure[];
  rows: GateScenarioRow[];
  /** Scenario ids in the reference that this run did not cover. */
  notRun: string[];
  /** Scenario ids in this run with no reference to compare against. */
  unreferenced: string[];
  currentOverall: number;
  referenceOverall: number;
  overallDeltaPt: number;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

const pt = (value: number): number => Math.round(value * 100);

export function evaluateEvalGate(
  current: EvalRunFile,
  reference: EvalRunFile,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS
): GateReport {
  const currentById = new Map(current.results.map((r) => [r.id, r]));
  const referenceById = new Map(reference.results.map((r) => [r.id, r]));

  const ids = [
    ...reference.results.map((r) => r.id),
    ...current.results.map((r) => r.id).filter((id) => !referenceById.has(id)),
  ];

  const rows: GateScenarioRow[] = ids.map((id) => {
    const cur = currentById.get(id);
    const ref = referenceById.get(id);
    return {
      id,
      category: cur?.category ?? ref?.category,
      reference: ref ? ref.overall : null,
      current: cur ? cur.overall : null,
      deltaPt: cur && ref ? pt(cur.overall) - pt(ref.overall) : null,
    };
  });

  const failures: GateFailure[] = [];
  for (const row of rows) {
    if (row.current === null) continue; // not run — reported below, never failed
    if (row.current < thresholds.scenarioFloor) {
      failures.push({
        kind: "below-floor",
        scenarioId: row.id,
        message: `${row.id} scored ${pt(row.current)}%, below the ${pt(thresholds.scenarioFloor)}% floor`,
      });
      continue; // one failure per scenario is enough signal
    }
    if (row.deltaPt !== null && row.deltaPt < -thresholds.maxScenarioDropPt) {
      failures.push({
        kind: "scenario-regression",
        scenarioId: row.id,
        message: `${row.id} fell ${Math.abs(row.deltaPt)}pt (${pt(row.reference!)}% → ${pt(row.current)}%), more than the ${thresholds.maxScenarioDropPt}pt allowance`,
      });
    }
  }

  const currentOverall = mean(current.results.map((r) => r.overall));
  const referenceOverall = mean(reference.results.map((r) => r.overall));
  const overallDeltaPt = pt(currentOverall) - pt(referenceOverall);
  if (overallDeltaPt < -thresholds.maxOverallDropPt) {
    failures.push({
      kind: "overall-regression",
      message: `overall fell ${Math.abs(overallDeltaPt)}pt (${pt(referenceOverall)}% → ${pt(currentOverall)}%), more than the ${thresholds.maxOverallDropPt}pt allowance`,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    rows,
    notRun: rows.filter((r) => r.current === null).map((r) => r.id),
    unreferenced: rows.filter((r) => r.reference === null).map((r) => r.id),
    currentOverall,
    referenceOverall,
    overallDeltaPt,
  };
}

/** GitHub-flavoured markdown for the workflow's job summary. */
export function renderGateSummary(report: GateReport, label = "run"): string {
  const cell = (value: number | null) => (value === null ? "–" : `${pt(value)}%`);
  const delta = (value: number | null) => {
    if (value === null) return "–";
    if (value === 0) return "±0";
    return `${value > 0 ? "▲ +" : "▼ "}${value}pt`;
  };

  const lines: string[] = [
    `## Generation eval — ${report.passed ? "✅ pass" : "❌ regression"}`,
    "",
    `**${label}**: overall ${pt(report.currentOverall)}% vs reference ${pt(report.referenceOverall)}% (${delta(report.overallDeltaPt)})`,
    "",
  ];

  if (!report.passed) {
    lines.push("### What failed", "");
    for (const failure of report.failures) lines.push(`- ${failure.message}`);
    lines.push("");
  }

  lines.push("| scenario | reference | this run | change |", "| --- | --- | --- | --- |");
  for (const row of [...report.rows].sort(
    (a, b) => (a.deltaPt ?? 0) - (b.deltaPt ?? 0) || a.id.localeCompare(b.id)
  )) {
    lines.push(`| ${row.id} | ${cell(row.reference)} | ${cell(row.current)} | ${delta(row.deltaPt)} |`);
  }

  if (report.notRun.length > 0) {
    lines.push("", `_Not run (no failure): ${report.notRun.join(", ")}._`);
  }
  if (report.unreferenced.length > 0) {
    lines.push("", `_New since the reference: ${report.unreferenced.join(", ")}._`);
  }
  return lines.join("\n");
}
