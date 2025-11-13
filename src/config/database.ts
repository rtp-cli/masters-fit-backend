import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/models";
import dotenv from "dotenv";
import { logger } from "@/utils/logger.js";

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?\n" +
      "Make sure you have a .env file in the server directory with DATABASE_URL set.\n" +
      "For local development, use: DATABASE_URL=postgresql://localhost:5432/mastersfit"
  );
}

// Enhanced pool configuration for better connection resilience
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Connection pool settings for resilience
  min: 2, // minimum number of connections in pool
  max: 20, // maximum number of connections in pool
  idleTimeoutMillis: 30000, // close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // return error after 10 seconds if connection cannot be established
  acquireTimeoutMillis: 60000, // return error after 60 seconds if connection cannot be acquired from pool
  // Retry configuration
  statement_timeout: 30000, // 30 second timeout for statements
  query_timeout: 30000, // 30 second timeout for queries
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Add connection event handlers for monitoring and logging
pool.on("connect", (client) => {
  logger.info("New database client connected", {
    metadata: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    },
  });
});

pool.on("error", (err, client) => {
  logger.error("Unexpected error on idle database client", err, {
    metadata: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    },
  });
});

pool.on("remove", (client) => {
  logger.info("Database client removed from pool", {
    metadata: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    },
  });
});

export const db = drizzle(pool, { schema });

// Add graceful shutdown handler
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, closing database connections...");
  await pool.end();
  logger.info("Database connections closed");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, closing database connections...");
  await pool.end();
  logger.info("Database connections closed");
  process.exit(0);
});
