import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import {
  isSuppressedReminderEmail,
  isWorkoutReminderEnabled,
  localDateAndHour,
  workoutReminderLocalHour,
} from "@/constants/workout-reminder";
import { profiles } from "@/models/profile.schema";
import { users } from "@/models/user.schema";
import { BaseService } from "@/services/base.service";
import { notificationService } from "@/services/notification.service";
import { logger } from "@/utils/logger";

export interface ReminderCandidate {
  userId: number;
  /** The user's local date the reminder is for (YYYY-MM-DD). */
  localDate: string;
  /** Today's session name, e.g. "Full-Body Strength". Null falls back to generic copy. */
  sessionName: string | null;
}

export type ReminderOutcome =
  | "sent"
  | "disabled"
  | "already-sent"
  | "send-failed";

/**
 * The daily workout reminder: one push on the morning of a planned workout
 * day, at workoutReminderLocalHour() in the user's own timezone.
 *
 * The scan runs HOURLY and each user is only due in the one hour that is 8am
 * for them, so a US-wide user base is spread across several runs. The claim
 * column (users.workout_reminder_sent_on = their local date) is what makes
 * "once per day" hold even if two runs or two instances overlap.
 */
export class WorkoutReminderService extends BaseService {
  /**
   * Everyone due a reminder at `now`.
   *
   * Clauses, all load-bearing:
   *   push token        — no token, nothing to send to.
   *   reminders on      — the Settings switch.
   *   isActive          — nullable, and null means active.
   *   local hour        — computed in JS, not SQL: Postgres throws on an
   *                       invalid timezone name, and one bad profile row
   *                       must not abort everyone's reminder.
   *   not sent today    — the claim marker, for THEIR local date.
   *   a session today   — an incomplete plan day dated their local today, in
   *                       their active plan, with at least one exercise (so a
   *                       rest day never pings) and nothing logged against it
   *                       yet (they already started — don't nag).
   */
  async getCandidates(now: Date): Promise<ReminderCandidate[]> {
    const targetHour = workoutReminderLocalHour();

    const rows = await this.db
      .select({
        userId: users.id,
        email: users.email,
        timezone: profiles.timezone,
        sentOn: users.workoutReminderSentOn,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          isNotNull(users.pushNotificationToken),
          eq(users.workoutRemindersEnabled, true),
          or(eq(users.isActive, true), isNull(users.isActive))
        )
      );

    const due = rows
      .filter((r) => !isSuppressedReminderEmail(r.email))
      .map((r) => ({ ...r, local: localDateAndHour(r.timezone, now) }))
      .filter(
        (r): r is typeof r & { local: { date: string; hour: number } } =>
          r.local !== null &&
          r.local.hour === targetHour &&
          r.sentOn !== r.local.date
      );

    const candidates: ReminderCandidate[] = [];
    for (const r of due) {
      const sessionName = await this.todaysSession(r.userId, r.local.date);
      if (sessionName === undefined) continue;
      candidates.push({
        userId: r.userId,
        localDate: r.local.date,
        sessionName,
      });
    }
    return candidates;
  }

  /**
   * The name of today's not-yet-started session, null if it has no name, or
   * undefined if there is no such session (rest day, done, or no active plan).
   *
   * The correlation is a raw SQL string for the same reason as the activation
   * nudge: the "nothing logged" check spans four joins and reads more clearly
   * as the question it asks.
   */
  private async todaysSession(
    userId: number,
    localDate: string
  ): Promise<string | null | undefined> {
    const result = await this.db.execute(sql`
      select pd.name
      from plan_days pd
      join workouts w on w.id = pd.workout_id
      where w.user_id = ${userId}
        and w.is_active = true
        and pd.date = ${localDate}
        and coalesce(pd.is_complete, false) = false
        and exists (
          select 1 from workout_blocks wb
          join plan_day_exercises pde on pde.workout_block_id = wb.id
          where wb.plan_day_id = pd.id
        )
        and not exists (
          select 1 from exercise_logs el
          join plan_day_exercises pde on pde.id = el.plan_day_exercise_id
          join workout_blocks wb on wb.id = pde.workout_block_id
          where wb.plan_day_id = pd.id
        )
      order by pd.id asc
      limit 1
    `);
    const row = (result as unknown as { rows: { name: string | null }[] })
      .rows?.[0];
    return row ? row.name : undefined;
  }

  /**
   * Atomically claim today's reminder for this user. Claim-before-send, same
   * trade as the email nudges: a crash between claim and send costs one missed
   * push, where the reverse costs a duplicate on someone's lock screen.
   */
  async claim(userId: number, localDate: string): Promise<boolean> {
    const [claimed] = await this.db
      .update(users)
      .set({ workoutReminderSentOn: localDate })
      .where(
        and(
          eq(users.id, userId),
          or(
            isNull(users.workoutReminderSentOn),
            ne(users.workoutReminderSentOn, localDate)
          )
        )
      )
      .returning({ id: users.id });
    return !!claimed;
  }

  /** MUST NOT THROW: one bad user must not abort the rest of the run. */
  async send(candidate: ReminderCandidate): Promise<ReminderOutcome> {
    try {
      if (!isWorkoutReminderEnabled()) return "disabled";
      if (!(await this.claim(candidate.userId, candidate.localDate))) {
        return "already-sent";
      }
      const ok = await notificationService.sendDailyWorkoutReminderNotification(
        candidate.userId,
        candidate.sessionName
      );
      return ok ? "sent" : "send-failed";
    } catch (error) {
      logger.error("Workout reminder failed", error as Error, {
        operation: "sendWorkoutReminder",
        metadata: { userId: candidate.userId },
      });
      return "send-failed";
    }
  }

  async getPreferences(
    userId: number
  ): Promise<{ workoutReminders: boolean } | null> {
    const [row] = await this.db
      .select({ enabled: users.workoutRemindersEnabled })
      .from(users)
      .where(eq(users.id, userId));
    return row ? { workoutReminders: row.enabled } : null;
  }

  async setWorkoutReminders(userId: number, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ workoutRemindersEnabled: enabled })
      .where(eq(users.id, userId));
  }
}

export const workoutReminderService = new WorkoutReminderService();
