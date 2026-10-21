import Queue from "bull";

import { buildBullRedisOptions } from "@/queues/workout-generation.queue";
import { logger } from "@/utils/logger";

// Cron for the workout reminder scan: HOURLY, on the hour. Each user is only
// due in the one hour that is WORKOUT_REMINDER_LOCAL_HOUR in their own
// timezone, so the scan has to visit every hour to reach every timezone.
// Standard 5-field cron.
export const WORKOUT_REMINDER_CRON =
  process.env.WORKOUT_REMINDER_CRON || "0 * * * *";

// Stable repeatable-job id. Bull keys repeatable jobs by (name, cron, jobId),
// so a fixed id means N instances registering it still yield ONE schedule.
export const WORKOUT_REMINDER_JOB_ID = "workout-reminder-hourly";

/**
 * Dedicated queue for the workout reminder push. Separate from the email nudge
 * queues so that when one misbehaves it can be stopped without silencing the
 * others.
 */
export const workoutReminderQueue = new Queue("workout reminder", {
  redis: buildBullRedisOptions(),
  defaultJobOptions: {
    removeOnComplete: 30,
    removeOnFail: 30,
    // One attempt. A retry would re-scan a list whose claims are already
    // written, so it can only produce noise. A missed hour is a missed
    // reminder, which is the acceptable failure.
    attempts: 1,
  },
});

workoutReminderQueue.on("error", (error) => {
  logger.error("Workout reminder queue error", error, {
    operation: "workoutReminderQueue",
  });
});

/**
 * Register (or refresh) the daily scan. Idempotent: safe on every boot and from
 * every instance.
 */
export async function scheduleWorkoutReminderJob(): Promise<void> {
  // Registering a CHANGED cron adds a second schedule and leaves the old one
  // firing — remove any stale schedule for this jobId first.
  const existing = await workoutReminderQueue.getRepeatableJobs();
  for (const job of existing) {
    if (
      job.id === WORKOUT_REMINDER_JOB_ID &&
      job.cron !== WORKOUT_REMINDER_CRON
    ) {
      await workoutReminderQueue.removeRepeatableByKey(job.key);
      logger.info("Removed stale workout reminder schedule", {
        operation: "scheduleWorkoutReminderJob",
        metadata: { staleCron: job.cron, currentCron: WORKOUT_REMINDER_CRON },
      });
    }
  }

  await workoutReminderQueue.add(
    "workout-reminder",
    {},
    {
      repeat: { cron: WORKOUT_REMINDER_CRON },
      jobId: WORKOUT_REMINDER_JOB_ID,
    }
  );

  logger.info("Workout reminder job scheduled", {
    operation: "scheduleWorkoutReminderJob",
    metadata: { cron: WORKOUT_REMINDER_CRON },
  });
}

export async function closeWorkoutReminderQueue(): Promise<void> {
  try {
    await workoutReminderQueue.close();
    logger.info("Workout reminder queue closed gracefully", {
      operation: "workoutReminderQueue",
    });
  } catch (error) {
    logger.error("Error closing workout reminder queue", error as Error, {
      operation: "workoutReminderQueue",
    });
  }
}
