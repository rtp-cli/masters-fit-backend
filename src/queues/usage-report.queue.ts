import Queue from "bull";
import { logger } from "@/utils/logger";
import { buildBullRedisOptions } from "@/queues/workout-generation.queue";
import { usageReportCron, usageReportTimezone } from "@/constants/usage-report";

// Stable id for the weekly repeatable job. Bull keys repeatable jobs by
// (name, cron, jobId), so N instances registering it still yield ONE schedule.
export const USAGE_REPORT_JOB_ID = "usage-report-weekly";

/** Dedicated queue for the weekly usage report. Once a week, tiny history. */
export const usageReportQueue = new Queue("usage report", {
  redis: buildBullRedisOptions(),
  defaultJobOptions: {
    removeOnComplete: 12,
    removeOnFail: 12,
    // One attempt: a failure is logged, and the report can be re-sent by hand
    // with `npm run send-usage-report`.
    attempts: 1,
  },
});

usageReportQueue.on("error", (error) => {
  logger.error("Usage report queue error", error, {
    operation: "usageReportQueue",
  });
});

/**
 * Register (or refresh) the weekly schedule. Idempotent: safe to call on every
 * boot and from every instance.
 */
export async function scheduleUsageReportJob(): Promise<void> {
  const cron = usageReportCron();
  const tz = usageReportTimezone();

  // A CHANGED cron or tz registers a second schedule and leaves the old one
  // firing, so remove any schedule for this jobId that no longer matches.
  const existing = await usageReportQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === USAGE_REPORT_JOB_ID && (job.cron !== cron || job.tz !== tz)) {
      await usageReportQueue.removeRepeatableByKey(job.key);
      logger.info("Removed stale usage report schedule", {
        operation: "scheduleUsageReportJob",
        metadata: { staleCron: job.cron, staleTz: job.tz, cron, tz },
      });
    }
  }

  await usageReportQueue.add(
    "usage-report",
    {},
    {
      repeat: { cron, tz },
      jobId: USAGE_REPORT_JOB_ID,
    }
  );

  logger.info("Usage report job scheduled", {
    operation: "scheduleUsageReportJob",
    metadata: { cron, tz },
  });
}

export async function closeUsageReportQueue(): Promise<void> {
  try {
    await usageReportQueue.close();
    logger.info("Usage report queue closed gracefully", {
      operation: "usageReportQueue",
    });
  } catch (error) {
    logger.error("Error closing usage report queue", error as Error, {
      operation: "usageReportQueue",
    });
  }
}
