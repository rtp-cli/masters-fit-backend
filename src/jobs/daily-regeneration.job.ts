import { Job } from "bull";
import { logger } from "@/utils/logger";
import { workoutService } from "@/services/workout.service";
import { jobsService } from "@/services/jobs.service";
import { notificationService } from "@/services/notification.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { userService } from "@/services/user.service";
import { profileService } from "@/services/profile.service";
import {
  DailyRegenerationJobData,
  DailyRegenerationJobResult,
  JobStatus,
} from "@/models/jobs.schema";
import { emitProgress } from "@/utils/websocket-progress.utils";

// Check if error is a rate limit error (429) that shouldn't be retried
function isRateLimitError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Check for common rate limit indicators
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded') ||
    message.includes('resource exhausted') ||
    name.includes('ratelimit')
  );
}

// Check if error is non-retryable (rate limit, auth errors, etc.)
function isNonRetryableError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';

  // Rate limit errors
  if (isRateLimitError(error)) return true;

  // Authentication/authorization errors
  if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
    return true;
  }

  // Invalid API key
  if (message.includes('invalid api key') || message.includes('invalid_api_key')) {
    return true;
  }

  return false;
}

export async function processDailyRegenerationJob(
  job: Job<DailyRegenerationJobData & { userId: number; jobId: number }>
): Promise<DailyRegenerationJobResult> {
  logger.info("Daily regeneration job started", {
    operation: "processDailyRegenerationJob",
    bullJobId: job.id,
    jobId: (job.data as any).jobId,
    userId: (job.data as any).userId,
    planDayId: (job.data as any).planDayId,
    metadata: {
      attemptsMade: job.attemptsMade,
      timestamp: new Date().toISOString(),
      processId: process.pid,
    },
  });

  const startTime = Date.now();
  const {
    userId,
    jobId,
    planDayId,
    regenerationReason,
    regenerationStyles,
    threadId,
  } = job.data;

  logger.info("Starting daily workout regeneration job processing", {
    operation: "dailyRegenerationJob",
    jobId: job.id,
    userId,
    planDayId,
    metadata: {
      regenerationReason,
      stylesCount: regenerationStyles?.length || 0,
      startTime: new Date().toISOString(),
    },
  });

  try {
    // Update job status to processing
    try {
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);
    } catch (dbError) {
      logger.error("Failed to update job status to PROCESSING", dbError as Error, {
        operation: "processDailyRegenerationJob",
        jobId,
      });
    }

    // Emit initial progress
    emitProgress(userId, 10);

    // Regenerate daily workout using existing service
    // The service already handles progress updates via emitProgress
    const planDay = await workoutService.regenerateDailyWorkout(
      userId,
      planDayId,
      regenerationReason,
      regenerationStyles,
      threadId
    );

    const generationTime = Date.now() - startTime;

    // Count total exercises in the regenerated day
    const totalExercises = planDay.blocks.reduce((total, block) => {
      return total + block.exercises.length;
    }, 0);

    const result: DailyRegenerationJobResult = {
      planDayId: planDay.id,
      planDayName: planDay.name || `Day ${planDay.dayNumber || 1}`,
      totalExercises,
      generationTimeMs: generationTime,
    };

    // Update job status to completed
    logger.info("Updating job status to COMPLETED", {
      operation: "processDailyRegenerationJob",
      jobId,
      userId,
      planDayId,
      result,
    });

    try {
      await jobsService.updateJobStatus(
        jobId,
        JobStatus.COMPLETED,
        100,
        result
      );
      logger.info("Job status updated to COMPLETED successfully", {
        operation: "processDailyRegenerationJob",
        jobId,
      });
    } catch (dbError) {
      logger.error(
        "Failed to update job status to COMPLETED",
        dbError as Error,
        {
          operation: "processDailyRegenerationJob",
          jobId,
          userId,
          planDayId,
          result,
        }
      );
      // Continue with notification even if database update fails
    }

    // Send push notification
    await notificationService.sendDailyRegenerationNotification(
      userId,
      result.planDayName,
      planDayId
    );

    // Final progress update
    emitProgress(userId, 100, true);

    // Get user and profile data for tracking
    const user = await userService.getUser(userId);
    const userProfile = await profileService.getProfileByUserId(userId);

    // Track successful daily regeneration
    await eventTrackingService.trackWorkoutGenerated(user?.uuid || "", {
      generation_scope: "day",
      workout_style:
        userProfile?.preferredStyles?.join(", ") || "Not specified",
      days_per_week: 1, // Daily regeneration is just one day
      equipment_profile: userProfile?.environment || "Not specified",
      llm_model: userProfile?.aiModel || "",
      regeneration_reason:
        regenerationReason || "User requested daily regeneration",
      generation_time_ms: generationTime,
    });

    logger.info("Daily workout regeneration job completed successfully", {
      operation: "dailyRegenerationJob",
      jobId: job.id,
      userId,
      planDayId,
      metadata: {
        planDayName: result.planDayName,
        generationTimeMs: generationTime,
        totalExercises,
        regenerationReason,
        completedAt: new Date().toISOString(),
      },
    });

    return result;
  } catch (error) {
    const generationTime = Date.now() - startTime;
    // Bull queue attemptsMade: 1=first attempt, 2=first retry, 3=second retry (final)
    const maxAttempts = job.opts.attempts || 3;
    const isLastAttempt = job.attemptsMade === maxAttempts;
    const shouldNotRetry = isNonRetryableError(error as Error);

    logger.error("Daily workout regeneration job failed", error as Error, {
      operation: "dailyRegenerationJob",
      jobId: job.id,
      userId,
      planDayId,
      metadata: {
        generationTimeMs: generationTime,
        regenerationReason,
        errorMessage: (error as Error).message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts || 3,
        isLastAttempt,
        shouldNotRetry,
        isRateLimitError: isRateLimitError(error as Error),
      },
    });

    // Fail immediately on non-retryable errors (rate limits, auth errors) or final attempt
    if (isLastAttempt || shouldNotRetry) {
      if (shouldNotRetry) {
        logger.info("Non-retryable error detected, failing immediately", {
          operation: "dailyRegenerationJob",
          jobId: job.id,
          userId,
          planDayId,
          errorType: isRateLimitError(error as Error) ? "rate_limit" : "non_retryable",
        });
      }
      // Get user and profile data for tracking
      const user = await userService.getUser(userId);
      const userProfile = await profileService.getProfileByUserId(userId);

      // Track failed daily regeneration
      await eventTrackingService.trackWorkoutGenerationFailed(
        user?.uuid || "",
        {
          generation_scope: "day",
          workout_style:
            userProfile?.preferredStyles?.join(", ") || "Not specified",
          days_per_week: 1, // Daily regeneration is just one day
          equipment_profile: userProfile?.environment || "Not specified",
          llm_model: userProfile?.aiModel || "",
          regeneration_reason:
            regenerationReason || "User requested daily regeneration",
          error_type: error.constructor.name,
          failure_reason: (error as Error).message,
          generation_time_ms: generationTime,
        }
      );

      // Update job status to failed
      try {
        await jobsService.updateJobStatus(
          jobId,
          JobStatus.FAILED,
          0,
          undefined,
          undefined,
          (error as Error).message
        );
        logger.info("Job status updated to FAILED successfully", {
          operation: "processDailyRegenerationJob",
          jobId,
        });
      } catch (dbError) {
        logger.error(
          "Failed to update job status to FAILED",
          dbError as Error,
          {
            operation: "processDailyRegenerationJob",
            jobId,
            userId,
            planDayId,
            originalError: (error as Error).message,
          }
        );
      }

      logger.info(
        `Daily workout regeneration job marked as FAILED after final attempt`,
        {
          operation: "dailyRegenerationJob",
          jobId: job.id,
          userId,
          planDayId,
          finalAttempt: job.attemptsMade,
          maxAttempts: job.opts.attempts || 3,
        }
      );

      // Emit error progress
      emitProgress(userId, 0, false, (error as Error).message);

      // Send error notification
      await notificationService.sendWorkoutErrorNotification(
        userId,
        `Daily workout regeneration failed: ${(error as Error).message}`
      );

      // Return error result instead of throwing to avoid Bull queue overriding the FAILED status
      return {
        planDayId: 0,
        planDayName: "Failed Daily Regeneration",
        totalExercises: 0,
        generationTimeMs: Date.now() - startTime,
      } as DailyRegenerationJobResult;
    } else {
      logger.info(
        `Daily workout regeneration job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`,
        {
          operation: "dailyRegenerationJob",
          jobId: job.id,
          userId,
          planDayId,
        }
      );

      // Only throw error for retry attempts
      throw error;
    }
  }
}
