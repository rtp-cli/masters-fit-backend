import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models";

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  threadId: text("thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertPromptSchema = createInsertSchema(prompts).pick({
  userId: true,
  prompt: true,
  response: true,
  threadId: true,
});

// Types - Explicit interface for TSOA compatibility
export interface Prompt {
  id: number;
  userId: number;
  prompt: string;
  response: string;
  threadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertPrompt = z.infer<typeof insertPromptSchema>;
