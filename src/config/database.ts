import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/models";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?\n" +
      "Make sure you have a .env file in the server directory with DATABASE_URL set.\n" +
      "For local development, use: DATABASE_URL=postgresql://localhost:5432/mastersfit"
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
