import { describe, it, expect } from "@jest/globals";
import {
  evaluateEvalGate,
  renderGateSummary,
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
