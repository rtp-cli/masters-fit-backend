import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// AuthCodes table
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  code: text("code").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").default(false).notNull(),
  // §4.3 rate-limit: failed verify attempts against this code; invalidated at 5.
  attempts: integer("attempts").default(0).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Schema for insert operations
export const insertAuthCodeSchema = createInsertSchema(authCodes).pick({
  email: true,
  code: true,
  expires_at: true,
});

// Types - Explicit interface for TSOA compatibility
export interface AuthCode {
  id: number;
  email: string;
  code: string;
  expires_at: Date;
  used: boolean;
  attempts: number;
  created_at: Date;
}

export type InsertAuthCode = z.infer<typeof insertAuthCodeSchema>;
