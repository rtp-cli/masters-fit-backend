import { eq, and, desc, lt, or } from "drizzle-orm";
import {
  backgroundJobs,
  BackgroundJob,
  InsertBackgroundJob,
  JobStatus,
  JobStatusType,
} from "@/models/jobs.schema";
import { BaseService } from "@/services/base.service";
import { logger } from "@/utils/logger";

/**
 * Thrown when a job run discovers another run of the SAME background job has
 * already reached a terminal state (Bull stalled-lock reclaims and multi-worker
 * races run the same job more than once). Processors treat it as a silent
 * no-op: no status update, no ledger settle, no notification — the winning
 * run already did all of that.
 */
export class JobSupersededError extends Error {
  constructor(jobId: number, status: string) {
    super(`Job ${jobId} already ${status} by another run`);
    this.name = "JobSupersededError";
  }
}

/**
 * How long a PROCESSING claim can sit without a status update before another
 * run may take the job over. Must comfortably exceed the longest legitimate
 * quiet stretch of a run (the 8-minute generation watchdog bounds every run,
 * and progress writes are sparse in between), or a healthy slow run would be
 * double-executed — the exact bug the claim exists to prevent. Kept above the
 * watchdog so takeover only ever happens after the original run is dead.
 */
export const JOB_CLAIM_STALE_MS = 10 * 60_000;

export class JobsService extends BaseService {
  async createJob(
    userId: number,
    jobType: string,
    data: any
  ): Promise<BackgroundJob> {
    const jobData: InsertBackgroundJob = {
      userId,
      jobType,
      status: JobStatus.PENDING,
      progress: 0,
      data,
      result: null,
      error: null,
      workoutId: null,
    };

    const [job] = await this.db
      .insert(backgroundJobs)
      .values(jobData)
      .returning();

    logger.info("Background job created", {
      operation: "createJob",
      jobId: job.id,
      userId,
      jobType,
    });

    return job as BackgroundJob;
  }

  async getJob(jobId: number): Promise<BackgroundJob | null> {
    const job = await this.db.query.backgroundJobs.findFirst({
      where: eq(backgroundJobs.id, jobId),
    });

    return (job as BackgroundJob) || null;
  }

  async getUserJobs(
    userId: number,
    jobType?: string,
    limit: number = 50
  ): Promise<BackgroundJob[]> {
    const conditions = [eq(backgroundJobs.userId, userId)];

    if (jobType) {
      conditions.push(eq(backgroundJobs.jobType, jobType));
    }

    const jobs = await this.db
      .select()
      .from(backgroundJobs)
      .where(and(...conditions))
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(limit);

    return jobs as BackgroundJob[];
  }

  /**
   * Atomically claim a background job for execution. Bull can hand the same
   * job to two runs at once (delayed-promotion races, stalled-lock reclaims,
   * multi-instance overlap) — prod forensics 2026-09-06 measured ~60% of
   * generations double-executing, each run persisting its own workout with the
   * last finisher winning `is_active`. The after-the-fact "already terminal"
   * check can't stop CONCURRENT runs, so the claim is a single atomic UPDATE
   * on the shared Postgres row: exactly one concurrent caller flips
   * PENDING→PROCESSING and gets the row back; everyone else gets null and must
   * skip without side effects.
   *
   * A PROCESSING job whose updatedAt is older than `staleMs` may be taken
   * over — that's the crash-recovery path (worker died mid-run without
   * reaching a terminal status). Terminal jobs are never claimable.
   */
  async claimJob(
    jobId: number,
    staleMs: number = JOB_CLAIM_STALE_MS
  ): Promise<BackgroundJob | null> {
    const staleBefore = new Date(Date.now() - staleMs);
    const [claimed] = await this.db
      .update(backgroundJobs)
      .set({ status: JobStatus.PROCESSING, updatedAt: new Date() })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          or(
            eq(backgroundJobs.status, JobStatus.PENDING),
            and(
              eq(backgroundJobs.status, JobStatus.PROCESSING),
              lt(backgroundJobs.updatedAt, staleBefore)
            )
          )
        )
      )
      .returning();

    if (claimed) {
      logger.info("Background job claimed", {
        operation: "claimJob",
        jobId,
        metadata: { processId: process.pid },
      });
    }

    return (claimed as BackgroundJob) ?? null;
  }

  /**
   * Release a claim so a Bull retry can re-acquire it. Only flips
   * PROCESSING back to PENDING — never touches a terminal status, so a
   * completed/failed job can't be reopened by a late release.
   */
  async releaseJobClaim(jobId: number): Promise<void> {
    await this.db
      .update(backgroundJobs)
      .set({ status: JobStatus.PENDING, updatedAt: new Date() })
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.status, JobStatus.PROCESSING)
        )
      );
  }

  async updateJobStatus(
    jobId: number,
    status: JobStatusType,
    progress: number,
    result?: any,
    workoutId?: number,
    error?: string
  ): Promise<BackgroundJob> {
    const updateData: any = {
      status,
      progress,
      updatedAt: new Date(),
    };

    if (result !== undefined) {
      updateData.result = result;
    }

    if (workoutId !== undefined) {
      updateData.workoutId = workoutId;
    }

    if (error !== undefined) {
      updateData.error = error;
    }

    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      updateData.completedAt = new Date();
    }

    const [updatedJob] = await this.db
      .update(backgroundJobs)
      .set(updateData)
      .where(eq(backgroundJobs.id, jobId))
      .returning();

    logger.debug("Job status updated", {
      operation: "updateJobStatus",
      jobId,
      status,
      progress,
      hasResult: result !== undefined,
      hasError: error !== undefined,
    });

    return updatedJob as BackgroundJob;
  }

  async deleteJob(jobId: number): Promise<boolean> {
    const result = await this.db
      .delete(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId))
      .returning();

    const deleted = result.length > 0;

    if (deleted) {
      logger.info("Background job deleted", {
        operation: "deleteJob",
        jobId,
      });
    }

    return deleted;
  }

  async getActiveJobsCount(userId: number): Promise<number> {
    const result = await this.db
      .select({ count: backgroundJobs.id })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.userId, userId),
          eq(backgroundJobs.status, JobStatus.PROCESSING)
        )
      );

    return result.length;
  }

  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const deletedJobs = await this.db
      .delete(backgroundJobs)
      .where(
        and(
          lt(backgroundJobs.createdAt, cutoffDate),
          or(
            eq(backgroundJobs.status, JobStatus.COMPLETED),
            eq(backgroundJobs.status, JobStatus.FAILED)
          )
        )
      )
      .returning();

    logger.info(`Cleaned up ${deletedJobs.length} old jobs (cutoff: ${cutoffDate.toISOString()})`, {
      operation: "cleanupOldJobs",
    });

    return deletedJobs.length;
  }
}

export const jobsService = new JobsService();
