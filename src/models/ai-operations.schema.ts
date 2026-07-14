import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "@/models/user.schema";
import { workouts } from "@/models/workout.schema";
import { backgroundJobs } from "@/models/jobs.schema";
import type {
  AiOperationType,
  AiOperationStatus,
  AccessTier,
} from "@/constants/access-policy";

/**
 * Append-oriented ledger of every AI-backed operation. Authoritative record
 * for: free-allowance counting, idempotency/duplicate suppression, operation
 * lifecycle (reserved -> completed|failed), token + cost accounting, and
 * linkage to the resulting workout. Replaces the workout-row-existence gate
 * and the divergent trial_usage.tokensUsed counter.
 *
 * Lifetime free-allowance usage is derived (no separate counters table):
 *   COUNT(*) WHERE userId=? AND operationType=? AND status IN ('reserved',
 *   'completed') AND countedAgainstFreeAllowance = true
 * consumed atomically inside a `SELECT ... FOR UPDATE` on the user's
 * user_subscriptions row (R-1) plus the UNIQUE(idempotencyKey) guard.
 */
export const aiOperations = pgTable(
  "ai_operations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull().$type<AiOperationType>(),
    status: text("status").notNull().$type<AiOperationStatus>(),
    // Client-supplied per-action key; makes double-tap / timeout-retry safe.
    idempotencyKey: text("idempotency_key").notNull(),
    backgroundJobId: integer("background_job_id").references(
      () => backgroundJobs.id
    ),
    accessTierAtRequest: text("access_tier_at_request")
      .notNull()
      .$type<AccessTier>(),
    // True when this op consumed a FREE lifetime allowance (tier==FREE at reserve).
    countedAgainstFreeAllowance: boolean("counted_against_free_allowance")
      .notNull()
      .default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    model: text("model"),
    provider: text("provider"),
    // Internal only — never surfaced to users. Computed from per-model rates.
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 6,
    }),
    resultWorkoutId: integer("result_workout_id").references(() => workouts.id),
    failureCode: text("failure_code"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    // Idempotency: one operation per intentional user action.
    idempotencyKeyUnique: uniqueIndex("uq_ai_operations_idempotency_key").on(
      table.idempotencyKey
    ),
    // Allowance counting + status sweeps.
    userOpStatusIdx: index("idx_ai_operations_user_op_status").on(
      table.userId,
      table.operationType,
      table.status
    ),
    statusIdx: index("idx_ai_operations_status").on(table.status),
  })
);

export const insertAiOperationSchema = createInsertSchema(aiOperations).omit({
  id: true,
  createdAt: true,
});

export type InsertAiOperation = typeof aiOperations.$inferInsert;
export type AiOperation = typeof aiOperations.$inferSelect;
