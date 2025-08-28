import { Job } from 'bull';
import { logger } from '@/utils/logger';
import { workoutService } from '@/services/workout.service';
import { jobsService } from '@/services/jobs.service';
import { notificationService } from '@/services/notification.service';
import { 
  WorkoutRegenerationJobData, 
  WorkoutRegenerationJobResult, 
  JobStatus 
} from '@/models/jobs.schema';
import { emitProgress } from '@/utils/websocket-progress.utils';

export async function processWorkoutRegenerationJob(
  job: Job<WorkoutRegenerationJobData & { userId: number; jobId: number }>
): Promise<WorkoutRegenerationJobResult> {
  const startTime = Date.now();
  const { userId, jobId, customFeedback, profileData } = job.data;
  
  logger.info('Starting workout regeneration job processing', {
    operation: 'workoutRegenerationJob',
    jobId: job.id,
    userId,
    metadata: {
      hasCustomFeedback: !!customFeedback,
      hasProfileData: !!profileData,
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

    // Get current active workout before regeneration (for reference)
    const previousActiveWorkout = await workoutService.fetchActiveWorkout(userId);
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
      return total + day.blocks.reduce((blockTotal, block) => {
        return blockTotal + block.exercises.length;
      }, 0);
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

    logger.info('Workout regeneration job completed successfully', {
      operation: 'workoutRegenerationJob',
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
      }
    });

    return result;

  } catch (error) {
    const generationTime = Date.now() - startTime;
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts || 3);
    
    logger.error('Workout regeneration job failed', error as Error, {
      operation: 'workoutRegenerationJob',
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
        `Workout regeneration failed: ${(error as Error).message}`
      );
    } else {
      logger.info(`Workout regeneration job will retry (attempt ${job.attemptsMade}/${job.opts.attempts || 3})`, {
        operation: 'workoutRegenerationJob',
        jobId: job.id,
        userId,
      });
    }

    throw error;
  }
}