import { Job } from 'bull';
import { logger } from '@/utils/logger';
import { workoutService } from '@/services/workout.service';
import { jobsService } from '@/services/jobs.service';
import { notificationService } from '@/services/notification.service';
import { 
  DailyRegenerationJobData, 
  DailyRegenerationJobResult, 
  JobStatus 
} from '@/models/jobs.schema';
import { emitProgress } from '@/utils/websocket-progress.utils';

export async function processDailyRegenerationJob(
  job: Job<DailyRegenerationJobData & { userId: number; jobId: number }>
): Promise<DailyRegenerationJobResult> {
  const startTime = Date.now();
  const { userId, jobId, planDayId, regenerationReason, regenerationStyles, threadId } = job.data;
  
  logger.info('Starting daily workout regeneration job processing', {
    operation: 'dailyRegenerationJob',
    jobId: job.id,
    userId,
    planDayId,
    metadata: {
      regenerationReason,
      stylesCount: regenerationStyles?.length || 0,
      startTime: new Date().toISOString(),
    }
  });

  try {
    // Update job status to processing
    await jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 10);
    
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
    await jobsService.updateJobStatus(
      jobId, 
      JobStatus.COMPLETED, 
      100, 
      result
    );

    // Send push notification
    await notificationService.sendDailyRegenerationNotification(
      userId,
      result.planDayName,
      planDayId
    );

    // Final progress update
    emitProgress(userId, 100, true);

    logger.info('Daily workout regeneration job completed successfully', {
      operation: 'dailyRegenerationJob',
      jobId: job.id,
      userId,
      planDayId,
      metadata: {
        planDayName: result.planDayName,
        generationTimeMs: generationTime,
        totalExercises,
        regenerationReason,
        completedAt: new Date().toISOString(),
      }
    });

    return result;

  } catch (error) {
    const generationTime = Date.now() - startTime;
    // Bull queue attemptsMade: 1=first attempt, 2=first retry, 3=second retry (final)  
    const maxAttempts = job.opts.attempts || 3;
    const isLastAttempt = job.attemptsMade === maxAttempts;
    
    logger.error('Daily workout regeneration job failed', error as Error, {
      operation: 'dailyRegenerationJob',
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
      }
    });

    // Only update to failed status and send notifications on the final attempt
    if (isLastAttempt) {
      // Update job status to failed
      await jobsService.updateJobStatus(
        jobId, 
        JobStatus.FAILED, 
        0, 
        undefined, 
        undefined,
        (error as Error).message
      );

      logger.info(`Daily workout regeneration job marked as FAILED after final attempt`, {
        operation: 'dailyRegenerationJob',
        jobId: job.id,
        userId,
        planDayId,
        finalAttempt: job.attemptsMade,
        maxAttempts: job.opts.attempts || 3,
      });

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
        planDayName: 'Failed Daily Regeneration',
        totalExercises: 0,
        generationTimeMs: Date.now() - startTime,
      } as DailyRegenerationJobResult;
    } else {
      logger.info(`Daily workout regeneration job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`, {
        operation: 'dailyRegenerationJob',
        jobId: job.id,
        userId,
        planDayId,
      });
      
      // Only throw error for retry attempts
      throw error;
    }
  }
}