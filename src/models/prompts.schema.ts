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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPromptSchema = createInsertSchema(prompts).pick({
  userId: true,
  prompt: true,
  response: true,
});

export type Prompt = typeof prompts.$inferSelect;
export type InsertPrompt = z.infer<typeof insertPromptSchema>;
