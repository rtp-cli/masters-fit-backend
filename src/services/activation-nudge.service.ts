import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import {
  activationNudgeMaxDays,
  activationNudgeMinHours,
  companyPostalAddress,
  isActivationNudgeEnabled,
  isSuppressedNudgeEmail,
} from "@/constants/activation-nudge";
import { users } from "@/models/user.schema";
import { BaseService } from "@/services/base.service";
import { emailService } from "@/services/email.service";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { logger } from "@/utils/logger";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface ActivationCandidate {
  userId: number;
  name: string;
  email: string;
  /** When their FIRST plan was generated — the clock this nudge runs on. */
  firstPlanAt: Date;
  /** Their active plan's name, e.g. "Advanced Full-Body Strength". */
  planName: string;
  /**
   * The name of the session the email points at, e.g. "Full-Body Strength".
   * Null when the plan has no incomplete day left (rare, but a plan whose days
   * all sit in the past is possible) — the template falls back to generic copy
   * rather than printing an empty string.
   */
  firstSessionName: string | null;
  hoursSincePlan: number;
}

export type ActivationOutcome =
  | "sent"
  | "disabled"
  | "no-address"
  | "suppressed"
  | "already-sent"
  | "send-failed";

/**
 * The activation nudge: one email to someone who has a plan and never started
 * it.
 *
 * Separate from OnboardingNudgeService rather than a flag on it, matching how
 * that one is separate from the signup alerts. They target different failures,
 * a user can legitimately be eligible for both, and keeping the claim columns
 * and kill switches apart means turning one on cannot mail the other's
 * audience.
 */
