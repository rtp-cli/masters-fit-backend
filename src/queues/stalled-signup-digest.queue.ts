import Queue from "bull";
import { logger } from "@/utils/logger";
import { buildBullRedisOptions } from "@/queues/workout-generation.queue";

// Cron for the daily stalled-signup scan. 15:00 UTC ≈ mid/late morning across
// US timezones. Overridable via env so staging can run it off-peak or on demand.
// Standard 5-field cron.
export const STALLED_SIGNUP_DIGEST_CRON =
  process.env.STALLED_SIGNUP_DIGEST_CRON || "0 15 * * *";

// The recurring job's stable id. Bull keys repeatable jobs by (name, cron,
// jobId), so a fixed id means N instances registering it still yield ONE
// schedule, and re-registering on every boot is idempotent (no pile-up).
export const STALLED_SIGNUP_DIGEST_JOB_ID = "stalled-signup-digest-daily";

/**
 * Dedicated queue for the stalled-signup digest. Separate from the workout and
 * renewal queues so its metrics stay legible. Light, once-daily, low history.
 */
export const stalledSignupDigestQueue = new Queue("stalled signup digest", {
  redis: buildBullRedisOptions(),
  defaultJobOptions: {
    removeOnComplete: 30,
    removeOnFail: 30,
    // One attempt: a failed send marks nobody, so tomorrow's run retries the
    // whole list naturally. Retrying inside the day would only re-notify.
    attempts: 1,
  },
});

stalledSignupDigestQueue.on("error", (error) => {
  logger.error("Stalled signup digest queue error", error, {
    operation: "stalledSignupDigestQueue",
  });
});

/**
 * Register (or refresh) the daily repeatable scan. Idempotent: safe to call on
 * every boot and from every instance.
 */
export async function scheduleStalledSignupDigestJob(): Promise<void> {
  // Bull keys repeatable jobs by (name, cron, jobId): registering a CHANGED
  // cron adds a second schedule and leaves the old one firing. Remove any
  // schedule for this jobId whose cron no longer matches before registering.
  const existing = await stalledSignupDigestQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === STALLED_SIGNUP_DIGEST_JOB_ID && job.cron !== STALLED_SIGNUP_DIGEST_CRON) {
      await stalledSignupDigestQueue.removeRepeatableByKey(job.key);
      logger.info("Removed stale stalled-signup digest schedule", {
        operation: "scheduleStalledSignupDigestJob",
        metadata: { staleCron: job.cron, currentCron: STALLED_SIGNUP_DIGEST_CRON },
      });
    }
  }

  await stalledSignupDigestQueue.add(
    "stalled-signup-digest",
    {},
    {
      repeat: { cron: STALLED_SIGNUP_DIGEST_CRON },
      jobId: STALLED_SIGNUP_DIGEST_JOB_ID,
    }
  );

  logger.info("Stalled signup digest job scheduled", {
    operation: "scheduleStalledSignupDigestJob",
    metadata: { cron: STALLED_SIGNUP_DIGEST_CRON },
  });
}

export async function closeStalledSignupDigestQueue(): Promise<void> {
  try {
    await stalledSignupDigestQueue.close();
    logger.info("Stalled signup digest queue closed gracefully", {
      operation: "stalledSignupDigestQueue",
    });
  } catch (error) {
    logger.error("Error closing stalled signup digest queue", error as Error, {
      operation: "stalledSignupDigestQueue",
    });
  }
}
