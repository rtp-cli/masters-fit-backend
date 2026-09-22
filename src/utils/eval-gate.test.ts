import { describe, it, expect } from "@jest/globals";
import {
  evaluateEvalGate,
  median,
  mergeConfirmationRun,
  renderGateSummary,
  scenariosToConfirm,
  DEFAULT_GATE_THRESHOLDS,
  type EvalRunFile,
} from "@/utils/eval-gate";

const run = (entries: Array<[string, number]>): EvalRunFile => ({
  results: entries.map(([id, overall]) => ({ id, overall, category: "program" })),
});

const REFERENCE = run([
  ["control-strength-gym", 1],
  ["program-wendler-week", 1],
  ["program-calisthenics-rft", 1],
  ["muscle-balance-6day", 0.78],
]);

describe("evaluateEvalGate", () => {
  it("passes an identical run", () => {
    const report = evaluateEvalGate(REFERENCE, REFERENCE);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.overallDeltaPt).toBe(0);
  });

  it("passes small wobble within the allowances", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 0.91],
        ["program-calisthenics-rft", 1],
        ["muscle-balance-6day", 0.78],
      ]),
      REFERENCE
    );
    expect(report.passed).toBe(true);
  });

  it("fails a single scenario that falls off a cliff, even when the mean holds", () => {
    // This is the 2026-09-07 shape: calisthenics collapses, everything else fine.
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 0.11],
        ["muscle-balance-6day", 0.78],
      ]),
      REFERENCE
    );
    expect(report.passed).toBe(false);
    expect(report.failures.map((f) => f.kind)).toContain("below-floor");
    expect(report.failures[0].scenarioId).toBe("program-calisthenics-rft");
  });

  it("fails a drop bigger than the per-scenario allowance", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 0.8],
        ["program-calisthenics-rft", 0.8],
        ["muscle-balance-6day", 0.78],
      ]),
      REFERENCE
    );
    expect(report.passed).toBe(false);
    // Two 20pt scenario drops also pull the mean down past its allowance, so
    // the report names all three reasons rather than stopping at the first.
    expect(report.failures.map((f) => f.kind)).toEqual([
      "scenario-regression",
      "scenario-regression",
      "overall-regression",
    ]);
    expect(report.failures.map((f) => f.scenarioId)).toEqual([
      "program-wendler-week",
      "program-calisthenics-rft",
      undefined,
    ]);
  });

  it("fails an across-the-board slide even when no single scenario trips", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 0.9],
        ["program-wendler-week", 0.9],
        ["program-calisthenics-rft", 0.9],
        ["muscle-balance-6day", 0.7],
      ]),
      REFERENCE
    );
    expect(report.passed).toBe(false);
    expect(report.failures.map((f) => f.kind)).toEqual(["overall-regression"]);
  });

  it("never fails a scenario the run skipped (coverage gap, not regression)", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 1],
      ]),
      REFERENCE
    );
    expect(report.passed).toBe(true);
    expect(report.notRun).toEqual(["muscle-balance-6day"]);
  });

  it("holds a new scenario to the floor even with no reference", () => {
    const withNew = run([
      ["control-strength-gym", 1],
      ["program-wendler-week", 1],
      ["program-calisthenics-rft", 1],
      ["muscle-balance-6day", 0.78],
      ["program-brand-new", 0.2],
    ]);
    const report = evaluateEvalGate(withNew, REFERENCE);
    expect(report.unreferenced).toEqual(["program-brand-new"]);
    expect(report.passed).toBe(false);
    expect(report.failures[0].kind).toBe("below-floor");
  });

  it("keeps a scenario the reference itself scored low honest", () => {
    // The reference's 78% muscle-balance scenario may drift down 15pt at most,
    // and can still never go under the floor.
    const slipped = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 1],
        ["muscle-balance-6day", 0.55],
      ]),
      REFERENCE
    );
    expect(slipped.passed).toBe(false);
    expect(slipped.failures[0].kind).toBe("below-floor");
  });

  it("exposes the thresholds it used", () => {
    expect(DEFAULT_GATE_THRESHOLDS).toEqual({
      scenarioFloor: 0.6,
      maxScenarioDropPt: 15,
      maxOverallDropPt: 5,
    });
  });
});

describe("renderGateSummary", () => {
  it("leads with the verdict and lists the failures worst-first", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 0.11],
        ["muscle-balance-6day", 0.78],
      ]),
      REFERENCE
    );
    const md = renderGateSummary(report, "weekly-2026-09-14");
    expect(md).toContain("❌ regression");
    expect(md).toContain("weekly-2026-09-14");
    expect(md).toContain("below the 60% floor");
    // Worst delta first in the table.
    const firstRow = md.split("| --- | --- | --- | --- |")[1].trim().split("\n")[0];
    expect(firstRow).toContain("program-calisthenics-rft");
  });

  it("says pass plainly when nothing regressed", () => {
    const md = renderGateSummary(evaluateEvalGate(REFERENCE, REFERENCE));
    expect(md).toContain("✅ pass");
    expect(md).not.toContain("What failed");
  });
});

