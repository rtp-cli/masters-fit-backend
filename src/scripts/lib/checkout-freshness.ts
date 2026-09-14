/**
 * Refuse to run an ops script from a stale checkout.
 *
 * These scripts send REAL email and write to REAL databases from a laptop,
 * using whatever code happens to be checked out here. Merging to main and
 * deploying to Render does NOT change that — only `git pull` does.
 *
 * Built after 2026-09-14: a comp email went out without its owner Bcc minutes
 * after that Bcc shipped to production, because the local checkout was one
 * commit behind. Nothing in the script's output hinted at it; the send looked
 * completely successful, because it was — it just ran the old code.
 *
 * ADVISORY wherever git can't give a straight answer (not a repo, no network,
 * no origin/main). A guard that blocks ops work because GitHub is unreachable
 * would be worse than the bug it prevents. It hard-fails on the one thing it
 * can actually prove: this checkout is missing commits that origin/main has.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const REMOTE = "origin";
const BRANCH = "main";

/** Run git; return trimmed stdout, or null if git failed for any reason. */
async function git(args: string[], timeout = 15_000): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { timeout });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface CheckoutFreshnessOptions {
  /** Skip the check entirely — the script's own --stale-ok escape hatch. */
  skip?: boolean;
  /**
   * Warn instead of exiting. For invocations that can't send or write, like a
   * --dry-run: still worth knowing, never worth blocking.
   */
  warnOnly?: boolean;
  /** Shown in the failure message, e.g. "npm run comp-user". */
  label: string;
}

/**
 * Exits the process (code 1) when this checkout is behind origin/main and
 * `warnOnly` is not set. Otherwise returns, having possibly printed a warning.
 */
export async function assertCheckoutIsCurrent(
  options: CheckoutFreshnessOptions,
): Promise<void> {
  const { skip = false, warnOnly = false, label } = options;

  if (skip) {
    console.warn(`  ⚠️  --stale-ok: skipping the checkout freshness check.\n`);
    return;
  }

  if ((await git(["rev-parse", "--is-inside-work-tree"])) !== "true") {
    return; // Not a git checkout. Nothing to compare against.
  }

  // Without this the comparison is against whatever origin/main looked like the
  // last time anything fetched, which is exactly the stale view we're guarding
  // against. Failure is fine and common (offline, no credentials) — the stale
  // ref below is still better than nothing.
  const fetched = (await git(["fetch", "--quiet", REMOTE, BRANCH])) !== null;

  const behind = await git([
    "rev-list",
    "--count",
    `HEAD..${REMOTE}/${BRANCH}`,
  ]);
  if (behind === null) {
    console.warn(
      `  ⚠️  Couldn't compare this checkout against ${REMOTE}/${BRANCH} — running anyway.\n`,
    );
    return;
  }

  const count = Number(behind);
  if (!Number.isFinite(count) || count === 0) {
    if (!fetched) {
      console.warn(
        `  ⚠️  Couldn't reach ${REMOTE}; freshness checked against a cached ref.\n`,
      );
    }
    return;
  }

  const missing =
    (await git([
      "log",
      "--oneline",
      "--no-decorate",
      `HEAD..${REMOTE}/${BRANCH}`,
    ])) ?? "";

  const headline = `This checkout is ${count} commit${count === 1 ? "" : "s"} behind ${REMOTE}/${BRANCH}.`;
  const why =
    `${label} runs from THIS directory, not from Render — it will send email and write\n` +
    `to the database using the older code. A deploy does not fix that; only a pull does.`;

  if (warnOnly) {
    const indented = why
      .split("\n")
      .map((line) => `     ${line}`)
      .join("\n");
    console.warn(`\n  ⚠️  ${headline}\n${indented}\n`);
    return;
  }

  console.error(`\n✋ ${headline}\n`);
  console.error(`${why}\n`);
  console.error(`Missing here:\n${missing}\n`);
  console.error(`Fix it:\n  git pull\n`);
  console.error(
    `Or, if you truly mean to run the old code:\n  ...same command, plus --stale-ok\n`,
  );
  process.exit(1);
}
