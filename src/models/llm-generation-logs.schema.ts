import { integer, pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./user.schema";

export const llmGenerationLogs = pgTable(
  "llm_generation_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(), // e.g. "generateWeeklyWorkout", "regenerateWorkout"
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // Actual per-phase model for generateWeeklyWorkout's fan-out (planning
    // call vs. day calls) — `model` above is the user's profile selection,
    // which the fan-out path overrides on Anthropic. Null for
    // regenerateWorkout, where `model` is already the model that ran.
    planningModel: text("planning_model"),
    dayModel: text("day_model"),
    llmDurationMs: integer("llm_duration_ms").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_llm_gen_logs_user_id").on(table.userId),
    createdAtIdx: index("idx_llm_gen_logs_created_at").on(table.createdAt),
    providerModelIdx: index("idx_llm_gen_logs_provider_model").on(table.provider, table.model),
  })
);

export const insertLlmGenerationLogSchema = createInsertSchema(llmGenerationLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertLlmGenerationLog = typeof llmGenerationLogs.$inferInsert;
export type LlmGenerationLog = typeof llmGenerationLogs.$inferSelect;
