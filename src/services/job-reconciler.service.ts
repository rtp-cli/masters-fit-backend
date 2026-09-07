/**
 * Orphaned-job reconciler — the wired half (DB + queue + reservations).
 *
 * The decision logic and the "why this exists" write-up live in
 * utils/job-reconciliation.ts, which is pure so it can be tested without
 * opening a Redis connection.
 */
import { aiOperationService } from "@/services/ai-operation.service";
import { jobsService } from "@/services/jobs.service";
import { workoutGenerationQueue } from "@/queues/workout-generation.queue";
import {
  ORPHAN_FAILURE_CODE,
  ORPHAN_FAILURE_MESSAGE,
  ORPHAN_MIN_AGE_MS,
  ORPHAN_SWEEP_INTERVAL_MS,
  reconcileJobs,
  type ReconcileResult,
  type ReconcilerQueue,
} from "@/utils/job-reconciliation";
import { logger } from "@/utils/logger";

/**
 * Find non-terminal jobs with no queue entry, fail them, and settle the
 * ai_operations reservation each one was holding (that reservation is what
 * blocks the user's next attempt with a 409). Never throws — a failed sweep
 * must not take down startup or the interval that calls it.
 */
export async function sweepOrphanedJobs(
  queue: ReconcilerQueue = workoutGenerationQueue as unknown as ReconcilerQueue
): Promise<ReconcileResult | null> {
  try {
    const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS);
    const candidates = await jobsService.listUnfinishedJobsOlderThan(cutoff);
    if (candidates.length === 0) {
      return { checked: 0, orphaned: [], live: [], tooNew: [] };
    }

    const result = await reconcileJobs({
      candidates: candidates.map((job) => ({
        id: job.id,
        userId: job.userId,
        status: job.status,
        updatedAt: job.updatedAt ?? null,
      })),
      queue,
      onOrphan: async (candidate) => {
        const failed = await jobsService.failJobIfUnfinished(
          candidate.id,
          ORPHAN_FAILURE_MESSAGE
        );
        if (!failed) return; // another instance (or the job itself) got there first

        await aiOperationService.settleFailedByJobId(candidate.id, {
          failureCode: ORPHAN_FAILURE_CODE,
          failureReason: ORPHAN_FAILURE_MESSAGE,
        });

        logger.warn("Failed an orphaned background job with no queue entry", {
          operation: "sweepOrphanedJobs",
          jobId: candidate.id,
          userId: candidate.userId,
          metadata: {
            previousStatus: candidate.status,
            ageMs: Date.now() - (candidate.updatedAt?.getTime() ?? 0),
          },
        });
      },
    });

    if (result.orphaned.length > 0 || result.live.length > 0) {
      logger.info("Orphaned-job sweep complete", {
        operation: "sweepOrphanedJobs",
        metadata: {
          checked: result.checked,
          orphaned: result.orphaned,
          liveCount: result.live.length,
          tooNewCount: result.tooNew.length,
        },
      });
    }

    return result;
  } catch (error) {
    logger.error("Orphaned-job sweep failed", error as Error, {
      operation: "sweepOrphanedJobs",
    });
    return null;
  }
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Sweep now, then every ORPHAN_SWEEP_INTERVAL_MS. Idempotent. */
export function startOrphanedJobSweeper(): void {
  if (sweepTimer) return;
  void sweepOrphanedJobs();
  sweepTimer = setInterval(() => {
    void sweepOrphanedJobs();
  }, ORPHAN_SWEEP_INTERVAL_MS);
}

export function stopOrphanedJobSweeper(): void {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}
