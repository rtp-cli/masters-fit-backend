import Queue from "bull";
import { logger } from "@/utils/logger";
import { buildBullRedisOptions } from "@/queues/workout-generation.queue";

// Cron for the daily renewal-reminder scan. 15:00 UTC ≈ mid/late morning across
// US timezones — a reasonable hour to land a billing heads-up. Overridable via
// env so staging can run it off-peak or on demand. Standard 5-field cron.
export const RENEWAL_REMINDER_CRON =
  process.env.RENEWAL_REMINDER_CRON || "0 15 * * *";

// The recurring job's stable id. Bull keys repeatable jobs by (name, cron,
// jobId), so a fixed id means N instances registering it still yield ONE
// schedule, and re-registering on every boot is idempotent (no pile-up).
export const RENEWAL_REMINDER_JOB_ID = "renewal-reminder-daily";

/**
 * Dedicated queue for the renewal-reminder scan. Kept separate from the workout
 * queue so its metrics/logs don't mix with generation jobs. It's a light,
 * once-daily job — low concurrency, keep little history.
 */
export const renewalReminderQueue = new Queue(
  "renewal reminder",
  {
    redis: buildBullRedisOptions(),
    defaultJobOptions: {
      removeOnComplete: 30,
      removeOnFail: 30,
      attempts: 1, // Per-recipient sends are already idempotent + self-retrying via the claim.
    },
  }
);

renewalReminderQueue.on("error", (error) => {
  logger.error("Renewal reminder queue error", error, {
    operation: "renewalReminderQueue",
  });
});

/**
 * Register (or refresh) the daily repeatable scan. Idempotent: safe to call on
 * every boot and from every instance.
 */
export async function scheduleRenewalReminderJob(): Promise<void> {
  await renewalReminderQueue.add(
    "renewal-reminder",
    {},
    {
      repeat: { cron: RENEWAL_REMINDER_CRON },
      jobId: RENEWAL_REMINDER_JOB_ID,
    }
  );

  logger.info("Renewal reminder job scheduled", {
    operation: "scheduleRenewalReminderJob",
    metadata: { cron: RENEWAL_REMINDER_CRON },
  });
}

export async function closeRenewalReminderQueue(): Promise<void> {
  try {
    await renewalReminderQueue.close();
    logger.info("Renewal reminder queue closed gracefully", {
      operation: "renewalReminderQueue",
    });
  } catch (error) {
    logger.error("Error closing renewal reminder queue", error as Error, {
      operation: "renewalReminderQueue",
    });
  }
}
