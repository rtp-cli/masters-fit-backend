/**
 * CLI wrapper around utils/eval-gate.ts: compare an eval run against the
 * committed reference, print the verdict, and exit non-zero on a regression so
 * CI (or a local run) fails loudly.
 *
 * Usage:
 *   npm run eval-gate -- --current eval-runs/weekly.json
 *   npm run eval-gate -- --current eval-runs/weekly.json --reference eval-baseline/reference.json
 *   npm run eval-gate -- --current eval-runs/pr-9.json --soft          # verdict, always exit 0
 *   npm run eval-gate -- --current eval-runs/pr-9.json --confirm eval-runs/confirm-9.json
 *
 * --soft reports without failing the step, so CI can look at a red verdict and
 * decide to re-run the suspect scenarios before believing it. --confirm folds
 * those re-run samples in and judges each scenario on the median (see
 * utils/eval-gate.ts for why a single run is a sample, not a measurement).
 *
 * When GITHUB_STEP_SUMMARY is set, the markdown report is appended there too.
 * When GITHUB_OUTPUT is set, `confirm=<comma-separated ids>` is written for the
 * workflow to pick up — empty when the run passed.
 */
import fs from "fs";
import path from "path";
import {
  evaluateEvalGate,
  mergeConfirmationRun,
  renderGateSummary,
  scenariosToConfirm,
  type EvalRunFile,
} from "@/utils/eval-gate";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

function readRun(file: string): EvalRunFile {
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(parsed?.results)) {
    throw new Error(`${file} is not an eval run summary (no results array)`);
  }
  return parsed as EvalRunFile;
}

const args = parseArgs(process.argv.slice(2));
const currentPath = args.current;
const referencePath = args.reference || path.join("eval-baseline", "reference.json");

if (!currentPath) {
  console.error("Missing --current <eval-runs/<label>.json>");
  process.exit(2);
}

const baseRun = readRun(currentPath);
const reference = readRun(referencePath);

// Re-run samples, when the workflow collected them, are pooled with the base
// run's before the verdict — so each confirmed scenario is judged on a median.
const current = args.confirm ? mergeConfirmationRun(baseRun, readRun(args.confirm)) : baseRun;

const report = evaluateEvalGate(current, reference);
const label = current.label || path.basename(currentPath, ".json");
const markdown = renderGateSummary(report, args.confirm ? `${label} (confirmed)` : label);

console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

// Hand the workflow the scenarios worth re-running. Empty on a pass.
const confirm = scenariosToConfirm(report);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `confirm=${confirm.join(",")}\n`);
}

const soft = args.soft === "true";
for (const failure of report.failures) {
  // GitHub annotation so the failure shows on the run, not just in the log.
  // Soft mode is deliberately a warning: the verdict isn't final until the
  // suspect scenarios have been re-run.
  console.log(`::${soft ? "warning" : "error"}::${failure.message}`);
}

if (!report.passed && soft) {
  console.log(
    `\nSoft gate: ${confirm.length} scenario(s) to confirm before this counts as a regression — ${confirm.join(", ")}`
  );
}

process.exit(report.passed || soft ? 0 : 1);
