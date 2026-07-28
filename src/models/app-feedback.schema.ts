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

// App-level feedback — correspondence that reaches a person, deliberately
// SEPARATE from plan_day_feedback (which is per-workout training signal).
// The row is the record of truth; the email fan-out is a notification on top
// of it, so a bounced message never means lost feedback.
export type AppFeedbackCategory = "bug" | "idea" | "praise" | "other";
export type AppFeedbackNoteSource = "text" | "voice";
export type AppFeedbackStatus = "new" | "triaged" | "closed";

export const appFeedback = pgTable(
  "app_feedback",
  {
    id: serial("id").primaryKey(),
    // Client-generated UUID per draft — unique so the retry after a flaky
    // send can't file the same report twice.
    clientId: text("client_id").notNull(),
    // Nullable and WITHOUT a cascade on purpose: a bug report must outlive the
    // account that filed it (account deletion is a soft delete today, but this
    // stays correct even if a hard delete is ever added).
    userId: integer("user_id").references(() => users.id),
    category: text("category").$type<AppFeedbackCategory>().notNull(),
    message: text("message").notNull(),
    noteSource: text("note_source").$type<AppFeedbackNoteSource>().notNull(),
    diagnostics: jsonb("diagnostics"),
    status: text("status")
      .$type<AppFeedbackStatus>()
      .default("new")
      .notNull(),
    // Null until the email fan-out succeeds.
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: uniqueIndex("idx_app_feedback_client_id").on(table.clientId),
    userIdIdx: index("idx_app_feedback_user_id").on(table.userId),
    statusIdx: index("idx_app_feedback_status").on(table.status),
  })
);

export const insertAppFeedbackSchema = createInsertSchema(appFeedback, {
  clientId: z.string().min(1),
  category: z.enum(["bug", "idea", "praise", "other"]),
  message: z.string(),
  noteSource: z.enum(["text", "voice"]),
}).omit({
  id: true,
  status: true,
  emailSentAt: true,
  createdAt: true,
});

// Types - Explicit interface for TSOA compatibility
export interface AppFeedback {
  id: number;
  clientId: string;
  userId: number | null;
  category: AppFeedbackCategory;
  message: string;
  noteSource: AppFeedbackNoteSource;
  diagnostics: Record<string, unknown> | null;
  status: AppFeedbackStatus;
  emailSentAt: Date | null;
  createdAt: Date;
}

export type InsertAppFeedback = z.infer<typeof insertAppFeedbackSchema>;