describe("median", () => {
  it("takes the middle of an odd count", () => {
    expect(median([0.67, 1, 0.89])).toBeCloseTo(0.89);
  });

  it("averages the two middles of an even count", () => {
    expect(median([0.6, 0.8])).toBeCloseTo(0.7);
  });

  it("is unmoved by a single outlier", () => {
    // One timed-out run must not drag the scenario under the floor.
    expect(median([0.9, 0.92, 0])).toBeCloseTo(0.9);
  });

  it("is 0 for no samples", () => {
    expect(median([])).toBe(0);
  });
});

describe("mergeConfirmationRun", () => {
  it("pools the base sample with the re-runs and scores the median", () => {
    // The real 2026-09-22 case: one unlucky 67% run, two re-runs at 89% and
    // 100%. Median 89% is inside the 15pt allowance against a 100% reference.
    const base = run([
      ["control-strength-gym", 1],
      ["muscle-balance-6day", 0.67],
    ]);
    const confirmation: EvalRunFile = {
      results: [{ id: "muscle-balance-6day", overall: 0.89, samples: [0.89, 1] }],
    };

    const merged = mergeConfirmationRun(base, confirmation);
    const row = merged.results.find((r) => r.id === "muscle-balance-6day")!;
    expect(row.samples).toEqual([0.67, 0.89, 1]);
    expect(row.overall).toBeCloseTo(0.89);
  });

  it("leaves scenarios that were not re-run untouched", () => {
    const base = run([
      ["control-strength-gym", 1],
      ["muscle-balance-6day", 0.67],
    ]);
    const merged = mergeConfirmationRun(base, {
      results: [{ id: "muscle-balance-6day", overall: 1 }],
    });
    const untouched = merged.results.find((r) => r.id === "control-strength-gym")!;
    expect(untouched.overall).toBe(1);
    expect(untouched.samples).toBeUndefined();
  });

  it("is a no-op when nothing was confirmed", () => {
    const base = run([["control-strength-gym", 1]]);
    expect(mergeConfirmationRun(base, { results: [] })).toEqual(base);
  });

  it("turns the noise-driven red verdict green without touching the allowance", () => {
    const noisy = run([
      ["control-strength-gym", 1],
      ["program-wendler-week", 1],
      ["program-calisthenics-rft", 1],
      ["muscle-balance-6day", 0.44],
    ]);
    expect(evaluateEvalGate(noisy, REFERENCE).passed).toBe(false);

    const confirmed = mergeConfirmationRun(noisy, {
      results: [{ id: "muscle-balance-6day", overall: 0.78, samples: [0.78, 0.89] }],
    });
    expect(evaluateEvalGate(confirmed, REFERENCE).passed).toBe(true);
  });

  it("still fails a REAL regression that reproduces across re-runs", () => {
    // The whole point: confirmation must not launder a genuine collapse.
    const regressed = run([
      ["control-strength-gym", 1],
      ["program-wendler-week", 1],
      ["program-calisthenics-rft", 0.2],
      ["muscle-balance-6day", 0.78],
    ]);
    const confirmed = mergeConfirmationRun(regressed, {
      results: [{ id: "program-calisthenics-rft", overall: 0.22, samples: [0.22, 0.18] }],
    });
    const report = evaluateEvalGate(confirmed, REFERENCE);
    expect(report.passed).toBe(false);
    expect(report.failures[0].scenarioId).toBe("program-calisthenics-rft");
  });
});

describe("scenariosToConfirm", () => {
  it("is empty for a passing report — a green PR pays for no extra runs", () => {
    expect(scenariosToConfirm(evaluateEvalGate(REFERENCE, REFERENCE))).toEqual([]);
  });

  it("names the failing scenarios", () => {
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 0.2],
        ["muscle-balance-6day", 0.44],
      ]),
      REFERENCE
    );
    expect(scenariosToConfirm(report).sort()).toEqual([
      "muscle-balance-6day",
      "program-calisthenics-rft",
    ]);
  });

  it("falls back to the biggest droppers when only the mean regressed", () => {
    // Every scenario slips a little: no scenario-level failure fires, but the
    // mean drops past its 5pt allowance and there is nothing named to re-run.
    const report = evaluateEvalGate(
      run([
        ["control-strength-gym", 0.9],
        ["program-wendler-week", 0.9],
        ["program-calisthenics-rft", 0.88],
        ["muscle-balance-6day", 0.72],
      ]),
      REFERENCE
    );
    expect(report.failures.map((f) => f.kind)).toEqual(["overall-regression"]);
    const confirm = scenariosToConfirm(report);
    expect(confirm.length).toBe(3);
    expect(confirm).toContain("program-calisthenics-rft");
  });
});

describe("renderGateSummary with confirmations", () => {
  it("shows the samples behind a confirmed verdict", () => {
    const confirmed = mergeConfirmationRun(
      run([
        ["control-strength-gym", 1],
        ["program-wendler-week", 1],
        ["program-calisthenics-rft", 1],
        ["muscle-balance-6day", 0.67],
      ]),
      { results: [{ id: "muscle-balance-6day", overall: 0.89, samples: [0.89, 1] }] }
    );
    const markdown = renderGateSummary(evaluateEvalGate(confirmed, REFERENCE), "pr-1");
    expect(markdown).toContain("samples");
    expect(markdown).toContain("median of 67%/89%/100%");
  });

  it("omits the samples column entirely when nothing was confirmed", () => {
    const markdown = renderGateSummary(evaluateEvalGate(REFERENCE, REFERENCE), "pr-1");
    expect(markdown).not.toContain("samples");
  });
});
