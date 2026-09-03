import { and, desc, eq, gte, isNull, lte, or, sql, inArray } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { users, refreshTokens } from "@/models/user.schema";
import { authCodes } from "@/models/auth.schema";
import { stalledSigninReports } from "@/models/signup-notification.schema";
import { profiles } from "@/models/profile.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { getCurrentUTCDate } from "@/utils/date.utils";
import { emailService } from "@/services/email.service";
import { logger } from "@/utils/logger";
import {
  isSignupNotifyEnabled,
  isSuppressedSignupEmail,
  stalledSignupMaxDays,
  stalledSignupMinHours,
} from "@/constants/signup-notifications";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** How far back the daily job looks for alerts that failed to send. */
const ALERT_SWEEP_WINDOW_HOURS = 48;

/**
 * Timezone the alerts are written for — these emails have exactly one reader,
 * and a bare "12:41 PM" in UTC would make them do arithmetic every morning.
 */
const OWNER_TIMEZONE = process.env.OWNER_TIMEZONE || "America/Chicago";

/** Everything the "new user finished onboarding" alert needs, in one read. */
export interface NewUserSnapshot {
  userId: number;
  name: string;
  email: string;
  createdAt: Date | null;
  completedAt: Date;
  subscriptionStatus: string | null;
  profile: {
    age: number | null;
    gender: string | null;
    fitnessLevel: string | null;
    goals: string[] | null;
    availableDays: string[] | null;
    workoutDuration: number | null;
    environment: string | null;
    equipment: string[] | null;
    otherEquipment: string | null;
    limitations: string[] | null;
  } | null;
}

/** One person on the stalled-signup worklist. */
export interface StalledSignup {
  userId: number;
  name: string;
  email: string;
  createdAt: Date;
  stalledDays: number;
  /** True when a sign-in was completed — i.e. they got past the code screen. */
  hasSignedIn: boolean;
  /** Most recent session token issued. Proxy for "last signed in", not last-active. */
  lastSignInAt: Date | null;
  /** False once they've appeared in a digest — this is what gates today's send. */
  isNewToDigest: boolean;
}

/**
 * Someone who was mailed a sign-in code and never came back. There is NO user
 * row for these people and never was — the account is created at the name
 * screen, after a code is verified — so an address is all we have. No name was
 * ever collected.
 */
export interface StalledSignIn {
  email: string;
  /** When the first code went out. */
  firstCodeSentAt: Date;
  /** When the most recent code went out — several means they kept trying. */
  lastCodeSentAt: Date;
  codesSent: number;
  /** Failed verify attempts across their codes. >0 means a code WAS entered, wrongly. */
  failedAttempts: number;
  stalledDays: number;
  /** False once the address has appeared in a digest. */
  isNewToDigest: boolean;
}

export interface StalledSignupReport {
  stalled: StalledSignup[];
  /** Subset of `stalled` never reported before. */
  newlyStalled: StalledSignup[];
  /** Addresses that never completed a sign-in at all. */
  stalledSignIns: StalledSignIn[];
  /** Subset of `stalledSignIns` never reported before. */
  newlyStalledSignIns: StalledSignIn[];
  /** Nothing new anywhere means: send nothing. */
  hasAnythingNew: boolean;
  signupsLast7Days: number;
  finishedLast7Days: number;
}

/**
 * Read/claim layer for the two internal signup notifications. Kept in its own
 * service so every database statement these features add lives in one file —
 * none of it sits in the auth or onboarding services.
 *
 * Nothing here writes to a column any user-facing flow reads. The only two
 * columns it touches, `signup_notified_at` and `stalled_digest_notified_at`,
 * exist solely for these emails and are deliberately absent from
 * `updateUserSchema`, so no API request can write them either.
 */
export class SignupNotificationService extends BaseService {
  /**
   * Atomically claim the right to send this user's new-user alert.
   *
   * The conditional UPDATE is the whole idempotency story: three separate
   * controller paths can complete onboarding, and several Render instances can
   * run at once, but only the caller whose UPDATE matches a row gets `true`.
   * Everyone else no-ops.
   */
  async claimNewUserAlert(userId: number): Promise<Date | null> {
    const claimedAt = getCurrentUTCDate();
    const [claimed] = await this.db
      .update(users)
      .set({ signupNotifiedAt: claimedAt })
      .where(and(eq(users.id, userId), isNull(users.signupNotifiedAt)))
      .returning({ id: users.id });

    return claimed ? claimedAt : null;
  }

