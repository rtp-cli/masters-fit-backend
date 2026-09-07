/**
 * CLI wrapper around utils/eval-gate.ts: compare an eval run against the
 * committed reference, print the verdict, and exit non-zero on a regression so
 * CI (or a local run) fails loudly.
 *
 * Usage:
 *   npm run eval-gate -- --current eval-runs/weekly.json
 *   npm run eval-gate -- --current eval-runs/weekly.json --reference eval-baseline/reference.json
 *
 * When GITHUB_STEP_SUMMARY is set, the markdown report is appended there too.
 */
import fs from "fs";
import path from "path";
import {
  evaluateEvalGate,
  renderGateSummary,
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

const current = readRun(currentPath);
const reference = readRun(referencePath);
const report = evaluateEvalGate(current, reference);
const markdown = renderGateSummary(report, current.label || path.basename(currentPath, ".json"));

console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

for (const failure of report.failures) {
  // GitHub annotation so the failure shows on the run, not just in the log.
  console.log(`::error::${failure.message}`);
}

process.exit(report.passed ? 0 : 1);
