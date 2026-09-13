import Queue from "bull";
import { logger } from "@/utils/logger";
import { buildBullRedisOptions } from "@/queues/workout-generation.queue";

// Cron for the daily nudge scan. 16:00 UTC ≈ late morning across US timezones,
// and deliberately an hour after the stalled-signup digest so the two daily
// email jobs don't contend for the same Resend burst. Standard 5-field cron.
export const ONBOARDING_NUDGE_CRON =
  process.env.ONBOARDING_NUDGE_CRON || "0 16 * * *";

// Stable repeatable-job id. Bull keys repeatable jobs by (name, cron, jobId),
// so a fixed id means N instances registering it still yield ONE schedule.
export const ONBOARDING_NUDGE_JOB_ID = "onboarding-nudge-daily";

/**
 * Dedicated queue for the onboarding nudge. Separate from the digest queue even
 * though both are once-daily email scans: this one mails customers, and when
 * something goes wrong it needs to be stoppable on its own.
 */
export const onboardingNudgeQueue = new Queue("onboarding nudge", {
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

onboardingNudgeQueue.on("error", (error) => {
  logger.error("Onboarding nudge queue error", error, {
    operation: "onboardingNudgeQueue",
  });
});

/**
 * Register (or refresh) the daily scan. Idempotent: safe on every boot and from
 * every instance.
 */
export async function scheduleOnboardingNudgeJob(): Promise<void> {
  // Registering a CHANGED cron adds a second schedule and leaves the old one
  // firing — remove any stale schedule for this jobId first.
  const existing = await onboardingNudgeQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === ONBOARDING_NUDGE_JOB_ID && job.cron !== ONBOARDING_NUDGE_CRON) {
      await onboardingNudgeQueue.removeRepeatableByKey(job.key);
      logger.info("Removed stale onboarding nudge schedule", {
        operation: "scheduleOnboardingNudgeJob",
        metadata: { staleCron: job.cron, currentCron: ONBOARDING_NUDGE_CRON },
      });
    }
  }

  await onboardingNudgeQueue.add(
    "onboarding-nudge",
    {},
    {
      repeat: { cron: ONBOARDING_NUDGE_CRON },
      jobId: ONBOARDING_NUDGE_JOB_ID,
    }
  );

  logger.info("Onboarding nudge job scheduled", {
    operation: "scheduleOnboardingNudgeJob",
    metadata: { cron: ONBOARDING_NUDGE_CRON },
  });
}

export async function closeOnboardingNudgeQueue(): Promise<void> {
  try {
    await onboardingNudgeQueue.close();
    logger.info("Onboarding nudge queue closed gracefully", {
      operation: "onboardingNudgeQueue",
    });
  } catch (error) {
    logger.error("Error closing onboarding nudge queue", error as Error, {
      operation: "onboardingNudgeQueue",
    });
  }
}
