import { Job } from "bull";
import { logger } from "@/utils/logger";
import { workoutService } from "@/services/workout.service";
import { jobsService } from "@/services/jobs.service";
import { notificationService } from "@/services/notification.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { userService } from "@/services/user.service";
import { profileService } from "@/services/profile.service";
import {
  WorkoutRegenerationJobData,
  WorkoutRegenerationJobResult,
  JobStatus,
} from "@/models/jobs.schema";
import { emitProgress } from "@/utils/websocket-progress.utils";

export async function processWorkoutRegenerationJob(
  job: Job<WorkoutRegenerationJobData & { userId: number; jobId: number }>
): Promise<WorkoutRegenerationJobResult> {
  const startTime = Date.now();
  const { userId, jobId, customFeedback, profileData } = job.data;

  logger.info("Starting workout regeneration job processing", {
    operation: "workoutRegenerationJob",
    jobId: job.id,
    userId,
    metadata: {
      hasCustomFeedback: !!customFeedback,
      hasProfileData: !!profileData,
      startTime: new Date().toISOString(),
    },
  });

  try {
    // Update job status to processing
    await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 5);

    // Emit initial progress
    emitProgress(userId, 5);

    // Update profile if provided
    if (profileData) {
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);
      emitProgress(userId, 10);
    }

    // Get current active workout before regeneration (for reference)
    const previousActiveWorkout =
      await workoutService.fetchActiveWorkout(userId);
    const previousWorkoutId = previousActiveWorkout?.id;

    // Regenerate workout using existing service
    // The service internally calls generateWorkoutPlan which handles progress updates
    const workout = await workoutService.regenerateWorkoutPlan(
      userId,
      customFeedback,
      profileData
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

    const result: WorkoutRegenerationJobResult = {
      workoutId: workout.id,
      workoutName: workout.name,
      planDaysCount: workout.planDays.length,
      totalExercises,
      generationTimeMs: generationTime,
      previousWorkoutId,
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
    await notificationService.sendWorkoutRegenerationNotification(
      userId,
      workout.name,
      workout.id
    );

    // Final progress update
    emitProgress(userId, 100, true);

    // Get user and profile data for tracking
    const user = await userService.getUser(userId);
    const userProfile = await profileService.getProfileByUserId(userId);

    // Track successful workout regeneration
    await eventTrackingService.trackWorkoutGenerated(user?.uuid || "", {
      generation_scope: "week",
      workout_style:
        userProfile?.preferredStyles?.join(", ") || "Not specified",
      days_per_week: workout.planDays.length,
      equipment_profile: userProfile?.environment || "Not specified",
      llm_model: userProfile?.aiModel || "",
      regeneration_reason: customFeedback || "User requested regeneration",
      generation_time_ms: generationTime,
    });

    logger.info("Workout regeneration job completed successfully", {
      operation: "workoutRegenerationJob",
      jobId: job.id,
      userId,
      metadata: {
        workoutId: workout.id,
        workoutName: workout.name,
        generationTimeMs: generationTime,
        totalExercises,
        planDaysCount: workout.planDays.length,
        previousWorkoutId,
        completedAt: new Date().toISOString(),
      },
    });

    return result;
  } catch (error) {
    const generationTime = Date.now() - startTime;
    // Bull queue attemptsMade: 1=first attempt, 2=first retry, 3=second retry (final)
    const maxAttempts = job.opts.attempts || 3;
    const isLastAttempt = job.attemptsMade === maxAttempts;

    logger.error("Workout regeneration job failed", error as Error, {
      operation: "workoutRegenerationJob",
      jobId: job.id,
      userId,
      metadata: {
        generationTimeMs: generationTime,
        errorMessage: (error as Error).message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts || 3,
        isLastAttempt,
      },
    });

    // Only update to failed status and send notifications on the final attempt
    if (isLastAttempt) {
      // Get user and profile data for tracking
      const user = await userService.getUser(userId);
      const userProfile = await profileService.getProfileByUserId(userId);

      // Track failed workout regeneration
      await eventTrackingService.trackWorkoutGenerationFailed(
        user?.uuid || "",
        {
          generation_scope: "week",
          workout_style:
            userProfile?.preferredStyles?.join(", ") || "Not specified",
          days_per_week: userProfile?.availableDays?.length || 0,
          equipment_profile: userProfile?.environment || "Not specified",
          llm_model: userProfile?.aiModel || "",
          regeneration_reason: customFeedback || "User requested regeneration",
          error_type: error.constructor.name,
          failure_reason: (error as Error).message,
          generation_time_ms: generationTime,
        }
      );

      // Update job status to failed
      await jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        0,
        undefined,
        undefined,
        (error as Error).message
      );

      logger.info(
        `Workout regeneration job marked as FAILED after final attempt`,
        {
          operation: "workoutRegenerationJob",
          jobId: job.id,
          userId,
          finalAttempt: job.attemptsMade,
          maxAttempts: job.opts.attempts || 3,
        }
      );

      // Emit error progress
      emitProgress(userId, 0, false, (error as Error).message);

      // Send error notification
      await notificationService.sendWorkoutErrorNotification(
        userId,
        `Workout regeneration failed: ${(error as Error).message}`
      );

      // Return error result instead of throwing to avoid Bull queue overriding the FAILED status
      return {
        workoutId: 0,
        workoutName: "Failed Regeneration",
        planDaysCount: 0,
        totalExercises: 0,
        generationTimeMs: Date.now() - startTime,
      } as WorkoutRegenerationJobResult;
    } else {
      logger.info(
        `Workout regeneration job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`,
        {
          operation: "workoutRegenerationJob",
          jobId: job.id,
          userId,
        }
      );

      // Only throw error for retry attempts
      throw error;
    }
  }
}