  /**
   * Give the claim back when the send fails, so the daily sweep can retry it.
   * Guarded on the exact timestamp this caller wrote: if someone else has
   * re-claimed (and possibly already sent) in the meantime, this release
   * matches zero rows instead of clobbering their marker.
   */
  async releaseNewUserAlert(userId: number, claimedAt: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ signupNotifiedAt: null })
      .where(and(eq(users.id, userId), eq(users.signupNotifiedAt, claimedAt)));
  }

  /**
   * Everything the alert renders. Read-only by design: notably it selects the
   * subscription row directly rather than calling
   * `subscriptionService.getUserSubscription()`, which CREATES a trial row as a
   * side effect — a notification must never manufacture subscription state.
   */
  async getNewUserSnapshot(userId: number): Promise<NewUserSnapshot | null> {
    const [row] = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        subscriptionStatus: userSubscriptions.status,
        age: profiles.age,
        gender: profiles.gender,
        fitnessLevel: profiles.fitnessLevel,
        goals: profiles.goals,
        availableDays: profiles.availableDays,
        workoutDuration: profiles.workoutDuration,
        environment: profiles.environment,
        equipment: profiles.equipment,
        otherEquipment: profiles.otherEquipment,
        limitations: profiles.limitations,
        profileId: profiles.id,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(userSubscriptions, eq(userSubscriptions.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return null;

    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt,
      completedAt: getCurrentUTCDate(),
      subscriptionStatus: row.subscriptionStatus ?? null,
      profile: row.profileId
        ? {
            age: row.age ?? null,
            gender: row.gender ?? null,
            fitnessLevel: row.fitnessLevel ?? null,
            goals: row.goals ?? null,
            availableDays: row.availableDays ?? null,
            workoutDuration: row.workoutDuration ?? null,
            environment: row.environment ?? null,
            equipment: row.equipment ?? null,
            otherEquipment: row.otherEquipment ?? null,
            limitations: row.limitations ?? null,
          }
        : null,
    };
  }

  /**
   * Build the stalled-signup worklist: accounts that still need onboarding,
   * old enough to count as stalled but young enough that the sign-in evidence
   * is still in the database.
   *
   * The grouping signal is `refresh_tokens`, NOT `users.email_verified` — that
   * column is declared but nothing in the auth flow ever writes it, so it reads
   * `false` for every real account and would put verified people in the "never
   * signed in" bucket. A refresh-token row means a session was minted, which
   * only happens after a code is verified.
   */
  async getStalledSignupReport(now: Date): Promise<StalledSignupReport> {
    const oldest = new Date(now.getTime() - stalledSignupMaxDays() * MS_PER_DAY);
    const newest = new Date(now.getTime() - stalledSignupMinHours() * MS_PER_HOUR);
    const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);

    // The three reads are independent — one round trip's latency, not three.
    const [rows, stalledSignIns, recent] = await Promise.all([
      this.db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          createdAt: users.createdAt,
          stalledDigestNotifiedAt: users.stalledDigestNotifiedAt,
          sessionCount: sql<number>`count(${refreshTokens.id})`,
          lastSignInAt: sql<Date | null>`max(${refreshTokens.createdAt})`,
        })
        .from(users)
        .leftJoin(refreshTokens, eq(refreshTokens.userId, users.id))
        .where(
          and(
            eq(users.needsOnboarding, true),
            gte(users.createdAt, oldest),
            lte(users.createdAt, newest),
            // isActive defaults to true but is nullable — treat null as active.
            or(eq(users.isActive, true), isNull(users.isActive))
          )
        )
        .groupBy(users.id)
        .orderBy(desc(users.createdAt)),
      this.getStalledSignIns(now, oldest, newest),
      // Context counters. Fetched as rows rather than SQL counts so the same
      // suppression rule applies to the numbers and the list — at signup
      // volumes this is a handful of rows.
      this.db
        .select({ email: users.email, needsOnboarding: users.needsOnboarding })
        .from(users)
        .where(gte(users.createdAt, weekAgo)),
    ]);

    const stalled: StalledSignup[] = rows
      .filter((r) => !isSuppressedSignupEmail(r.email))
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
        hasSignedIn: Number(r.sessionCount) > 0,
        lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt) : null,
        isNewToDigest: r.stalledDigestNotifiedAt == null,
      }));

    const realRecent = recent.filter((r) => !isSuppressedSignupEmail(r.email));

    const newlyStalled = stalled.filter((s) => s.isNewToDigest);
    const newlyStalledSignIns = stalledSignIns.filter((s) => s.isNewToDigest);

    return {
      stalled,
      newlyStalled,
      stalledSignIns,
      newlyStalledSignIns,
      hasAnythingNew: newlyStalled.length > 0 || newlyStalledSignIns.length > 0,
      signupsLast7Days: realRecent.length,
      finishedLast7Days: realRecent.filter((r) => r.needsOnboarding === false).length,
    };
  }

  /**
   * Addresses that were mailed a sign-in code and never turned into an account.
   *
   * This group CANNOT come from the users table: the account is created at the
   * name screen, which only runs after a code is verified (auth.controller
   * §4.8 → §5, and the client confirms it — use-verify-controller routes a new
   * user to /name only on a successful verify). Someone who quits at the code
   * screen therefore leaves no user row at all, and no name was ever collected.
   * An `auth_codes` row is the only trace they leave.
   *
   * Emails are compared lowercased because nothing in the auth flow normalizes
   * case before storing either auth_codes.email or users.email.
   */
  private async getStalledSignIns(
    now: Date,
    oldest: Date,
    newest: Date
  ): Promise<StalledSignIn[]> {
    const rows = await this.db
      .select({
        email: sql<string>`lower(${authCodes.email})`.as("email"),
        firstCodeSentAt: sql<Date>`min(${authCodes.created_at})`,
        lastCodeSentAt: sql<Date>`max(${authCodes.created_at})`,
        codesSent: sql<number>`count(*)`,
        failedAttempts: sql<number>`coalesce(sum(${authCodes.attempts}), 0)`,
        reportedAt: sql<Date | null>`max(${stalledSigninReports.reportedAt})`,
      })
      .from(authCodes)
      // No account for this address — the defining condition of the group.
      .leftJoin(users, sql`lower(${users.email}) = lower(${authCodes.email})`)
      .leftJoin(
        stalledSigninReports,
        sql`${stalledSigninReports.email} = lower(${authCodes.email})`
      )
      .where(
        and(
          // Bound the scan to the reporting window...
          gte(authCodes.created_at, oldest),
          isNull(users.id)
        )
      )
      .groupBy(sql`lower(${authCodes.email})`)
      // ...but apply the grace period per PERSON, on their latest code. A
      // per-row cutoff hid the fresh code of someone actively retrying right
      // now, so they'd be reported mid-sign-in with an understated code count.
      .having(sql`max(${authCodes.created_at}) <= ${newest}`);

    return rows
      .filter((r) => !isSuppressedSignupEmail(r.email))
      .map((r) => {
        const first = new Date(r.firstCodeSentAt);
        return {
          email: r.email,
          firstCodeSentAt: first,
          lastCodeSentAt: new Date(r.lastCodeSentAt),
          codesSent: Number(r.codesSent),
          failedAttempts: Number(r.failedAttempts),
          stalledDays: Math.max(
            1,
            Math.floor((now.getTime() - first.getTime()) / MS_PER_DAY)
          ),
          isNewToDigest: r.reportedAt == null,
        };
      })
      .sort((a, b) => b.firstCodeSentAt.getTime() - a.firstCodeSentAt.getTime());
  }

  /**
   * Record that these addresses have been reported. Insert-only: an address
   * already in the ledger keeps its original timestamp, so it never becomes
   * "new" again just because another code was requested.
   */
  async markStalledSignInsReported(emails: string[], now: Date): Promise<void> {
    if (emails.length === 0) return;

    await this.db
      .insert(stalledSigninReports)
      .values(emails.map((email) => ({ email: email.toLowerCase(), reportedAt: now })))
      .onConflictDoNothing();
  }

  /**
   * Mark everyone in today's digest as reported. Called only AFTER a successful
   * send — if the email throws, nobody is marked and tomorrow's run treats them
   * as new again, so a failed send is never silently swallowed.
   */
  async markStalledDigestNotified(userIds: number[], now: Date): Promise<void> {
    if (userIds.length === 0) return;

    await this.db
      .update(users)
      .set({ stalledDigestNotifiedAt: now })
      .where(and(inArray(users.id, userIds), isNull(users.stalledDigestNotifiedAt)));
  }

  /**
   * Users who finished onboarding but whose alert never went out — a Resend
   * outage at completion time releases the claim, and this is the promised
   * retry consumer. Windowed to 48 hours: an email blip lasts minutes, and a
   * wider window would mass-backfill alerts for every recent signup the first
   * time the feature is switched on in an environment.
   */
  async getUnnotifiedCompletedSignups(now: Date): Promise<number[]> {
    const oldest = new Date(now.getTime() - ALERT_SWEEP_WINDOW_HOURS * MS_PER_HOUR);

    const rows = await this.db
      .select({ userId: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.needsOnboarding, false),
          isNull(users.signupNotifiedAt),
          gte(users.createdAt, oldest),
          or(eq(users.isActive, true), isNull(users.isActive))
        )
      );

    return rows
      .filter((r) => !isSuppressedSignupEmail(r.email))
      .map((r) => r.userId);
  }

  /**
   * Send the new-user alert for a user who just completed onboarding.
   *
   * THIS FUNCTION MUST NEVER THROW AND MUST NEVER BE AWAITED IN A REQUEST.
   * It sits downstream of onboarding completion, which has already committed a
   * profile and is about to return 200 to a person standing in the app. Every
   * failure mode — kill switch off, missing user, database error, Resend
   * outage — resolves to a `DispatchOutcome`, never a rejection. The caller
   * fires it with `void` so not one millisecond of email work lands in the
   * response path.
   *
   * The return value exists for tests and the ops script; callers in a request
   * path ignore it.
   */
  async dispatchNewUserAlert(userId: number): Promise<DispatchOutcome> {
    try {
      // Kill switch first, before any database work. Unset env → this feature
      // is inert, which is how it ships.
      if (!isSignupNotifyEnabled()) return "disabled";

      const snapshot = await this.getNewUserSnapshot(userId);
      if (!snapshot) return "skipped";
      if (isSuppressedSignupEmail(snapshot.email)) return "suppressed";

      // Claim BEFORE sending: whoever wins the atomic update owns the send.
      const claimedAt = await this.claimNewUserAlert(userId);
      if (!claimedAt) return "already-sent";

      try {
        await emailService.sendNewUserNotificationEmail({
          userId: snapshot.userId,
          name: snapshot.name,
          email: snapshot.email,
          signedUpAgo: formatRelativeAge(snapshot.createdAt, snapshot.completedAt),
          completedAt: formatClockTime(snapshot.completedAt),
          subscriptionStatus: snapshot.subscriptionStatus,
          profileRows: buildProfileRows(snapshot),
          compCommand: `npm run comp-user -- ${snapshot.email}`,
        });
        return "sent";
      } catch (sendError) {
        // Hand the claim back so the daily sweep can retry this user.
        await this.releaseNewUserAlert(userId, claimedAt).catch((releaseError) =>
          logger.error(
            "Failed to release new-user alert claim after send failure",
            releaseError as Error,
            { operation: "dispatchNewUserAlert", userId }
          )
        );
        throw sendError;
      }
    } catch (error) {
      // Swallowing is the point: onboarding already succeeded for this person.
      // Log loudly (Sentry picks this up) but never propagate.
      logger.error("New-user alert dispatch failed", error as Error, {
        operation: "dispatchNewUserAlert",
        userId,
      });
      return "failed";
    }
  }
}

