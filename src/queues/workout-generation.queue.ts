import Queue from "bull";
import IORedis from "ioredis";
import { logger } from "@/utils/logger";
import {
  WorkoutGenerationJobData,
  WorkoutGenerationJobResult,
} from "@/models/jobs.schema";

// Build Redis base options from URL
function parseRedisUrl(): any {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
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
      rejectUnauthorized:
        process.env.REDIS_TLS_REJECT_UNAUTHORIZED === "true",
    };
  }

  return base;
}

// Create Redis client factory for Bull - MUST be at top level of queue options
function createBullRedisClient(type: string): IORedis {
  const base = parseRedisUrl();

  const options: any = {
    ...base,
    maxRetriesPerRequest: null, // Critical for Bull - prevents request timeout
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(1000 + times * 500, 30000),
  };

  const client = new IORedis(options);

  client.on('error', (err) => {
    logger.error(`Queue Redis ${type} client error`, err);
  });

  return client;
}

// Create the workout generation queue
// IMPORTANT: createClient MUST be at top level, not inside redis options
export const workoutGenerationQueue = new Queue<WorkoutGenerationJobData>(
  "workout generation",
  {
    createClient: createBullRedisClient,
    defaultJobOptions: {
      removeOnComplete: 50, // Keep last 50 completed jobs
      removeOnFail: 20, // Keep last 20 failed jobs
      attempts: 3, // Retry failed jobs up to 3 times
      backoff: {
        type: "exponential",
        delay: 5000, // Start with 5 second delay, then exponential backoff
      },
    },
    settings: {
      // How often to check for stalled jobs (ms)
      stalledInterval: 30000,
      // Max stall count before job is considered failed
      maxStalledCount: 2,
      // Lock duration for processing (5 minutes for long LLM calls)
      lockDuration: 300000,
      // How often to renew the lock
      lockRenewTime: 150000,
    },
  }
);

// Queue event handlers
workoutGenerationQueue.on("ready", () => {
  logger.info("Workout generation queue is ready", {
    operation: "workoutQueue",
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

// Monitor for connection issues
workoutGenerationQueue.on("paused", () => {
  logger.warn("Queue paused", { operation: "workoutQueue" });
});

workoutGenerationQueue.on("resumed", () => {
  logger.info("Queue resumed", { operation: "workoutQueue" });
});

// Keep-alive and job pickup workaround for local Docker Redis
setInterval(async () => {
  try {
    const client = await workoutGenerationQueue.client;
    if (client.status !== 'ready') {
      logger.warn("Queue Redis client not ready", { status: client.status });
    }
    await client.ping();

    // Check for waiting jobs that aren't being picked up (Docker Redis workaround)
    const waitingCount = await workoutGenerationQueue.getWaitingCount();
    const activeCount = await workoutGenerationQueue.getActiveCount();

    if (waitingCount > 0 && activeCount === 0) {
      await workoutGenerationQueue.resume();
    }
  } catch (err) {
    logger.error("Queue health check failed", err as Error);
  }
}, 10000);

workoutGenerationQueue.on("waiting", async (jobId) => {
  logger.info("Job waiting in queue", {
    operation: "workoutQueue",
    metadata: { jobId },
  });

  // Kick queue to pick up job (Docker Redis workaround)
  setTimeout(async () => {
    try {
      const waitingCount = await workoutGenerationQueue.getWaitingCount();
      const activeCount = await workoutGenerationQueue.getActiveCount();
      if (waitingCount > 0 && activeCount < 10) {
        await workoutGenerationQueue.resume();
      }
    } catch {
      // Ignore
    }
  }, 1000);
});

workoutGenerationQueue.on("active", (job) => {
  logger.info("Job active in queue", {
    operation: "workoutQueue",
    userId: (job.data as any).userId,
    metadata: { jobId: job.id, jobName: job.name },
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
