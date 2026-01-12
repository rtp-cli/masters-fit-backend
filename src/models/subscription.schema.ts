import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  unique,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { BillingPeriod, SubscriptionStatus } from "@/constants";

// Subscription plans table
export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: serial("id").primaryKey(),
    planId: text("plan_id").notNull().unique().$type<string>(), // RevenueCat product ID
    name: text("name").notNull(),
    description: text("description"),
    billingPeriod: text("billing_period").notNull().$type<BillingPeriod>(),
    priceUsd: numeric("price_usd", { precision: 10, scale: 2 })
      .notNull()
      .$type<number>(), // Price in USD with cents
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    planIdIdx: index("idx_subscription_plans_plan_id").on(table.planId),
    isActiveIdx: index("idx_subscription_plans_is_active").on(table.isActive),
  })
);

// User subscriptions table
export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revenuecatCustomerId: text("revenuecat_customer_id"), // RevenueCat customer ID
    revenuecatSubscriptionId: text("revenuecat_subscription_id"), // RevenueCat subscription ID (null for trial)
    planId: text("plan_id"), // Which plan user has (null for trial) - stores RevenueCat product ID string, not FK
    status: text("status")
      .notNull()
      .default(SubscriptionStatus.TRIAL)
      .$type<SubscriptionStatus>(),
    subscriptionStartDate: timestamp("subscription_start_date", {
      withTimezone: true,
    }), // When paid subscription started
    subscriptionEndDate: timestamp("subscription_end_date", {
      withTimezone: true,
    }), // When subscription expires
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_user_subscriptions_user_id").on(table.userId),
    statusIdx: index("idx_user_subscriptions_status").on(table.status),
    planIdIdx: index("idx_user_subscriptions_plan_id").on(table.planId),
    revenuecatCustomerIdIdx: index(
      "idx_user_subscriptions_revenuecat_customer_id"
    ).on(table.revenuecatCustomerId),
    revenuecatSubscriptionIdIdx: index(
      "idx_user_subscriptions_revenuecat_subscription_id"
    ).on(table.revenuecatSubscriptionId),
    // Unique constraint: one subscription per user
    userIdUnique: unique("unique_user_subscription").on(table.userId),
  })
);

// Trial usage table
export const trialUsage = pgTable(
  "trial_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weeklyGenerationsCount: integer("weekly_generations_count")
      .default(0)
      .notNull(), // Workouts generated this week (max 2 for trial)
    dailyRegenerationsCount: integer("daily_regenerations_count")
      .default(0)
      .notNull(), // Regenerations today (max 5 for trial)
    tokensUsed: integer("tokens_used").default(0).notNull(), // AI tokens used (cumulative)
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_trial_usage_user_id").on(table.userId),
    // Unique constraint: one trial usage record per user
    userIdUnique: unique("unique_trial_usage_user").on(table.userId),
  })
);

// Webhook events table for idempotency
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull().unique(), // RevenueCat event ID
    eventType: text("event_type").notNull(),
    payload: text("payload"), // Store full event as JSON string for debugging
    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    eventIdIdx: index("idx_webhook_events_event_id").on(table.eventId),
    eventTypeIdx: index("idx_webhook_events_event_type").on(table.eventType),
  })
);

// Schemas for insert operations
export const insertSubscriptionPlanSchema = createInsertSchema(
  subscriptionPlans
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSubscriptionSchema = createInsertSchema(
  userSubscriptions
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTrialUsageSchema = createInsertSchema(trialUsage).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({
  id: true,
  createdAt: true,
});

// Update schemas
export const updateUserSubscriptionSchema = createInsertSchema(
  userSubscriptions
)
  .omit({
    id: true,
    userId: true,
    createdAt: true,
  })
  .partial();

export const updateTrialUsageSchema = createInsertSchema(trialUsage)
  .omit({
    id: true,
    userId: true,
    createdAt: true,
  })
  .partial();

// Types - Explicit interfaces for TSOA compatibility
export interface SubscriptionPlan {
  id: number;
  planId: string;
  name: string;
  description: string | null;
  billingPeriod: BillingPeriod;
  priceUsd: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSubscription {
  id: number;
  userId: number;
  revenuecatCustomerId: string | null;
  revenuecatSubscriptionId: string | null;
  planId: string | null;
  status: SubscriptionStatus;
  subscriptionStartDate: Date | null;
  subscriptionEndDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrialUsage {
  id: number;
  userId: number;
  weeklyGenerationsCount: number;
  dailyRegenerationsCount: number;
  tokensUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEvent {
  id: number;
  eventId: string;
  eventType: string;
  payload: string | null;
  processedAt: Date;
  createdAt: Date;
}

export type InsertSubscriptionPlan = z.infer<
  typeof insertSubscriptionPlanSchema
>;
export type InsertUserSubscription = z.infer<
  typeof insertUserSubscriptionSchema
>;
export type InsertTrialUsage = z.infer<typeof insertTrialUsageSchema>;
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type UpdateUserSubscription = z.infer<
  typeof updateUserSubscriptionSchema
>;
export type UpdateTrialUsage = z.infer<typeof updateTrialUsageSchema>;