export type DispatchOutcome =
  | "sent"
  | "disabled"
  | "suppressed"
  | "skipped"
  | "already-sent"
  | "failed";

/** "6 minutes ago" / "2 hours ago" / "3 days ago" — coarse on purpose. */
export function formatRelativeAge(from: Date | null, to: Date): string {
  if (!from) return "at an unknown time";

  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "12:41 PM CDT" in the owner's timezone — the person reading the alert. */
export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: OWNER_TIMEZONE,
    timeZoneName: "short",
  }).format(date);
}

/** "Sep 2" — short date in the owner's timezone. */
export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: OWNER_TIMEZONE,
  }).format(date);
}

/**
 * Turn a profile into the display rows. Deliberately omits `medicalNotes`:
 * free-text health detail does not belong in an ops inbox. `limitations` is
 * included because it is a fixed vocabulary and it says the most about whether
 * the product fits the person.
 */
export function buildProfileRows(
  snapshot: NewUserSnapshot
): { label: string; value: string }[] {
  const p = snapshot.profile;
  if (!p) return [];

  const rows: { label: string; value: string }[] = [];

  const identity = [
    p.age != null ? String(p.age) : null,
    p.gender,
    p.fitnessLevel,
  ].filter(Boolean);
  if (identity.length > 0) rows.push({ label: "Profile", value: identity.join(" · ") });

  if (p.goals?.length) {
    rows.push({ label: "Goals", value: p.goals.map(humanize).join(", ") });
  }

  const schedule = [
    p.availableDays?.length
      ? `${p.availableDays.length} day${p.availableDays.length === 1 ? "" : "s"} a week`
      : null,
    p.workoutDuration ? `${p.workoutDuration} minutes` : null,
  ].filter(Boolean);
  if (schedule.length > 0) rows.push({ label: "Schedule", value: schedule.join(" · ") });

  const kit = [...(p.equipment ?? []), p.otherEquipment].filter(Boolean) as string[];
  const location = [
    p.environment ? humanize(p.environment) : null,
    kit.length > 0 ? kit.map(humanize).join(", ") : null,
  ].filter(Boolean);
  if (location.length > 0) {
    rows.push({ label: "Training at", value: location.join(" — ") });
  }

  if (p.limitations?.length) {
    rows.push({ label: "Limitations", value: p.limitations.map(humanize).join(", ") });
  }

  return rows;
}

/** "home_gym" / "lower-back" → "Home gym" / "Lower back". */
function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const signupNotificationService = new SignupNotificationService();
