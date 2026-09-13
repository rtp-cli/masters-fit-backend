import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { users } from "@/models/user.schema";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { emailService } from "@/services/email.service";
import { logger } from "@/utils/logger";
import {
  isOnboardingNudgeEnabled,
  isSuppressedNudgeEmail,
  onboardingNudgeMaxDays,
  onboardingNudgeMinHours,
  companyPostalAddress,
} from "@/constants/onboarding-nudge";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface NudgeCandidate {
  userId: number;
  name: string;
  email: string;
  createdAt: Date;
  stalledDays: number;
  /**
   * Whether they still need onboarding. Always true for scan candidates (the
   * query requires it); carried so the ops script can refuse to DISPATCH a
   * "you never finished" email at somebody who finished.
   */
  needsOnboarding: boolean;
}

export type NudgeOutcome =
  | "sent"
  | "disabled"
  | "no-address"
  | "skipped"
  | "suppressed"
  | "opted-out"
  | "already-sent"
  | "send-failed";

/**
 * The onboarding nudge: one email to someone who made an account and never
 * finished setting up.
 *
 * Kept in its own service rather than bolted onto signup-notification.service
 * because the two have different blast radii. That one mails the owner and its
 * worst failure is a missed alert; this one mails customers, and its worst
 * failure is mailing the wrong person or mailing someone twice. Separate file,
 * separate flag, separate claim column.
 */
export class OnboardingNudgeService extends BaseService {
  /**
   * Everyone currently eligible for a nudge.
   *
   * Eligibility is deliberately narrow, and every clause is load-bearing:
   *   needsOnboarding    — they never finished. The whole premise.
   *   createdAt window   — older than the grace period (not mid-signup), and
   *                        newer than the lookback (not an archaeology email).
   *   nudgeSentAt null   — never nudged. This is the "exactly once" guarantee.
   *   optedOut null      — they asked us to stop. Checked in SQL, not just at
   *                        send time, so an opted-out user never even loads.
   *   isActive           — nullable, and null means active.
   */
  async getNudgeCandidates(now: Date): Promise<NudgeCandidate[]> {
    const oldest = new Date(now.getTime() - onboardingNudgeMaxDays() * MS_PER_DAY);
    const newest = new Date(now.getTime() - onboardingNudgeMinHours() * MS_PER_HOUR);

    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        and(
          eq(users.needsOnboarding, true),
          gte(users.createdAt, oldest),
          lte(users.createdAt, newest),
          isNull(users.onboardingNudgeSentAt),
          isNull(users.emailOptedOutAt),
          or(eq(users.isActive, true), isNull(users.isActive))
        )
      );

    return rows
      .filter((r) => !isSuppressedNudgeEmail(r.email))
      .filter((r): r is typeof r & { createdAt: Date } => r.createdAt != null)
      .map((r) => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        createdAt: r.createdAt,
        stalledDays: Math.max(
          1,
          Math.floor((now.getTime() - r.createdAt.getTime()) / MS_PER_DAY)
        ),
        needsOnboarding: true, // enforced by the WHERE clause above
      }));
  }

  /**
   * One specific person, ignoring the timing window.
   *
   * For the ops script only: previewing a real user's nudge, and firing one on
   * demand. Deliberately skips the createdAt window (the whole point is to act
   * outside it) but NOT the opt-out check — someone who unsubscribed stays
   * unsubscribed no matter who is typing the command.
   */
  async getCandidateById(
    userId: number,
    now: Date
  ): Promise<NudgeCandidate | null> {
    const [row] = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        optedOutAt: users.emailOptedOutAt,
        needsOnboarding: users.needsOnboarding,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!row || !row.createdAt || row.optedOutAt) return null;

    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt,
      stalledDays: Math.max(
        1,
        Math.floor((now.getTime() - row.createdAt.getTime()) / MS_PER_DAY)
      ),
      // Nullable in the schema, and null defaults to "needs onboarding".
      needsOnboarding: row.needsOnboarding !== false,
    };
  }

  /**
   * Atomically claim the right to nudge this user.
   *
   * Same conditional-UPDATE idempotency as the signup alert: several Render
   * instances can run the scan at once, and only the one whose UPDATE matches a
   * row gets a timestamp back. Everyone else no-ops. Claiming BEFORE sending is
   * the deliberate trade — a crash between claim and send costs one missed
   * nudge, where the reverse costs a duplicate in a customer's inbox.
   */
  async claimNudge(userId: number): Promise<Date | null> {
    const claimedAt = getCurrentUTCDate();
    const [claimed] = await this.db
      .update(users)
      .set({ onboardingNudgeSentAt: claimedAt })
      .where(and(eq(users.id, userId), isNull(users.onboardingNudgeSentAt)))
      .returning({ id: users.id });

    return claimed ? claimedAt : null;
  }

  /**
   * Give the claim back when the send fails, so a later run can retry. Guarded
   * on the exact timestamp this caller wrote, so a concurrent re-claim isn't
   * clobbered.
   */
  async releaseNudge(userId: number, claimedAt: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ onboardingNudgeSentAt: null })
      .where(and(eq(users.id, userId), eq(users.onboardingNudgeSentAt, claimedAt)));
  }

  /**
   * Record an unsubscribe. Idempotent — a second click keeps the original
   * timestamp, so the opt-out date stays honest.
   *
   * Returns false only when the id matches no row. Note this is reachable from
   * an UNAUTHENTICATED link, so it must never write anything but this column.
   */
  async optOut(userId: number): Promise<boolean> {
    const [updated] = await this.db
      .update(users)
      .set({ emailOptedOutAt: getCurrentUTCDate() })
      .where(and(eq(users.id, userId), isNull(users.emailOptedOutAt)))
      .returning({ id: users.id });

    if (updated) return true;

    // Either already opted out (fine, idempotent) or no such user.
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));

    return Boolean(existing);
  }

  /**
   * Send one nudge, claim-first.
   *
   * MUST NOT THROW: the caller is a scheduled job iterating a list, and one
   * bad address must not abort the rest of the run. Every failure mode resolves
   * to a NudgeOutcome.
   */
  async sendNudge(candidate: NudgeCandidate): Promise<NudgeOutcome> {
    try {
      if (!isOnboardingNudgeEnabled()) return "disabled";

      // Compliance gate, before any send. No postal address means this is not
      // a legal commercial email, so it does not go out — by construction
      // rather than by anyone remembering.
      const postalAddress = companyPostalAddress();
      if (!postalAddress) return "no-address";

      if (isSuppressedNudgeEmail(candidate.email)) return "suppressed";

      const claimedAt = await this.claimNudge(candidate.userId);
      if (!claimedAt) return "already-sent";

      try {
        await emailService.sendOnboardingNudgeEmail({
          to: candidate.email,
          name: candidate.name,
          userId: candidate.userId,
          postalAddress,
        });
        return "sent";
      } catch (error) {
        await this.releaseNudge(candidate.userId, claimedAt);
        logger.error("Onboarding nudge send failed", error as Error, {
          operation: "sendNudge",
          metadata: { userId: candidate.userId },
        });
        return "send-failed";
      }
    } catch (error) {
      logger.error("Onboarding nudge failed", error as Error, {
        operation: "sendNudge",
        metadata: { userId: candidate.userId },
      });
      return "send-failed";
    }
  }
}

export const onboardingNudgeService = new OnboardingNudgeService();
