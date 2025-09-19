import { createClient } from 'redis';
import { logger } from './logger';

export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: 60000,
    ...(process.env.REDIS_URL?.startsWith('rediss://') && {
      tls: true,
      rejectUnauthorized: false,
    }),
  },
});

redisClient.on('error', (error) => {
  logger.error('Redis connection error', error, {
    operation: 'redisConnection',
  });
});

redisClient.on('connect', () => {
  logger.info('Redis connected successfully', {
    operation: 'redisConnection',
  });
});

redisClient.on('ready', () => {
  logger.info('Redis ready for commands', {
    operation: 'redisConnection',
  });
});

redisClient.on('end', () => {
  logger.info('Redis connection closed', {
    operation: 'redisConnection',
  });
});

// Initialize Redis connection
export async function initializeRedis() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis', error as Error, {
      operation: 'initializeRedis',
    });
    throw error;
  }
}

// Graceful shutdown
export async function closeRedis() {
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    logger.error('Error closing Redis connection', error as Error, {
      operation: 'closeRedis',
    });
  }
}