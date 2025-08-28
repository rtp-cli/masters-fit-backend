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
    jobId: job.id,
    userId: job.data.userId,
    status: 'active',
  });
});

workoutGenerationQueue.on('completed', (job, result: WorkoutGenerationJobResult) => {
  logger.info('Job completed in workout generation queue', {
    operation: 'workoutQueue',
    jobId: job.id,
    userId: job.data.userId,
    workoutId: result.workoutId,
    generationTime: result.generationTimeMs,
    status: 'completed',
  });
});

workoutGenerationQueue.on('failed', (job, error) => {
  logger.error('Job failed in workout generation queue', error, {
    operation: 'workoutQueue',
    jobId: job?.id,
    userId: job?.data?.userId,
    attempts: job?.attemptsMade,
    status: 'failed',
  });
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