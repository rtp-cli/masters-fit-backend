import { Job } from 'bull';
import { logger } from '@/utils/logger';
import { workoutService } from '@/services/workout.service';
import { jobsService } from '@/services/jobs.service';
import { notificationService } from '@/services/notification.service';
import { 
  WorkoutGenerationJobData, 
  WorkoutGenerationJobResult, 
  JobStatus 
} from '@/models/jobs.schema';
import { emitProgress } from '@/utils/websocket-progress.utils';

export async function processWorkoutGenerationJob(
  job: Job<WorkoutGenerationJobData & { userId: number; jobId: number }>
): Promise<WorkoutGenerationJobResult> {
  const startTime = Date.now();
  const { userId, jobId, customFeedback, timezone, profileData } = job.data;
  
  logger.info('Starting workout generation job processing', {
    operation: 'workoutGenerationJob',
    jobId: job.id,
    userId,
    metadata: {
      hasCustomFeedback: !!customFeedback,
      hasProfileData: !!profileData,
      timezone,
      startTime: new Date().toISOString(),
    }
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
      return total + day.blocks.reduce((blockTotal, block) => {
        return blockTotal + block.exercises.length;
      }, 0);
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

    logger.info('Workout generation job completed successfully', {
      operation: 'workoutGenerationJob',
      jobId: job.id,
      userId,
      metadata: {
        workoutId: workout.id,
        workoutName: workout.name,
        generationTimeMs: generationTime,
        totalExercises,
        planDaysCount: workout.planDays.length,
        completedAt: new Date().toISOString(),
      }
    });

    return result;

  } catch (error) {
    const generationTime = Date.now() - startTime;
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts || 3);
    
    logger.error('Workout generation job failed', error as Error, {
      operation: 'workoutGenerationJob',
      jobId: job.id,
      userId,
      metadata: {
        generationTimeMs: generationTime,
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

      // Emit error progress
      emitProgress(userId, 0, false, (error as Error).message);

      // Send error notification
      await notificationService.sendWorkoutErrorNotification(
        userId,
        (error as Error).message
      );
    } else {
      logger.info(`Workout generation job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`, {
        operation: 'workoutGenerationJob',
        jobId: job.id,
        userId,
      });
    }

    throw error;
  }
}