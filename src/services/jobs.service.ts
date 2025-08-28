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

    return job;
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

    return jobs;
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

    return updatedJob;
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