export class ActivationNudgeService extends BaseService {
  /**
   * Everyone currently eligible.
   *
   * Every clause is load-bearing:
   *   active workout    — they actually have a plan waiting. The premise.
   *   no exercise_logs  — they have never logged anything, EVER, across every
   *                       workout they have ever had. Not "not this week":
   *                       someone who trained once and lapsed is a different
   *                       problem and a different email.
   *   first plan window — older than the grace period (not mid-session), newer
   *                       than the lookback (not an archaeology email).
   *   nudgeSentAt null  — never nudged. The "exactly once" guarantee.
   *   optedOut null     — checked in SQL, not just at send time, so an
   *                       opted-out user never even loads.
   *   isActive          — nullable, and null means active.
   *
   * The two EXISTS clauses are raw SQL because the log check spans four joins
   * (exercise_logs -> plan_day_exercises -> workout_blocks -> plan_days) and
   * reads far more clearly as the question it is asking than as a chain of
   * Drizzle subqueries.
   *
   * The correlation is written as a literal `users.id`, NOT as a `${...}`
   * interpolation of the column. Inside a select() field Drizzle renders that
   * interpolation as a bare `"id"`, which Postgres then rejects as ambiguous
   * against the subquery's own tables ("column reference \"id\" is
   * ambiguous"). Spelling the qualified name is the fix.
   */
  async getCandidates(now: Date): Promise<ActivationCandidate[]> {
    const oldest = new Date(
      now.getTime() - activationNudgeMaxDays() * MS_PER_DAY
    );
    const newest = new Date(
      now.getTime() - activationNudgeMinHours() * MS_PER_HOUR
    );

    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        firstPlanAt: sql<Date>`(
          select min(w.created_at) from workouts w where w.user_id = users.id
        )`.as("first_plan_at"),
        planName: sql<string>`(
          select w.name from workouts w
          where w.user_id = users.id and w.is_active = true
          order by w.created_at desc limit 1
        )`.as("plan_name"),
        firstSessionName: sql<string | null>`(
          select pd.name from plan_days pd
          join workouts w on w.id = pd.workout_id
          where w.user_id = users.id and w.is_active = true
            and pd.is_complete = false
          order by pd.date asc limit 1
        )`.as("first_session_name"),
      })
      .from(users)
      .where(
        and(
          isNull(users.activationNudgeSentAt),
          isNull(users.emailOptedOutAt),
          or(eq(users.isActive, true), isNull(users.isActive)),
          // Has a plan waiting.
          sql`exists (
            select 1 from workouts w
            where w.user_id = users.id and w.is_active = true
          )`,
          // Has never logged a single exercise, across every workout.
          sql`not exists (
            select 1
            from exercise_logs el
            join plan_day_exercises pde on pde.id = el.plan_day_exercise_id
            join workout_blocks wb on wb.id = pde.workout_block_id
            join plan_days pd on pd.id = wb.plan_day_id
            join workouts w on w.id = pd.workout_id
            where w.user_id = users.id
          )`,
          // Their first plan landed inside the window.
          sql`(select min(w.created_at) from workouts w where w.user_id = users.id)
              between ${oldest} and ${newest}`
        )
      );

    return rows
      .filter((r) => !isSuppressedNudgeEmail(r.email))
      .filter((r): r is typeof r & { firstPlanAt: Date } => r.firstPlanAt != null)
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        firstPlanAt: new Date(r.firstPlanAt),
        planName: r.planName,
        firstSessionName: r.firstSessionName,
        hoursSincePlan: Math.max(
          1,
          Math.floor(
            (now.getTime() - new Date(r.firstPlanAt).getTime()) / MS_PER_HOUR
          )
        ),
      }));
  }

  /**
   * Atomically claim the right to nudge this user.
   *
   * Same conditional-UPDATE idempotency as the onboarding nudge: several Render
   * instances can run the scan at once, and only the one whose UPDATE matches a
   * row gets a timestamp back. Claiming BEFORE sending is the deliberate trade
   * — a crash between claim and send costs one missed nudge, where the reverse
   * costs a duplicate in a customer's inbox.
   */
  async claim(userId: number): Promise<Date | null> {
    const claimedAt = getCurrentUTCDate();
    const [claimed] = await this.db
      .update(users)
      .set({ activationNudgeSentAt: claimedAt })
      .where(and(eq(users.id, userId), isNull(users.activationNudgeSentAt)))
      .returning({ id: users.id });

    return claimed ? claimedAt : null;
  }

  /**
   * Give the claim back when the send fails, so a later run can retry. Guarded
   * on the exact timestamp this caller wrote, so a concurrent re-claim isn't
   * clobbered.
   */
  async release(userId: number, claimedAt: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ activationNudgeSentAt: null })
      .where(
        and(eq(users.id, userId), eq(users.activationNudgeSentAt, claimedAt))
      );
  }

  /**
   * Send one nudge, claim-first.
   *
   * MUST NOT THROW: the caller is a scheduled job iterating a list, and one bad
   * address must not abort the rest of the run. Every failure mode resolves to
   * an ActivationOutcome.
   */
  async send(candidate: ActivationCandidate): Promise<ActivationOutcome> {
    try {
      if (!isActivationNudgeEnabled()) return "disabled";

      // Compliance gate, before any send. No postal address means this is not a
      // legal commercial email, so it does not go out — by construction rather
      // than by anyone remembering.
      const postalAddress = companyPostalAddress();
      if (!postalAddress) return "no-address";

      if (isSuppressedNudgeEmail(candidate.email)) return "suppressed";

      const claimedAt = await this.claim(candidate.userId);
      if (!claimedAt) return "already-sent";

      try {
        await emailService.sendActivationNudgeEmail({
          to: candidate.email,
          name: candidate.name,
          userId: candidate.userId,
          planName: candidate.planName,
          firstSessionName: candidate.firstSessionName,
          postalAddress,
        });
        return "sent";
      } catch (error) {
        await this.release(candidate.userId, claimedAt);
        logger.error("Activation nudge send failed", error as Error, {
          operation: "sendActivationNudge",
          metadata: { userId: candidate.userId },
        });
        return "send-failed";
      }
    } catch (error) {
      logger.error("Activation nudge failed", error as Error, {
        operation: "sendActivationNudge",
        metadata: { userId: candidate.userId },
      });
      return "send-failed";
    }
  }
}

export const activationNudgeService = new ActivationNudgeService();
