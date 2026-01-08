import Queue from "bull";
import IORedis from "ioredis";
import { logger } from "@/utils/logger";
import {
  WorkoutGenerationJobData,
  WorkoutGenerationJobResult,
} from "@/models/jobs.schema";

// Build robust Redis options for Bull (ioredis under the hood)
function buildBullRedisOptions(): any {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    const url = new URL(redisUrl);
    const isTls = url.protocol === "rediss:";

    const base: any = {
      host: url.hostname,
      port: Number(url.port || 6379),
      db:
        url.pathname && url.pathname !== "/"
          ? Number(url.pathname.slice(1))
          : undefined,
      username: url.username || undefined,
      password: url.password || undefined,
    };

    if (isTls) {
      base.tls = {
        // In dev or some managed Redis providers, cert chains may be self-signed
        rejectUnauthorized:
          process.env.REDIS_TLS_REJECT_UNAUTHORIZED === "true",
      };
    }

    // Return a structure Bull understands and allows customizing clients
    return {
      // Minimal redis options kept here for Bull's metadata
      host: base.host,
      port: base.port,
      db: base.db,
      username: base.username,
      password: base.password,
      tls: base.tls,
      // Use factory to build per-client instances with safe flags
      createClient: (type: string) => {
        const common: any = {
          ...base,
          // Backoff for reconnects
          retryStrategy: (times: number) => Math.min(1000 + times * 500, 30000),
          reconnectOnError: (err: any) => {
            const msg = err?.message || "";
            return (
              err?.code === "ECONNRESET" ||
              msg.includes("ECONNRESET") ||
              msg.includes("READONLY")
            );
          },
        };

        if (type === "subscriber" || type === "bclient") {
          // Important: disable ready check and omit maxRetriesPerRequest for these
          return new IORedis({
            ...common,
            enableReadyCheck: false,
          });
        }

        // Main client can keep relaxed per-request retry settings
        return new IORedis({
          ...common,
          // Avoid request queue build-up on disconnects for normal client only
          maxRetriesPerRequest: null,
        });
      },
    };
  } catch {
    // Fallback to letting Bull parse the string itself
    return redisUrl;
  }
}

// Create the workout generation queue
export const workoutGenerationQueue = new Queue<WorkoutGenerationJobData>(
  "workout generation",
  {
    redis: buildBullRedisOptions(),
    defaultJobOptions: {
      removeOnComplete: 50, // Keep last 50 completed jobs
      removeOnFail: 20, // Keep last 20 failed jobs
      attempts: 3, // Retry failed jobs up to 3 times
      backoff: {
        type: "exponential",
        delay: 5000, // Start with 5 second delay, then exponential backoff
      },
    },
  }
);

// Queue event handlers
workoutGenerationQueue.on("ready", () => {
  logger.info("Workout generation queue is ready", {
    operation: "workoutQueue",
    metadata: {
      queueName: "workout generation",
    },
  });
});

workoutGenerationQueue.on("error", (error) => {
  logger.error("Workout generation queue error", error, {
    operation: "workoutQueue",
    metadata: {
      queueName: "workout generation",
    },
  });
});

workoutGenerationQueue.on("waiting", (jobId) => {
  logger.info("Job waiting in workout generation queue", {
    operation: "workoutQueue",
    metadata: {
      jobId,
      status: "waiting",
    },
  });
});

workoutGenerationQueue.on("active", (job) => {
  logger.info("Job started processing in workout generation queue", {
    operation: "workoutQueue",
    userId: (job.data as any).userId,
    metadata: {
      bullJobId: job.id,
      status: "active",
    },
  });
});

workoutGenerationQueue.on(
  "completed",
  (job, result: WorkoutGenerationJobResult) => {
    logger.info("Job completed in workout generation queue", {
      operation: "workoutQueue",
      userId: (job.data as any).userId,
      metadata: {
        bullJobId: job.id,
        workoutId: (result as any).workoutId,
        generationTime: (result as any).generationTimeMs,
        status: "completed",
      },
    });
  }
);

workoutGenerationQueue.on("failed", async (job, error) => {
  const maxAttempts = job?.opts?.attempts || 3;
  const isLastAttempt = job?.attemptsMade === maxAttempts;

  if (isLastAttempt) {
    logger.error("Bull Queue: Job failed after all attempts", error, {
      operation: "workoutQueue",
      metadata: {
        bullJobId: job?.id,
        dbJobId: (job?.data as any)?.jobId,
        userId: (job?.data as any)?.userId,
        attempts: job?.attemptsMade,
        maxAttempts,
        status: "failed",
      },
    });

    // Only update database status on final failure
    if ((job?.data as any)?.jobId) {
      try {
        const { jobsService } = await import("@/services/jobs.service");
        const { JobStatus } = await import("@/models/jobs.schema");

        const dbJob = await jobsService.getJob((job.data as any).jobId);
        if (
          dbJob &&
          dbJob.status !== JobStatus.FAILED &&
          dbJob.status !== JobStatus.COMPLETED
        ) {
          logger.warn(
            "Bull Queue Fallback: Job processor missed final attempt, updating database status manually",
            {
              operation: "workoutQueue",
              metadata: {
                bullJobId: job.id,
                dbJobId: (job.data as any).jobId,
                dbStatus: dbJob.status,
              },
            }
          );

          await jobsService.updateJobStatus(
            (job.data as any).jobId,
            JobStatus.FAILED,
            0,
            undefined,
            undefined,
            error.message
          );
        }
      } catch (fallbackError) {
        logger.error(
          "Bull Queue Fallback: Failed to update job status",
          fallbackError as Error,
          {
            operation: "workoutQueue",
            metadata: {
              bullJobId: job?.id,
              dbJobId: (job?.data as any)?.jobId,
            },
          }
        );
      }
    }
  } else {
    // Just log retry attempts without updating database
    logger.info("Bull Queue: Job failed but will retry", {
      operation: "workoutQueue",
      userId: (job?.data as any)?.userId,
      metadata: {
        bullJobId: job?.id,
        dbJobId: (job?.data as any)?.jobId,
        attempts: job?.attemptsMade,
        maxAttempts,
        retryNumber: job?.attemptsMade,
        remainingAttempts: maxAttempts - (job?.attemptsMade || 0),
        status: "retrying",
      },
    });
  }
});

workoutGenerationQueue.on("stalled", (job) => {
  logger.warn("Job stalled in workout generation queue", {
    operation: "workoutQueue",
    userId: (job.data as any).userId,
    metadata: {
      jobId: job.id,
      status: "stalled",
    },
  });
});

// Graceful shutdown
export async function closeWorkoutGenerationQueue() {
  try {
    await workoutGenerationQueue.close();
    logger.info("Workout generation queue closed gracefully", {
      operation: "workoutQueue",
    });
  } catch (error) {
    logger.error("Error closing workout generation queue", error as Error, {
      operation: "workoutQueue",
    });
  }
}
