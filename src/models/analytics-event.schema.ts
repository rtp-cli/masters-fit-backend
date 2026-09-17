import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";

// Durable copy of the analytics events that otherwise only exist in Mixpanel.
//
// Why this table exists: the activation funnel (plan generated -> reveal seen ->
// workout started -> first exercise logged) was unanswerable from the database.
// Mixpanel holds it, but the client SDK is gated to production builds and the
// warehouse is a separate tool, so the day-to-day question "how many people who
// got a plan ever started it?" could not be answered with db-prod-read.sh. At
// this user count a Postgres row is worth more than a warehouse query.
//
// This is a WRITE-MOSTLY append log. It is deliberately NOT the source of truth
// for anything the app reads at runtime -- Mixpanel remains the analytics
// product, this is the queryable mirror.
export type AnalyticsEventSource = "client" | "server";

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    // Nullable and WITHOUT a cascade, matching app_feedback: an event must
    // outlive the account that produced it, or every funnel number silently
    // changes when someone deletes their account.
    userId: integer("user_id").references(() => users.id),
    // The Mixpanel distinct_id, kept so a row here can be lined up against the
    // same event in Mixpanel. Nullable for the same reason as userId.
    userUuid: text("user_uuid"),
    // snake_case event name exactly as sent to Mixpanel, e.g. "plan_reveal_shown".
    eventName: text("event_name").notNull(),
    // Flat, primitive, PII-FREE properties -- same contract as the client
    // registry in frontend/lib/analytics-events.ts. Never put email, name or
    // medical data here.
    properties: jsonb("properties"),
    // Which pipeline produced the row, so a future double-owner mistake is
    // visible in the data rather than silently doubling a funnel step.
    source: text("source").$type<AnalyticsEventSource>().notNull(),
    // Client-generated idempotency key. The frontend's apiRequest retries once
    // after a token refresh, which would otherwise double-insert and inflate
    // exactly the counts this table exists to measure. NULLs do not conflict in
    // Postgres, so server-emitted rows simply leave it unset.
    clientEventId: text("client_event_id"),
    // When the event actually happened on the device, which can be meaningfully
    // earlier than createdAt if the request was queued or the refresh was slow.
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientEventIdIdx: uniqueIndex("idx_analytics_events_client_event_id").on(
      table.clientEventId
    ),
    userIdIdx: index("idx_analytics_events_user_id").on(table.userId),
    eventNameIdx: index("idx_analytics_events_event_name").on(table.eventName),
    // The funnel query shape: one user's events in order.
    userEventIdx: index("idx_analytics_events_user_event").on(
      table.userId,
      table.eventName,
      table.createdAt
    ),
  })
);

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents, {
  eventName: z.string().min(1).max(100),
  source: z.enum(["client", "server"]),
}).omit({
  id: true,
  createdAt: true,
});

// Types - Explicit interface for TSOA compatibility
export interface AnalyticsEvent {
  id: number;
  userId: number | null;
  userUuid: string | null;
  eventName: string;
  properties: Record<string, unknown> | null;
  source: AnalyticsEventSource;
  clientEventId: string | null;
  occurredAt: Date | null;
  createdAt: Date;
}

export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
