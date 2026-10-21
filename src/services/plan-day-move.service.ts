import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { planDays } from "@/models/workout.schema";
import { profiles } from "@/models/profile.schema";
import {
  formatDateAsString,
  getCurrentDateString,
  getCurrentDateStringInTimezone,
} from "@/utils/date.utils";

export interface MovePlanDayResult {
  planDayId: number;
  fromDate: string;
  toDate: string;
  /** Plan days that were on the target date and now sit on `fromDate`. Empty = moved onto a rest day. */
  swappedPlanDayIds: number[];
}

/**
 * Rearranging a plan's week by hand — "pull Saturday's yoga to today, put
 * today's workout on Saturday".
 *
 * Deterministic: no LLM, no AI allowance. Only `plan_days.date` changes (plus a
 * `dayNumber` renumber), so blocks, exercises and every id stay put.
 */
export class PlanDayMoveService extends BaseService {
  /**
   * Move a planned workout to another date in the same plan. If the target date
   * already holds workouts, they trade places (a swap); if it's a rest day, the
   * workout simply moves there and its old date becomes a rest day.
   *
   * Both dates must be today or later and inside the plan's window, and every
   * session being moved must be untouched — moving a day with logs would
   * re-date work the user already did.
   */
  async movePlanDay(
    userId: number,
    planDayId: number,
    targetDate: string,
    timezone?: string
  ): Promise<MovePlanDayResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate ?? "")) {
      throw new Error("Invalid target date");
    }

    const source = await this.db.query.planDays.findFirst({
      where: eq(planDays.id, planDayId),
      with: { workout: true },
    });
    if (!source || source.workout.userId !== userId) {
      throw new Error("Plan day not found");
    }

    const fromDate = formatDateAsString(source.date);
    if (fromDate === targetDate) {
      throw new Error("That workout is already on this day");
    }

    const today = await this.resolveToday(userId, timezone);
    if (fromDate < today || targetDate < today) {
      throw new Error("Workouts can only be moved between today and later days");
    }

    const planStart = formatDateAsString(source.workout.startDate);
    const planEnd = formatDateAsString(source.workout.endDate);
    if (targetDate < planStart || targetDate > planEnd) {
      throw new Error("Pick a day inside your current plan");
    }

    const targets = await this.db.query.planDays.findMany({
      where: and(
        eq(planDays.workoutId, source.workoutId),
        sql`${planDays.date}::date = ${targetDate}::date`
      ),
    });

    const moving = [source, ...targets];
    if (moving.some((day) => day.isComplete)) {
      throw new Error("A completed workout can't be moved");
    }
    if (await this.anyStarted(moving.map((day) => day.id))) {
      throw new Error("A workout you've started can't be moved");
    }

    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(planDays)
        .set({ date: targetDate, updatedAt: now })
        .where(eq(planDays.id, source.id));
      if (targets.length > 0) {
        await tx
          .update(planDays)
          .set({ date: fromDate, updatedAt: now })
          .where(
            inArray(
              planDays.id,
              targets.map((day) => day.id)
            )
          );
      }

      // Keep dayNumber in date order (the generator reads it as "day N").
      // Preserve the plan's own base — some plans count from 0, some from 1.
      const days = await tx.query.planDays.findMany({
        where: eq(planDays.workoutId, source.workoutId),
        orderBy: [asc(planDays.date), asc(planDays.id)],
      });
      const base = Math.min(...days.map((day) => day.dayNumber ?? 1));
      for (const [index, day] of days.entries()) {
        if (day.dayNumber !== base + index) {
          await tx
            .update(planDays)
            .set({ dayNumber: base + index })
            .where(eq(planDays.id, day.id));
        }
      }
    });

    return {
      planDayId: source.id,
      fromDate,
      toDate: targetDate,
      swappedPlanDayIds: targets.map((day) => day.id),
    };
  }

  /** True when any exercise or block on these plan days has been logged or skipped. */
  private async anyStarted(planDayIds: number[]): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
      FROM workout_blocks wb
      LEFT JOIN plan_day_exercises pde ON pde.workout_block_id = wb.id
      WHERE wb.plan_day_id IN (${sql.join(
        planDayIds.map((id) => sql`${id}`),
        sql`, `
      )})
        AND (
          pde.is_skipped = true
          OR EXISTS (SELECT 1 FROM exercise_logs el WHERE el.plan_day_exercise_id = pde.id)
          OR EXISTS (SELECT 1 FROM block_logs bl WHERE bl.workout_block_id = wb.id)
        )
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  /** The user's local today — same order as workoutService: request tz, profile tz, server. */
  private async resolveToday(userId: number, timezone?: string): Promise<string> {
    if (timezone) return getCurrentDateStringInTimezone(timezone);
    const profile = await this.db.query.profiles.findFirst({
      where: eq(profiles.userId, userId),
      columns: { timezone: true },
    });
    if (profile?.timezone) return getCurrentDateStringInTimezone(profile.timezone);
    return getCurrentDateString();
  }
}

export const planDayMoveService = new PlanDayMoveService();
