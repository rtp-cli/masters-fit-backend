import { and, eq, gte, sql } from "drizzle-orm";

import {
  appFeedback,
  type AppFeedback,
  type AppFeedbackCategory,
  type AppFeedbackNoteSource,
} from "@/models";
import { BaseService } from "./base.service";

/** Thrown when a user exceeds the hourly feedback quota — mapped to 429. */
export class FeedbackRateLimitError extends Error {
  constructor() {
    super("Too many feedback submissions. Please try again later.");
    this.name = "FeedbackRateLimitError";
  }
}

// Prod default is 5/hour per user; override via env for local testing so a
// QA session isn't throttled (unset/invalid → 5).
const MAX_PER_HOUR = Number(process.env.FEEDBACK_MAX_PER_HOUR) || 5;

interface CreateFeedbackInput {
  clientId: string;
  category: AppFeedbackCategory;
  message: string;
  noteSource: AppFeedbackNoteSource;
  diagnostics: Record<string, unknown> | null;
}

export class AppFeedbackService extends BaseService {
  /**
   * Insert a feedback row. Idempotent on clientId: a retry after a flaky send
   * returns the existing row rather than filing a duplicate. Enforces a
   * per-user hourly cap and rejects blank messages. The row is the record of
   * truth — the email fan-out happens after this commits, off the response
   * path.
   */
  async createFeedback(
    userId: number,
    input: CreateFeedbackInput
  ): Promise<{ feedback: AppFeedback; isNew: boolean }> {
    // Idempotency: same draft retried → return what's already stored.
    const existing = await this.selectWithRetry(
      () =>
        this.db
          .select()
          .from(appFeedback)
          .where(eq(appFeedback.clientId, input.clientId))
          .limit(1),
      "getAppFeedbackByClientId",
      userId
    );
    if (existing.length > 0) {
      return { feedback: existing[0] as AppFeedback, isNew: false };
    }

    const message = input.message.trim();
    if (!message) {
      throw new Error("Feedback message cannot be empty");
    }

    // Rate limit: count this user's submissions in the last hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.selectWithRetry(
      () =>
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(appFeedback)
          .where(
            and(
              eq(appFeedback.userId, userId),
              gte(appFeedback.createdAt, oneHourAgo)
            )
          ),
      "countRecentAppFeedback",
      userId
    );
    if ((recent[0]?.count ?? 0) >= MAX_PER_HOUR) {
      throw new FeedbackRateLimitError();
    }

    const inserted = await this.insertWithRetry(
      () =>
        this.db
          .insert(appFeedback)
          .values({
            clientId: input.clientId,
            userId,
            category: input.category,
            message,
            noteSource: input.noteSource,
            diagnostics: input.diagnostics ?? null,
          })
          .returning(),
      "insertAppFeedback",
      userId
    );

    return { feedback: inserted[0] as AppFeedback, isNew: true };
  }

  /** Stamp email_sent_at once the fan-out succeeds. */
  async markEmailSent(id: number): Promise<void> {
    await this.updateWithRetry(
      () =>
        this.db
          .update(appFeedback)
          .set({ emailSentAt: new Date() })
          .where(eq(appFeedback.id, id)),
      "markAppFeedbackEmailSent"
    );
  }
}

export const appFeedbackService = new AppFeedbackService();
