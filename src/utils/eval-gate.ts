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
 * CONFIRMATION (2026-09-22). Generation is stochastic, so a single run is a
 * sample, not a measurement. `muscle-balance-6day` is the worst case: its
 * muscleBalance check awards partial credit in thirds, so the scenario score can
 * only land on 67/78/89/100 — ~11pt steps — and three runs on an UNTOUCHED main
 * scored 67/100/89. Against a 15pt allowance and a reference that happens to
 * hold the top of that range, the gate fired on noise roughly half the time
 * (it red-flagged PR #112, which had not touched anything that scenario
 * exercises — it has no customFeedback at all).
 *
 * The fix is NOT a wider allowance: that would blind the gate to the very shape
 * it exists to catch (2026-09-07 — the mean barely moved while one scenario
 * collapsed). Instead a failing scenario is RE-RUN and judged on the median of
 * its samples. `mergeConfirmationRun` folds those extra samples in. Only a
 * suspected regression pays for the extra generations, so a passing PR costs
 * exactly what it did before.
 *
 * Pure and exported for tests; the CLI wrapper lives in scripts/eval-gate.ts.
 */

export interface EvalScenarioResult {
  id: string;
  category?: string;
  /** The score the gate judges. With samples present this is their median. */
  overall: number;
  /** Every score observed for this scenario; absent or length-1 for a single run. */
  samples?: number[];
  ok?: boolean;
}

/**
 * A cheap shape-of-the-catalog stamp, recorded on every run.
 *
 * Why: on 2026-09-22 the eval's Neon branch was three weeks behind prod and
 * simply did not contain the walking exercises. control-walking-beginner failed
 * "prescribes an actual walk" 3 for 3 — a perfectly reproducible signal that
 * looked exactly like a product bug and cost a full investigation. The model
 * cannot pick what isn't in the catalog. Stamping the catalog turns that into
 * one line at the top of the report.
 */
export interface CatalogFingerprint {
  exerciseCount: number;
  maxExerciseId: number;
}

export interface EvalRunFile {
  label?: string;
  ranAt?: string;
  /** Absent on runs captured before this was introduced — drift is then unknown. */
  catalog?: CatalogFingerprint;
  results: EvalScenarioResult[];
}

export type CatalogDriftKind = "behind" | "ahead" | "match" | "unknown";

export interface CatalogDrift {
  kind: CatalogDriftKind;
  current?: CatalogFingerprint;
  reference?: CatalogFingerprint;
  /** Human-readable, empty for "match" / "unknown". */
  message: string;
}

/**
 * Compare the catalog a run scored against with the one the reference was
 * captured against.
 *
 * "behind" is the dangerous direction — the eval database is missing exercises
 * the reference had, so scenarios can fail for want of an exercise rather than
 * for want of quality. "ahead" is the ordinary consequence of adding catalog
 * entries and only means the reference is due a re-capture.
 */
export function detectCatalogDrift(
  current: EvalRunFile,
  reference: EvalRunFile
): CatalogDrift {
  const cur = current.catalog;
  const ref = reference.catalog;
  if (!cur || !ref) {
    return {
      kind: "unknown",
      current: cur,
      reference: ref,
      message: "",
    };
  }
  const countDelta = cur.exerciseCount - ref.exerciseCount;
  const idDelta = cur.maxExerciseId - ref.maxExerciseId;

  if (countDelta < 0 || idDelta < 0) {
    return {
      kind: "behind",
      current: cur,
      reference: ref,
      message:
        `This run's catalog is BEHIND the reference's: ${cur.exerciseCount} exercises ` +
        `(max id ${cur.maxExerciseId}) vs ${ref.exerciseCount} (max id ${ref.maxExerciseId}). ` +
        "Scenarios can fail here because an exercise is missing, not because quality " +
        "regressed — reset the eval database branch from its parent before believing a failure.",
    };
  }
  if (countDelta > 0 || idDelta > 0) {
    return {
      kind: "ahead",
      current: cur,
      reference: ref,
      message:
        `Catalog has grown since the reference was captured: ${cur.exerciseCount} exercises ` +
        `(max id ${cur.maxExerciseId}) vs ${ref.exerciseCount} (max id ${ref.maxExerciseId}). ` +
        "Harmless, but the reference is due a re-capture.",
    };
  }
  return { kind: "match", current: cur, reference: ref, message: "" };
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
  /** All samples behind `current`, when the scenario was re-run to confirm. */
  samples?: number[];
}

