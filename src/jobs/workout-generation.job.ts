import { Job } from "bull";
import { logger } from "@/utils/logger";
import { workoutService } from "@/services/workout.service";
import { jobsService } from "@/services/jobs.service";
import { notificationService } from "@/services/notification.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { userService } from "@/services/user.service";
import { profileService } from "@/services/profile.service";
import {
  WorkoutGenerationJobData,
  WorkoutGenerationJobResult,
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

export async function processWorkoutGenerationJob(
  job: Job<WorkoutGenerationJobData & { userId: number; jobId: number }>
): Promise<WorkoutGenerationJobResult> {
  logger.info("Workout generation job started", {
    operation: "processWorkoutGenerationJob",
    bullJobId: job.id,
    jobId: (job.data as any).jobId,
    userId: (job.data as any).userId,
    metadata: {
      attemptsMade: job.attemptsMade,
      timestamp: new Date().toISOString(),
      processId: process.pid,
    },
  });

  const startTime = Date.now();
  const { userId, jobId, customFeedback, timezone, profileData } = job.data;

  logger.info("Starting workout generation job processing", {
    operation: "workoutGenerationJob",
    jobId: job.id,
    userId,
    metadata: {
      hasCustomFeedback: !!customFeedback,
      hasProfileData: !!profileData,
      timezone,
      startTime: new Date().toISOString(),
    },
  });

  try {
    // Update job status to processing
    try {
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 5);
    } catch (dbError) {
      logger.error("Failed to update job status to PROCESSING", dbError as Error, {
        operation: "processWorkoutGenerationJob",
        jobId,
      });
    }

    // Emit initial progress
    emitProgress(userId, 5);

    // Update profile if provided
    if (profileData) {
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);
      emitProgress(userId, 10);
    }

    // Generate workout using existing service
    // The service already handles progress updates via emitProgress
    const workout = await workoutService.generateWorkoutPlan(
      userId,
      customFeedback,
      timezone
    );

    const generationTime = Date.now() - startTime;

    // Count total exercises
    const totalExercises = workout.planDays.reduce((total, day) => {
      return (
        total +
        day.blocks.reduce((blockTotal, block) => {
          return blockTotal + block.exercises.length;
        }, 0)
      );
    }, 0);

    const result: WorkoutGenerationJobResult = {
      workoutId: workout.id,
      workoutName: workout.name,
      planDaysCount: workout.planDays.length,
      totalExercises,
      generationTimeMs: generationTime,
    };

    // Update job status to completed
    await jobsService.updateJobStatus(
      jobId,
      JobStatus.COMPLETED,
      100,
      result,
      workout.id
    );

    // Send push notification
    await notificationService.sendWorkoutCompletionNotification(
      userId,
      workout.name,
      workout.id
    );

    // Final progress update
    emitProgress(userId, 100, true);

    // Get user and profile data for tracking
    const user = await userService.getUser(userId);
    const userProfile = await profileService.getProfileByUserId(userId);

    // Track successful workout generation
    await eventTrackingService.trackWorkoutGenerated(user?.uuid || "", {
      generation_scope: "week",
      workout_style:
        userProfile?.preferredStyles?.join(", ") || "Not specified",
      days_per_week: workout.planDays.length,
      equipment_profile: userProfile?.environment || "Not specified",
      llm_model: userProfile?.aiModel || "",
      regeneration_reason: customFeedback,
    });

    logger.info("Workout generation job completed successfully", {
      operation: "workoutGenerationJob",
      jobId: job.id,
      userId,
      metadata: {
        workoutId: workout.id,
        workoutName: workout.name,
        generationTimeMs: generationTime,
        totalExercises,
        planDaysCount: workout.planDays.length,
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

    logger.error("Workout generation job failed", error as Error, {
      operation: "workoutGenerationJob",
      jobId: job.id,
      userId,
      metadata: {
        generationTimeMs: generationTime,
        errorMessage: (error as Error).message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        maxAttempts,
        isLastAttempt,
        shouldNotRetry,
        isRateLimitError: isRateLimitError(error as Error),
      },
    });

    // Fail immediately on non-retryable errors (rate limits, auth errors) or final attempt
    if (isLastAttempt || shouldNotRetry) {
      if (shouldNotRetry) {
        logger.info("Non-retryable error detected, failing immediately", {
          operation: "workoutGenerationJob",
          jobId: job.id,
          userId,
          errorType: isRateLimitError(error as Error) ? "rate_limit" : "non_retryable",
        });
      }
      // Get user and profile data for tracking
      const user = await userService.getUser(userId);
      const userProfile = await profileService.getProfileByUserId(userId);

      // Track failed workout generation
      await eventTrackingService.trackWorkoutGenerationFailed(
        user?.uuid || "",
        {
          generation_scope: "week",
          error: `${error.constructor.name}: ${(error as Error).message}`,
          llm_model: userProfile?.aiModel || "",
        }
      );

      // Update job status to failed
      const updatedJob = await jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        0,
        undefined,
        undefined,
        (error as Error).message
      );

      // Verify the update worked
      const verifyJob = await jobsService.getJob(jobId);

      logger.info(
        `Workout generation job marked as FAILED after final attempt`,
        {
          operation: "workoutGenerationJob",
          jobId: job.id,
          userId,
          finalAttempt: job.attemptsMade,
          maxAttempts: job.opts.attempts || 3,
          dbStatusAfterUpdate: verifyJob?.status,
          updateResult: updatedJob?.status,
        }
      );

      // Emit error progress
      emitProgress(userId, 0, false, (error as Error).message);

      // Send error notification
      await notificationService.sendWorkoutErrorNotification(
        userId,
        (error as Error).message
      );

      // Return error result instead of throwing to avoid Bull queue overriding the FAILED status
      return {
        workoutId: 0,
        workoutName: "Failed Generation",
        planDaysCount: 0,
        totalExercises: 0,
        generationTimeMs: Date.now() - startTime,
      } as WorkoutGenerationJobResult;
    } else {
      logger.info(
        `Workout generation job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`,
        {
          operation: "workoutGenerationJob",
          jobId: job.id,
          userId,
        }
      );

      // Keep job status as PROCESSING during retries
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);

      // Emit retry progress update (not error)
      emitProgress(userId, 10, false, undefined);

      // Only throw error for retry attempts
      throw error;
    }
  }
}
