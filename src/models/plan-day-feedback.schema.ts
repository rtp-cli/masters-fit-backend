import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@/models/user.schema";
import { planDays } from "@/models/workout.schema";

// Post-workout feedback answer values. Deliberately per-WORKOUT granularity
// (not per-exercise — ExerciseLog.rating/difficulty are unused and stay that
// way). Effort and time are separate questions because they map to different
// generation levers: intensity vs. volume.
export type FeedbackEffort = "too_easy" | "just_right" | "too_hard";
export type FeedbackTimeFit = "finished_early" | "about_right" | "ran_out";
export type FeedbackEndedEarlyReason =
  | "ran_out_of_time"
  | "too_hard"
  | "something_hurt"
  | "lost_interest"
  | "interrupted";
export type FeedbackNoteSource = "text" | "voice";

// One row per plan day; answers are nullable and written independently — a
// partial answer (effort only) is valid and persists via upsert.
export const planDayFeedback = pgTable(
  "plan_day_feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    planDayId: integer("plan_day_id")
      .notNull()
      .references(() => planDays.id),
    effort: text("effort").$type<FeedbackEffort>(),
    timeFit: text("time_fit").$type<FeedbackTimeFit>(),
    endedEarlyReason: text("ended_early_reason").$type<FeedbackEndedEarlyReason>(),
    note: text("note"),
    noteSource: text("note_source").$type<FeedbackNoteSource>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    planDayIdIdx: uniqueIndex("idx_plan_day_feedback_plan_day_id").on(
      table.planDayId
    ),
    userIdIdx: index("idx_plan_day_feedback_user_id").on(table.userId),
  })
);

export const insertPlanDayFeedbackSchema = createInsertSchema(
  planDayFeedback
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Request body for the upsert endpoint. userId deliberately absent — it comes
// from the verified JWT, never the payload. All answers optional: they're
// written independently as the user taps.
export const upsertPlanDayFeedbackSchema = z.object({
  planDayId: z.number().int().positive(),
  effort: z.enum(["too_easy", "just_right", "too_hard"]).nullish(),
  timeFit: z.enum(["finished_early", "about_right", "ran_out"]).nullish(),
  endedEarlyReason: z
    .enum([
      "ran_out_of_time",
      "too_hard",
      "something_hurt",
      "lost_interest",
      "interrupted",
    ])
    .nullish(),
  note: z.string().trim().max(2000).nullish(),
  noteSource: z.enum(["text", "voice"]).nullish(),
});

export type UpsertPlanDayFeedback = z.infer<typeof upsertPlanDayFeedbackSchema>;

// Explicit interface for TSOA compatibility
export interface PlanDayFeedback {
  id: number;
  userId: number;
  planDayId: number;
  effort: FeedbackEffort | null;
  timeFit: FeedbackTimeFit | null;
  endedEarlyReason: FeedbackEndedEarlyReason | null;
  note: string | null;
  noteSource: FeedbackNoteSource | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertPlanDayFeedback = z.infer<
  typeof insertPlanDayFeedbackSchema
>;
