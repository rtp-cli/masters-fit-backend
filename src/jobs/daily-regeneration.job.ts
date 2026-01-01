import { Job } from "bull";
import { logger } from "@/utils/logger";
import { workoutService } from "@/services/workout.service";
import { jobsService } from "@/services/jobs.service";
import { notificationService } from "@/services/notification.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { userService } from "@/services/user.service";
import { profileService } from "@/services/profile.service";
import { subscriptionService } from "@/services/subscription.service";
import {
  getLastTokenUsage,
  clearLastTokenUsage,
} from "@/services/prompts.service";
import {
  DailyRegenerationJobData,
  DailyRegenerationJobResult,
  JobStatus,
} from "@/models/jobs.schema";
import { emitProgress } from "@/utils/websocket-progress.utils";
import { AccessLevel } from "@/constants";

export async function processDailyRegenerationJob(
  job: Job<DailyRegenerationJobData & { userId: number; jobId: number }>
): Promise<DailyRegenerationJobResult> {
  logger.info("Daily regeneration job picked up by worker", {
    operation: "processDailyRegenerationJob",
    bullJobId: job.id.toString(),
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
    jobId: jobId,
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
    logger.info("Updating job status to PROCESSING", {
      operation: "processDailyRegenerationJob",
      jobId,
      userId,
      planDayId,
    });

    try {
      await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);
      logger.info("Job status updated to PROCESSING successfully", {
        operation: "processDailyRegenerationJob",
        jobId,
      });
    } catch (dbError) {
      logger.error(
        "Failed to update job status to PROCESSING",
        dbError as Error,
        {
          operation: "processDailyRegenerationJob",
          jobId,
          userId,
          planDayId,
        }
      );
      // Continue processing even if database update fails
    }

    // Emit initial progress
    emitProgress(userId, 10);

    // Check subscription limits before regeneration
    const accessLevel =
      await subscriptionService.getEffectiveAccessLevel(userId);
    const estimatedTokens = (job.data as any)?.estimatedTokens || 2000; // Default estimate

    if (accessLevel !== AccessLevel.UNLIMITED) {
      const limitCheck = await subscriptionService.checkTrialLimits(
        userId,
        "regeneration",
        estimatedTokens,
        "daily"
      );
      if (!limitCheck.allowed) {
        const errorMessage =
          limitCheck.reason || "Daily regeneration limit exceeded";
        logger.warn(
          "Daily workout regeneration blocked by subscription limits",
          {
            operation: "dailyRegenerationJob",
            jobId: jobId,
            userId,
            planDayId,
            reason: errorMessage,
            limits: limitCheck.limits,
          }
        );

        // Update job status to failed with paywall reason
        await jobsService.updateJobStatus(
          jobId,
          JobStatus.FAILED,
          0,
          undefined,
          undefined,
          errorMessage
        );

        emitProgress(userId, 0, false, errorMessage);

        // Send error notification
        await notificationService.sendWorkoutErrorNotification(
          userId,
          `Daily workout regeneration failed: ${errorMessage}`
        );

        // Return error result without consuming retry attempts
        return {
          planDayId: planDayId,
          totalExercises: 0,
          generationTimeMs: Date.now() - startTime,
        } as DailyRegenerationJobResult;
      }
    }

    // Clear any previous token usage before regeneration
    clearLastTokenUsage(userId);

    // Regenerate daily workout using existing service
    // The service already handles progress updates via emitProgress
    const planDay = await workoutService.regenerateDailyWorkout(
      userId,
      planDayId,
      regenerationReason,
      regenerationStyles,
      threadId
    );

    // Get real token usage from regeneration (or fallback to estimate)
    const tokenUsage = getLastTokenUsage(userId);
    const actualTokensUsed = tokenUsage?.totalTokens || estimatedTokens;

    logger.info("Daily regeneration job completed with token usage", {
      userId,
      jobId,
      planDayId,
      operation: "dailyRegenerationJob",
      tokenUsage: tokenUsage || { estimated: estimatedTokens },
      actualTokensUsed,
    });

    // Increment usage after successful regeneration with real token count
    if (accessLevel !== AccessLevel.UNLIMITED) {
      await subscriptionService.incrementTrialUsage(
        userId,
        "regeneration",
        actualTokensUsed,
        "daily"
      );
    }

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
      jobId: jobId,
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

    logger.error("Daily workout regeneration job failed", error as Error, {
      operation: "dailyRegenerationJob",
      jobId: jobId,
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
      },
    });

    // Only update to failed status and send notifications on the final attempt
    if (isLastAttempt) {
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
          error_type: (error as Error).constructor.name,
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