export interface GateReport {
  passed: boolean;
  failures: GateFailure[];
  /** Whether this run's catalog matches the one the reference was captured on. */
  catalogDrift: CatalogDrift;
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

/**
 * Middle value, averaging the two middles on an even count. Median rather than
 * mean so one outlier run — a timeout, a model hiccup — can't drag a scenario
 * under the gate on its own.
 */
export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/** Every score behind a result: explicit samples, else the single overall. */
const samplesOf = (r: EvalScenarioResult): number[] =>
  r.samples && r.samples.length > 0 ? r.samples : [r.overall];

/**
 * Fold re-run samples into a base run. Scenarios absent from `confirmation` are
 * passed through untouched, so this is a no-op when nothing needed confirming.
 *
 * Both sides' samples are pooled — the original run is evidence too, so one
 * suspicious run plus two re-runs is judged on the median of three, not of two.
 */
export function mergeConfirmationRun(
  base: EvalRunFile,
  confirmation: EvalRunFile
): EvalRunFile {
  const extraById = new Map(confirmation.results.map((r) => [r.id, r]));
  return {
    ...base,
    results: base.results.map((result) => {
      const extra = extraById.get(result.id);
      if (!extra) return result;
      const samples = [...samplesOf(result), ...samplesOf(extra)];
      return { ...result, samples, overall: median(samples) };
    }),
  };
}

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
      samples: cur?.samples && cur.samples.length > 1 ? cur.samples : undefined,
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

  // Average over the scenarios this run actually COVERED, on both sides. Taking
  // the reference's mean over all 21 while the run covered 3 compares different
  // populations: a `--only` dispatch, or a run where the calendar-aligned
  // scenarios were skipped, then "regresses" by construction. Surfaced by a
  // single-scenario dispatch on 2026-09-22 that reported -16pt overall from one
  // scenario scoring 83%.
  const comparableIds = rows
    .filter((r) => r.current !== null && r.reference !== null)
    .map((r) => r.id);
  const comparable = new Set(comparableIds);
  const currentOverall = mean(
    current.results.filter((r) => comparable.has(r.id)).map((r) => r.overall)
  );
  const referenceOverall = mean(
    reference.results.filter((r) => comparable.has(r.id)).map((r) => r.overall)
  );
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
    catalogDrift: detectCatalogDrift(current, reference),
    rows,
    notRun: rows.filter((r) => r.current === null).map((r) => r.id),
    unreferenced: rows.filter((r) => r.reference === null).map((r) => r.id),
    currentOverall,
    referenceOverall,
    overallDeltaPt,
  };
}

/**
 * Which scenarios are worth re-running before believing a red verdict.
 *
 * Scenario-level failures name themselves. An overall-only regression names no
 * scenario, so fall back to the biggest droppers — that is where a real mean
 * regression lives, and re-running them is what distinguishes it from a few
 * scenarios all sampling low at once.
 *
 * Returns [] for a passing report: nothing to confirm, nothing to pay for.
 */
export function scenariosToConfirm(report: GateReport, limit = 3): string[] {
  if (report.passed) return [];
  const ids = report.failures
    .map((f) => f.scenarioId)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    // Overall-only regression: take the worst actually-run droppers.
    const worst = report.rows
      .filter((r) => r.current !== null && r.deltaPt !== null)
      .sort((a, b) => (a.deltaPt ?? 0) - (b.deltaPt ?? 0))
      .slice(0, limit)
      .map((r) => r.id);
    return worst;
  }
  return [...new Set(ids)];
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
  ];

  // Catalog drift goes ABOVE the numbers, not in a footnote — when the eval
  // database is behind, it is the first thing that explains a red run, and a
  // note further down is exactly what got missed on 2026-09-22.
  if (report.catalogDrift.kind === "behind") {
    lines.push(`> ⚠️ **Stale eval database.** ${report.catalogDrift.message}`, "");
  }

  lines.push(
    `**${label}**: overall ${pt(report.currentOverall)}% vs reference ${pt(report.referenceOverall)}% (${delta(report.overallDeltaPt)})`,
    ""
  );

  if (!report.passed) {
    lines.push("### What failed", "");
    for (const failure of report.failures) lines.push(`- ${failure.message}`);
    if (report.catalogDrift.kind === "behind") {
      lines.push(
        "",
        "_Check the stale-database warning above before treating any of these as a code regression._"
      );
    }
    lines.push("");
  }

  const confirmed = report.rows.some((r) => r.samples);
  lines.push(
    confirmed
      ? "| scenario | reference | this run | change | samples |"
      : "| scenario | reference | this run | change |",
    confirmed ? "| --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- |"
  );
  for (const row of [...report.rows].sort(
    (a, b) => (a.deltaPt ?? 0) - (b.deltaPt ?? 0) || a.id.localeCompare(b.id)
  )) {
    const base = `| ${row.id} | ${cell(row.reference)} | ${cell(row.current)} | ${delta(row.deltaPt)} |`;
    if (!confirmed) {
      lines.push(base);
      continue;
    }
    // "median of 67/89/89" makes it obvious when a verdict rests on a re-run.
    const samples = row.samples
      ? `median of ${row.samples.map((v) => `${pt(v)}%`).join("/")}`
      : "–";
    lines.push(`${base} ${samples} |`);
  }

  if (report.notRun.length > 0) {
    lines.push("", `_Not run (no failure): ${report.notRun.join(", ")}._`);
  }
  if (report.unreferenced.length > 0) {
    lines.push("", `_New since the reference: ${report.unreferenced.join(", ")}._`);
  }
  if (report.catalogDrift.kind === "ahead") {
    lines.push("", `_${report.catalogDrift.message}_`);
  }
  return lines.join("\n");
}
