import { Job } from "bull";

import { isWorkoutReminderEnabled } from "@/constants/workout-reminder";
import {
  type ReminderOutcome,
  workoutReminderService,
} from "@/services/workout-reminder.service";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { logger } from "@/utils/logger";

export interface WorkoutReminderResult {
  /** Everyone due at scan time. */
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Why the whole run did nothing, when it did nothing. */
  reason?: "disabled" | "nobody-due";
}

/**
 * Hourly scan: push a reminder to everyone for whom it is now the reminder
 * hour, who has an unstarted session today, and hasn't been reminded today.
 *
 * Sequential, like the email nudges: the list is tiny (one timezone-hour's
 * worth of users), and a serial loop keeps the logs in order.
 */
export async function runWorkoutReminder(): Promise<WorkoutReminderResult> {
  const empty: WorkoutReminderResult = {
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // Kill switch before any database work, so merged-but-unflagged is inert.
  if (!isWorkoutReminderEnabled()) {
    return { ...empty, reason: "disabled" };
  }

  const candidates = await workoutReminderService.getCandidates(
    getCurrentUTCDate()
  );
  if (candidates.length === 0) {
    return { ...empty, reason: "nobody-due" };
  }

  const outcomes: Record<string, number> = {};
  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const outcome: ReminderOutcome =
      await workoutReminderService.send(candidate);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (outcome === "sent") sent += 1;
    else if (outcome === "send-failed") failed += 1;
  }

  const result: WorkoutReminderResult = {
    candidates: candidates.length,
    sent,
    skipped: candidates.length - sent - failed,
    failed,
  };

  logger.info("Workout reminder run complete", {
    operation: "runWorkoutReminder",
    metadata: { ...result, outcomes },
  });

  return result;
}

/** Bull processor. Never throws: a failed run is the next hour's problem. */
export async function processWorkoutReminder(
  _job: Job
): Promise<WorkoutReminderResult> {
  try {
    return await runWorkoutReminder();
  } catch (error) {
    logger.error("Workout reminder job failed", error as Error, {
      operation: "processWorkoutReminder",
    });
    return { candidates: 0, sent: 0, skipped: 0, failed: 0 };
  }
}
