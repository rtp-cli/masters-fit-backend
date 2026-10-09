import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type AnyColumn,
} from "drizzle-orm";

import { BaseService } from "@/services/base.service";
import {
  loggedActivities,
  LoggedActivity,
  type CreateLoggedActivityInput,
  type ImportedActivityInput,
} from "@/models/logged-activity.schema";
import { exerciseLogs, exerciseSetLogs } from "@/models/logs.schema";
import {
  planDayExercises,
  planDays,
  workoutBlocks,
  workouts,
} from "@/models/workout.schema";
import {
  clusterSessionWindows,
  overlapsAnySession,
  SESSION_PAD_MS,
  type SessionWindow,
} from "@/utils/session-overlap";

export interface ImportActivitiesResult {
  imported: LoggedActivity[];
  /** Already stored (or deleted by the user), so not re-imported. */
  skippedExisting: number;
  /** Overlapped a MastersFit session — the watch recording OF that session. */
  skippedSessionOverlap: number;
  /** Same type already logged by hand that day. */
  skippedManualDuplicate: number;
}

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
    const conditions = [
      eq(loggedActivities.userId, userId),
      // Dismissed imports are tombstones, never shown.
      isNull(loggedActivities.dismissedAt),
    ];
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
    // An imported row is tombstoned, not deleted: if it vanished, the next
    // sync would see an unknown external id and put the walk straight back.
    const dismissed = await this.db
      .update(loggedActivities)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(loggedActivities.id, id),
          eq(loggedActivities.userId, userId),
          isNotNull(loggedActivities.externalId),
          isNull(loggedActivities.dismissedAt)
        )
      )
      .returning({ id: loggedActivities.id });
    if (dismissed.length > 0) return;

    const deleted = await this.db
      .delete(loggedActivities)
      .where(
        and(
          eq(loggedActivities.id, id),
          eq(loggedActivities.userId, userId),
          // A tombstone already reads as gone; deleting it would let the
          // walk come back on the next sync.
          isNull(loggedActivities.externalId)
        )
      )
      .returning({ id: loggedActivities.id });

    // Indistinguishable from "belongs to someone else" on purpose — a 404 here
    // must not confirm that an id exists.
    if (deleted.length === 0) {
      throw new LoggedActivityNotFoundError();
    }
  }

  /**
   * Store workouts read off the user's watch. Idempotent: the client sends
   * the last few days on every app open and anything already seen is skipped.
   *
   * Every skip rule fails toward a MISSED import rather than a phantom one —
   * the user can always log a missed walk by hand, but a duplicate of their
   * MastersFit session reads as the app getting their training wrong.
   *
   * @param today the caller's LOCAL today, as in createActivity.
   */
  public async importActivities(
    userId: number,
    items: ImportedActivityInput[],
    today: string
  ): Promise<ImportActivitiesResult> {
    const result: ImportActivitiesResult = {
      imported: [],
      skippedExisting: 0,
      skippedSessionOverlap: 0,
      skippedManualDuplicate: 0,
    };

    // A future date means a bad clock or a bad mapping; drop it quietly.
    const byExternalId = new Map<string, ImportedActivityInput>();
    for (const item of items) {
      if (item.date <= today) byExternalId.set(item.externalId, item);
    }
    let candidates = [...byExternalId.values()];
    if (candidates.length === 0) return result;

    // 1. Already stored — including tombstones, which is their whole job.
    const known = await this.db
      .select({ externalId: loggedActivities.externalId })
      .from(loggedActivities)
      .where(
        and(
          eq(loggedActivities.userId, userId),
          inArray(
            loggedActivities.externalId,
            candidates.map((c) => c.externalId)
          )
        )
      );
    const knownIds = new Set(known.map((k) => k.externalId));
    result.skippedExisting = candidates.filter((c) =>
      knownIds.has(c.externalId)
    ).length;
    candidates = candidates.filter((c) => !knownIds.has(c.externalId));
    if (candidates.length === 0) return result;

    // 2. The watch recording OF a MastersFit session.
    const starts = candidates.map((c) => Date.parse(c.startedAt));
    const ends = candidates.map((c) => Date.parse(c.endedAt));
    const windows = await this.getSessionWindows(
      userId,
      Math.min(...starts),
      Math.max(...ends)
    );
    const beforeOverlap = candidates.length;
    candidates = candidates.filter(
      (c) =>
        !overlapsAnySession(
          Date.parse(c.startedAt),
          Date.parse(c.endedAt),
          windows
        )
    );
    result.skippedSessionOverlap = beforeOverlap - candidates.length;
    if (candidates.length === 0) return result;

    // 3. Already logged by hand that day. Manual rows carry no time, so the
    //    best available match is date + type; this mostly matters on the day
    //    the import first runs for someone who was logging walks by hand.
    const manual = await this.db
      .select({
        date: loggedActivities.date,
        activityType: loggedActivities.activityType,
        customType: loggedActivities.customType,
      })
      .from(loggedActivities)
      .where(
        and(
          eq(loggedActivities.userId, userId),
          eq(loggedActivities.source, "manual"),
          isNull(loggedActivities.dismissedAt),
          inArray(
            loggedActivities.date,
            [...new Set(candidates.map((c) => c.date))]
          )
        )
      );
    const manualKey = (date: string, type: string, custom: string | null) =>
      `${date}|${type}|${type === "other" ? (custom ?? "").toLowerCase() : ""}`;
    const manualKeys = new Set(
      manual.map((m) => manualKey(m.date, m.activityType, m.customType))
    );
    const beforeManual = candidates.length;
    candidates = candidates.filter(
      (c) =>
        !manualKeys.has(manualKey(c.date, c.activityType, c.customType ?? null))
    );
    result.skippedManualDuplicate = beforeManual - candidates.length;
    if (candidates.length === 0) return result;

    // Bare onConflictDoNothing: two app opens racing each other both pass the
    // "known" check, and the unique (user_id, external_id) index settles it.
    const inserted = await this.db
      .insert(loggedActivities)
      .values(
        candidates.map((c) => ({
          userId,
          date: c.date,
          activityType: c.activityType,
          customType:
            c.activityType === "other" ? (c.customType ?? null) : null,
          durationMinutes: c.durationMinutes,
          source: c.source,
          externalId: c.externalId,
          startedAt: new Date(c.startedAt),
          distanceMeters: c.distanceMeters ?? null,
        }))
      )
      .onConflictDoNothing()
      .returning();

    result.imported = inserted as LoggedActivity[];
    return result;
  }

  /**
   * Windows during which the user was logging sets of a MastersFit session,
   * covering [from, to] plus padding. See utils/session-overlap.ts for why
   * these come from set timestamps and are clustered.
   */
  private async getSessionWindows(
    userId: number,
    from: number,
    to: number
  ): Promise<SessionWindow[]> {
    const lo = new Date(from - SESSION_PAD_MS * 2).toISOString();
    const hi = new Date(to + SESSION_PAD_MS * 2).toISOString();

    // The log tables use `timestamp` WITHOUT time zone filled by now(), i.e.
    // wall-clock time in the DB session's zone. Prod is GMT, so drizzle's
    // read-as-UTC happens to be right there, but a local Postgres on
    // America/Chicago is five hours off. Resolving the zone in SQL makes the
    // comparison correct on both.
    const instant = (column: AnyColumn) =>
      sql`(${column} AT TIME ZONE current_setting('TimeZone'))`;
    const epochMs = (column: AnyColumn) =>
      sql<string>`extract(epoch from ${instant(column)}) * 1000`;
    const inRange = (column: AnyColumn) =>
      and(
        sql`${instant(column)} >= ${lo}::timestamptz`,
        sql`${instant(column)} <= ${hi}::timestamptz`
      );

    const userPlanDays = this.db
      .select({ planDayId: planDays.id })
      .from(planDays)
      .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
      .where(eq(workouts.userId, userId));

    const exerciseRows = await this.db
      .select({
        planDayId: workoutBlocks.planDayId,
        at: epochMs(exerciseLogs.createdAt),
      })
      .from(exerciseLogs)
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .where(
        and(
          inArray(workoutBlocks.planDayId, userPlanDays),
          inRange(exerciseLogs.createdAt)
        )
      );

    const setRows = await this.db
      .select({
        planDayId: workoutBlocks.planDayId,
        at: epochMs(exerciseSetLogs.createdAt),
      })
      .from(exerciseSetLogs)
      .innerJoin(exerciseLogs, eq(exerciseSetLogs.exerciseLogId, exerciseLogs.id))
      .innerJoin(
        planDayExercises,
        eq(exerciseLogs.planDayExerciseId, planDayExercises.id)
      )
      .innerJoin(
        workoutBlocks,
        eq(planDayExercises.workoutBlockId, workoutBlocks.id)
      )
      .where(
        and(
          inArray(workoutBlocks.planDayId, userPlanDays),
          inRange(exerciseSetLogs.createdAt)
        )
      );

    const byPlanDay = new Map<number, number[]>();
    for (const row of [...exerciseRows, ...setRows]) {
      const list = byPlanDay.get(row.planDayId) ?? [];
      list.push(Number(row.at));
      byPlanDay.set(row.planDayId, list);
    }

    return [...byPlanDay.values()].flatMap(clusterSessionWindows);
  }

  /** Most recent first — used by the dashboard when it needs just the latest. */
  public async getMostRecent(
    userId: number,
    limit = 5
  ): Promise<LoggedActivity[]> {
    const rows = await this.db
      .select()
      .from(loggedActivities)
      .where(
        and(
          eq(loggedActivities.userId, userId),
          isNull(loggedActivities.dismissedAt)
        )
      )
      .orderBy(desc(loggedActivities.date), desc(loggedActivities.createdAt))
      .limit(limit);

    return rows as LoggedActivity[];
  }
}

export const loggedActivityService = new LoggedActivityService();
