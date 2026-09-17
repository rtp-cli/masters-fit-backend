import Queue from "bull";

import { buildBullRedisOptions } from "@/queues/workout-generation.queue";
import { logger } from "@/utils/logger";

// Cron for the daily activation scan. 17:00 UTC — deliberately an hour after
// the onboarding nudge (16:00) and two after the stalled-signup digest and
// renewal reminder (15:00), so the daily email jobs never contend for the same
// Resend burst. Standard 5-field cron.
export const ACTIVATION_NUDGE_CRON =
  process.env.ACTIVATION_NUDGE_CRON || "0 17 * * *";

// Stable repeatable-job id. Bull keys repeatable jobs by (name, cron, jobId),
// so a fixed id means N instances registering it still yield ONE schedule.
export const ACTIVATION_NUDGE_JOB_ID = "activation-nudge-daily";

/**
 * Dedicated queue for the activation nudge. Separate from the onboarding nudge
 * queue even though both are once-daily customer-email scans: they mail
 * different audiences for different reasons, and when one misbehaves it needs
 * to be stoppable without silencing the other.
 */
export const activationNudgeQueue = new Queue("activation nudge", {
  redis: buildBullRedisOptions(),
  defaultJobOptions: {
    removeOnComplete: 30,
    removeOnFail: 30,
    // One attempt. A retry would re-scan a list whose claims are already
    // written, so it can only produce noise — and the claim column means
    // tomorrow's run naturally picks up anyone who was missed.
    attempts: 1,
  },
});

activationNudgeQueue.on("error", (error) => {
  logger.error("Activation nudge queue error", error, {
    operation: "activationNudgeQueue",
  });
});

/**
 * Register (or refresh) the daily scan. Idempotent: safe on every boot and from
 * every instance.
 */
export async function scheduleActivationNudgeJob(): Promise<void> {
  // Registering a CHANGED cron adds a second schedule and leaves the old one
  // firing — remove any stale schedule for this jobId first.
  const existing = await activationNudgeQueue.getRepeatableJobs();
  for (const job of existing) {
    if (
      job.id === ACTIVATION_NUDGE_JOB_ID &&
      job.cron !== ACTIVATION_NUDGE_CRON
    ) {
      await activationNudgeQueue.removeRepeatableByKey(job.key);
      logger.info("Removed stale activation nudge schedule", {
        operation: "scheduleActivationNudgeJob",
        metadata: { staleCron: job.cron, currentCron: ACTIVATION_NUDGE_CRON },
      });
    }
  }

  await activationNudgeQueue.add(
    "activation-nudge",
    {},
    {
      repeat: { cron: ACTIVATION_NUDGE_CRON },
      jobId: ACTIVATION_NUDGE_JOB_ID,
    }
  );

  logger.info("Activation nudge job scheduled", {
    operation: "scheduleActivationNudgeJob",
    metadata: { cron: ACTIVATION_NUDGE_CRON },
  });
}

export async function closeActivationNudgeQueue(): Promise<void> {
  try {
    await activationNudgeQueue.close();
    logger.info("Activation nudge queue closed gracefully", {
      operation: "activationNudgeQueue",
    });
  } catch (error) {
    logger.error("Error closing activation nudge queue", error as Error, {
      operation: "activationNudgeQueue",
    });
  }
}
