import Queue from 'bull';
import { logger } from '@/utils/logger';
import { WorkoutGenerationJobData, WorkoutGenerationJobResult } from '@/models/jobs.schema';

// Create the workout generation queue
export const workoutGenerationQueue = new Queue<WorkoutGenerationJobData>('workout generation', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  defaultJobOptions: {
    removeOnComplete: 50, // Keep last 50 completed jobs
    removeOnFail: 20,     // Keep last 20 failed jobs
    attempts: 3,          // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: 5000,        // Start with 5 second delay, then exponential backoff
    },
  },
});

// Queue event handlers
workoutGenerationQueue.on('ready', () => {
  logger.info('Workout generation queue is ready', {
    operation: 'workoutQueue',
    queueName: 'workout generation',
  });
});

workoutGenerationQueue.on('error', (error) => {
  logger.error('Workout generation queue error', error, {
    operation: 'workoutQueue',
    queueName: 'workout generation',
  });
});

workoutGenerationQueue.on('waiting', (jobId) => {
  logger.info('Job waiting in workout generation queue', {
    operation: 'workoutQueue',
    jobId,
    status: 'waiting',
  });
});

workoutGenerationQueue.on('active', (job) => {
  logger.info('Job started processing in workout generation queue', {
    operation: 'workoutQueue',
    bullJobId: job.id,
    userId: (job.data as any).userId,
    status: 'active',
  });
});

workoutGenerationQueue.on('completed', (job, result: WorkoutGenerationJobResult) => {
  logger.info('Job completed in workout generation queue', {
    operation: 'workoutQueue',
    bullJobId: job.id,
    userId: (job.data as any).userId,
    workoutId: result.workoutId,
    generationTime: result.generationTimeMs,
    status: 'completed',
  });
});

workoutGenerationQueue.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts || 3;
  const isLastAttempt = job?.attemptsMade === maxAttempts;
  
  if (isLastAttempt) {
    logger.error('Bull Queue: Job failed after all attempts', error, {
      operation: 'workoutQueue',
      metadata: {
        bullJobId: job?.id,
        dbJobId: (job?.data as any)?.jobId,
        userId: (job?.data as any)?.userId,
        attempts: job?.attemptsMade,
        maxAttempts,
        status: 'failed',
      },
    });
    
    // Only update database status on final failure
    if ((job?.data as any)?.jobId) {
      try {
        const { jobsService } = await import('@/services/jobs.service');
        const { JobStatus } = await import('@/models/jobs.schema');
        
        const dbJob = await jobsService.getJob((job.data as any).jobId);
        if (dbJob && dbJob.status !== JobStatus.FAILED && dbJob.status !== JobStatus.COMPLETED) {
          logger.warn('Bull Queue Fallback: Job processor missed final attempt, updating database status manually', {
            operation: 'workoutQueue',
            bullJobId: job.id,
            dbJobId: job.data.jobId,
            dbStatus: dbJob.status,
          });
          
          await jobsService.updateJobStatus(
            job.data.jobId, 
            JobStatus.FAILED, 
            0, 
            undefined, 
            undefined,
            error.message
          );
        }
      } catch (fallbackError) {
        logger.error('Bull Queue Fallback: Failed to update job status', fallbackError as Error, {
          operation: 'workoutQueue',
          bullJobId: job?.id,
          dbJobId: job?.data?.jobId,
        });
      }
    }
  } else {
    // Just log retry attempts without updating database
    logger.info('Bull Queue: Job failed but will retry', {
      operation: 'workoutQueue',
      bullJobId: job?.id,
      dbJobId: job?.data?.jobId,
      userId: job?.data?.userId,
      attempts: job?.attemptsMade,
      maxAttempts,
      retryNumber: job?.attemptsMade,
      remainingAttempts: maxAttempts - (job?.attemptsMade || 0),
      status: 'retrying',
    });
  }
});

workoutGenerationQueue.on('stalled', (job) => {
  logger.warn('Job stalled in workout generation queue', {
    operation: 'workoutQueue',
    jobId: job.id,
    userId: job.data.userId,
    status: 'stalled',
  });
});

// Graceful shutdown
export async function closeWorkoutGenerationQueue() {
  try {
    await workoutGenerationQueue.close();
    logger.info('Workout generation queue closed gracefully', {
      operation: 'workoutQueue',
    });
  } catch (error) {
    logger.error('Error closing workout generation queue', error as Error, {
      operation: 'workoutQueue',
    });
  }
}