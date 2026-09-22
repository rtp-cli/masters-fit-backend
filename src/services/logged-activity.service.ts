import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { BaseService } from "@/services/base.service";
import {
  loggedActivities,
  LoggedActivity,
  type CreateLoggedActivityInput,
} from "@/models/logged-activity.schema";

export class LoggedActivityNotFoundError extends Error {
  constructor() {
    super("Activity not found.");
    this.name = "LoggedActivityNotFoundError";
  }
}

export class ActivityDateInFutureError extends Error {
  constructor() {
    super("You can only log something you've already done.");
    this.name = "ActivityDateInFutureError";
  }
}

/**
 * [LR-077] Owns every read and write of `logged_activities`.
 *
 * Every method takes `userId` and filters by it — these rows are only ever
 * reachable through the caller's own id, never through an id in the path.
 */
export class LoggedActivityService extends BaseService {
  /**
   * Record something the user already did.
   *
   * @param today the caller's LOCAL today as "YYYY-MM-DD". Passed in rather
   *   than computed here because the server has no business deciding what day
   *   it is for a user in another timezone — the same local-vs-UTC mismatch
   *   that already breaks evening streaks would otherwise reject a valid log
   *   made at 7pm Central.
   */
  public async createActivity(
    userId: number,
    input: CreateLoggedActivityInput,
    today: string
  ): Promise<LoggedActivity> {
    if (input.date > today) {
      throw new ActivityDateInFutureError();
    }

    const [created] = await this.db
      .insert(loggedActivities)
      .values({
        userId,
        date: input.date,
        activityType: input.activityType,
        // Only "other" carries a label; storing one alongside a known type
        // would give the UI two competing names for the same row.
        customType:
          input.activityType === "other" ? (input.customType ?? null) : null,
        durationMinutes: input.durationMinutes,
        effort: input.effort ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    return created as LoggedActivity;
  }

  /**
   * The user's activities within a date window, oldest first.
   *
   * The window is inclusive at both ends and compared as strings, which is
   * correct because the column is a zero-padded "YYYY-MM-DD".
   */
  public async listActivities(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<LoggedActivity[]> {
    const conditions = [eq(loggedActivities.userId, userId)];
    if (startDate) conditions.push(gte(loggedActivities.date, startDate));
    if (endDate) conditions.push(lte(loggedActivities.date, endDate));

    const rows = await this.db
      .select()
      .from(loggedActivities)
      .where(and(...conditions))
      // createdAt breaks ties so two activities on the same date keep the order
      // they were logged in, rather than an arbitrary one that shuffles between
      // requests and makes the calendar list look unstable.
      .orderBy(asc(loggedActivities.date), asc(loggedActivities.createdAt));

    return rows as LoggedActivity[];
  }

  /** Everything logged on one date — what the calendar and dashboard ask for. */
  public async listActivitiesForDate(
    userId: number,
    date: string
  ): Promise<LoggedActivity[]> {
    return this.listActivities(userId, date, date);
  }

  /**
   * Delete one activity.
   *
   * Scoped by userId in the WHERE clause rather than fetched-then-checked, so
   * there is no window in which another user's row could be read at all.
   */
  public async deleteActivity(userId: number, id: number): Promise<void> {
    const deleted = await this.db
      .delete(loggedActivities)
      .where(
        and(eq(loggedActivities.id, id), eq(loggedActivities.userId, userId))
      )
      .returning({ id: loggedActivities.id });

    // Indistinguishable from "belongs to someone else" on purpose — a 404 here
    // must not confirm that an id exists.
    if (deleted.length === 0) {
      throw new LoggedActivityNotFoundError();
    }
  }

  /** Most recent first — used by the dashboard when it needs just the latest. */
  public async getMostRecent(
    userId: number,
    limit = 5
  ): Promise<LoggedActivity[]> {
    const rows = await this.db
      .select()
      .from(loggedActivities)
      .where(eq(loggedActivities.userId, userId))
      .orderBy(desc(loggedActivities.date), desc(loggedActivities.createdAt))
      .limit(limit);

    return rows as LoggedActivity[];
  }
}

export const loggedActivityService = new LoggedActivityService();
