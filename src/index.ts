// Sentry must be imported first to auto-instrument Express, pg, Redis, etc.
import "./instrument";

import app from "./app";
import { logger } from "./utils/logger";
import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { setSocketIOInstance } from "./utils/websocket-progress.utils";
import { initializeRedis, closeRedis } from "./utils/redis";
import { workoutGenerationQueue, closeWorkoutGenerationQueue } from "./queues/workout-generation.queue";
import { processWorkoutGenerationJob } from "./jobs/workout-generation.job";
import { processWorkoutRegenerationJob } from "./jobs/workout-regeneration.job";
import { processDailyRegenerationJob } from "./jobs/daily-regeneration.job";

const port = parseInt(process.env.PORT || "5000", 10);

// Create HTTP server
const server = createServer(app);

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Join user-specific room for targeted messaging
  socket.on('join-user-room', (userId: number) => {
    socket.join(`user-${userId}`);
  });

  socket.on('disconnect', () => {
    // Silent disconnect
  });
});

// Export io instance for use in other modules
export { io };

// Set up progress utility with io instance
setSocketIOInstance(io);

// Initialize services
async function initializeServices() {
  try {
    // Initialize Redis
    await initializeRedis();

    // Attach Redis adapter to Socket.IO so events broadcast across all
    // Render instances (including during zero-downtime deploys where two
    // instances briefly overlap, and when the job processor runs on a
    // different instance than the connected client).
    const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: { ...(process.env.REDIS_URL?.startsWith('rediss://') && { tls: true, rejectUnauthorized: false }) }
    });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter attached');
    logger.info('Redis initialized successfully');

    // Bull's built-in stall checker handles jobs that were active when a
    // worker died — no manual cleanup needed. Forcibly moving active jobs to
    // failed here causes duplicate processing during zero-downtime deploys:
    // the old instance continues its job while the new instance re-queues and
    // processes it a second time.

    // Register queue processors
    workoutGenerationQueue.process('generate-workout', 10, processWorkoutGenerationJob);
    workoutGenerationQueue.process('regenerate-workout', 10, processWorkoutRegenerationJob);
    workoutGenerationQueue.process('regenerate-daily-workout', 10, processDailyRegenerationJob);

    // Ensure queue is running
    await workoutGenerationQueue.resume();

    logger.info('Workout generation queue processors started', {
      operation: 'initializeServices',
      metadata: {
        processors: ['generate-workout', 'regenerate-workout', 'regenerate-daily-workout'],
        concurrency: 10,
      }
    });

  } catch (error) {
    logger.error('Failed to initialize services', error as Error);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated');
  
  try {
    // Close queue
    await closeWorkoutGenerationQueue();
    
    // Close Redis
    await closeRedis();
    
    // Close HTTP server
    server.close(() => {
      logger.info('Server closed successfully');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server.listen(port, "0.0.0.0", async () => {
  logger.info("Server started successfully", {
    operation: "serverStart",
    metadata: {
      port,
      environment: process.env.NODE_ENV || "development",
      docsUrl: `${process.env.API_URL}:${port}/api/docs`,
      websocket: "enabled"
    },
  });
  
  // Initialize background services
  await initializeServices();
});

export default app;
