/**
 * Orphaned-job reconciliation — the pure decision half.
 *
 * A background_jobs row only reaches a terminal status because the processor
 * that owns it says so. If that process dies without getting there, the row
 * stays `processing` forever and nothing retries it:
 *
 *   2026-09-07 (issue #66): a weekly regeneration was claimed by the instance
 *   Render was about to replace, and killed in the deploy swap before its first
 *   LLM call. Bull re-delivered the job ~2 min later (lockDuration), but
 *   `claimJob` only takes over a PROCESSING row older than JOB_CLAIM_STALE_MS
 *   (10 min), so the new instance correctly treated it as a duplicate and
 *   skipped — Bull marked the job completed and the DB row was stranded. The
 *   client polled until its own 10-minute timeout, and the still-`reserved`
 *   ai_operations row blocked every retry with 409 CONCURRENCY_LIMIT for 15
 *   minutes.
 *
 * The sweep is deliberately narrow: it NEVER touches Bull, only DB rows that
 * Bull no longer has anything queued or running for. Because every job is added
 * with `{ jobId: dbRow.id.toString() }`, "is anything still going to run this?"
 * is a single `queue.getJob(id)` + `getState()` — which stays correct with
 * several instances sharing the queue (a job running elsewhere reports
 * `active`). That keeps the property index.ts calls out: we do not forcibly
 * fail Bull's active jobs, so no job is ever re-run behind a live worker.
 *
 * Orphans are FAILED, not re-queued: a dead run may already have persisted a
 * workout, and re-running it is exactly the double-execution class that PR #53
 * existed to kill. Failing frees the user's reservation and surfaces a real
 * error they can retry from.
 */
import { logger } from "@/utils/logger";

/**
 * Ignore rows younger than this. `createJob` commits before `queue.add`, so a
 * brand-new row can briefly have no Bull job through no fault of anyone's.
 */
export const ORPHAN_MIN_AGE_MS = 90_000;

/** How often the periodic sweep runs (a deploy-swap orphan heals without waiting for the next deploy). */
export const ORPHAN_SWEEP_INTERVAL_MS = 5 * 60_000;

export const ORPHAN_FAILURE_CODE = "orphaned_no_queue_entry";
export const ORPHAN_FAILURE_MESSAGE =
  "This job's worker stopped before it finished (likely a deploy or restart) and nothing was left to run it. Please try again.";

/**
 * Bull states that mean "something will still run, or is running, this job".
 * Everything else — including no Bull job at all, or a job Bull already
 * finished/failed while the DB row stayed open — means nobody will.
 */
const LIVE_BULL_STATES = new Set(["active", "waiting", "delayed", "paused"]);

export type ReconcileVerdict = "orphan" | "live" | "too-new";

export interface ReconcilerQueue {
  getJob(id: string): Promise<{ getState(): Promise<string> } | null | undefined>;
}

export interface ReconcilerCandidate {
  id: number;
  userId: number;
  status: string;
  updatedAt: Date | null;
}

/** Pure verdict for one candidate. `bullState` is null when Bull has no such job. */
export function classifyJobForReconciliation(input: {
  bullState: string | null;
  ageMs: number;
}): ReconcileVerdict {
  if (input.ageMs < ORPHAN_MIN_AGE_MS) return "too-new";
  if (input.bullState !== null && LIVE_BULL_STATES.has(input.bullState)) return "live";
  return "orphan";
}

export interface ReconcileResult {
  checked: number;
  orphaned: number[];
  live: number[];
  tooNew: number[];
}

/**
 * Classify candidates against the queue and hand each orphan to `onOrphan`.
 * Takes its inputs rather than fetching them so it can be unit-tested without
 * a database or a Redis connection (importing the Bull queue opens one).
 */
export async function reconcileJobs(args: {
  candidates: ReconcilerCandidate[];
  queue: ReconcilerQueue;
  onOrphan: (candidate: ReconcilerCandidate) => Promise<void>;
  now?: number;
}): Promise<ReconcileResult> {
  const now = args.now ?? Date.now();
  const result: ReconcileResult = { checked: 0, orphaned: [], live: [], tooNew: [] };

  for (const candidate of args.candidates) {
    result.checked += 1;
    const ageMs = now - (candidate.updatedAt?.getTime() ?? 0);

    let bullState: string | null = null;
    try {
      const job = await args.queue.getJob(String(candidate.id));
      bullState = job ? await job.getState() : null;
    } catch (error) {
      // Can't prove the job is gone -> treat it as live. A missed orphan is
      // recoverable (the next sweep retries); wrongly failing a running job is not.
      logger.warn("Orphan sweep could not read a job's queue state — leaving it alone", {
        operation: "reconcileJobs",
        jobId: candidate.id,
        error: (error as Error).message,
      });
      result.live.push(candidate.id);
      continue;
    }

    const verdict = classifyJobForReconciliation({ bullState, ageMs });
    if (verdict === "too-new") {
      result.tooNew.push(candidate.id);
      continue;
    }
    if (verdict === "live") {
      result.live.push(candidate.id);
      continue;
    }

    await args.onOrphan(candidate);
    result.orphaned.push(candidate.id);
  }

  return result;
}
