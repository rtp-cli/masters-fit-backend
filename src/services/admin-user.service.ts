import { sql } from "drizzle-orm";
import { userSubscriptions } from "@/models";
import { AccessTier } from "@/constants/access-policy";
import { shouldSendCompEmail } from "@/constants/comp-notification";
import { emailService } from "@/services/email.service";
import { BACKEND_ANALYTICS_EVENT } from "@/constants/analytics-events";
import { isInternalAccount } from "@/constants/usage-report";
import { logger } from "@/utils/logger";
import { BaseService } from "./base.service";

export interface AdminUserSummary {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: Date | null;
  needsOnboarding: boolean | null;
  accessOverride: string | null;
  subscriptionStatus: string | null;
  /** From the user's latest app_opened event; null = no open recorded (tracking began 2026-09-17). */
  platform: DevicePlatform | null;
  lastOpenedAt: Date | null;
}

export type DevicePlatform = "ios" | "android" | "web";
export type PlatformFilter = DevicePlatform | "unknown";

export interface PlatformSplit {
  ios: number;
  android: number;
  web: number;
  unknown: number;
  /** Real users only — same internal-account rule as the weekly usage report. */
  total: number;
}

export interface AdminUserActivity {
  kind: "session" | "activity";
  /** The plan day's or activity's calendar date (YYYY-MM-DD). */
  date: string;
  label: string;
  at: Date;
}

export interface AdminUserDetail extends AdminUserSummary {
  uuid: string;
  isActive: boolean | null;
  hasPushToken: boolean;
  fitnessLevel: string | null;
  timezone: string | null;
  subscription: {
    status: string;
    planId: string | null;
    startDate: Date | null;
    endDate: Date | null;
    accessOverride: string | null;
    accessOverrideExpiresAt: Date | null;
  } | null;
  stats: {
    sessionsEver: number;
    sessionsLast30: number;
    activitiesLast30: number;
    lastTrainedAt: Date | null;
  };
  recent: AdminUserActivity[];
  device: {
    platform: DevicePlatform | null;
    appVersion: string | null;
    lastOpenedAt: Date | null;
    /** Every platform this user has opened the app on, e.g. ["ios", "android"]. */
    platformsSeen: DevicePlatform[];
  };
}

export interface SetCompResult extends Record<string, unknown> {
  changed: boolean;
  accessOverride: string | null;
  emailed: boolean;
  emailError?: string;
}

/** Thrown for request-level problems the route should answer as 4xx. */
export class AdminUserError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409) {
    super(message);
  }
}

const SEARCH_LIMIT = 25;

/**
 * The user's most recent app_opened event — the app reports platform + version
 * on every launch. Served by idx_analytics_events_user_event
 * (user_id, event_name, created_at). Alias: lo.
 */
const LAST_OPEN_JOIN = sql`
  left join lateral (
    select ae.properties->>'platform' as platform,
      ae.properties->>'app_version' as app_version,
      ae.created_at as opened_at
    from analytics_events ae
    where ae.user_id = u.id and ae.event_name = ${BACKEND_ANALYTICS_EVENT.APP_OPENED}
    order by ae.created_at desc
    limit 1
  ) lo on true`;

/**
 * Raw db.execute rows hand timestamptz back as strings with a short offset
 * ("2026-10-22 07:36:20.68-05"), which not every client parses. A Date
 * serialises as ISO-8601 instead.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asPlatform(value: string | null | undefined): DevicePlatform | null {
  return value === "ios" || value === "android" || value === "web" ? value : null;
}

/**
 * Read + action layer for the admin console's Users section. Reads run in a
 * read-only transaction (same posture as usage-report.service), so a bug here
 * can't write. Writes go through adminActionService.run at the route.
 */
class AdminUserService extends BaseService {
  /**
   * Email, phone, or name — case-insensitive substring. A bare number also
   * matches the user id exactly. Empty query → most recent signups.
   */
  async search(query: string, platform?: PlatformFilter): Promise<AdminUserSummary[]> {
    const q = query.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const asId = /^\d+$/.test(q) ? Number(q) : -1;
    // Digits only, so "(312) 555-0123" finds the stored "+13125550123".
    const digits = q.replace(/\D/g, "");
    const phoneLike = digits.length >= 3 ? `%${digits}%` : null;

    const result = await this.db.execute<{
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      created_at: Date | null;
      needs_onboarding: boolean | null;
      access_override: string | null;
      status: string | null;
      platform: string | null;
      opened_at: Date | null;
    }>(sql`
      select u.id, u.name, u.email, u.phone, u.created_at, u.needs_onboarding,
        s.access_override, s.status, lo.platform, lo.opened_at
      from users u
      left join user_subscriptions s on s.user_id = u.id
      ${LAST_OPEN_JOIN}
      where (${q === ""}
        or u.id = ${asId}
        or u.email ilike ${like}
        or u.name ilike ${like}
        or (${phoneLike}::text is not null and u.phone like ${phoneLike}))
        and (${platform ?? null}::text is null
          or (${platform ?? null}::text = 'unknown' and lo.platform is null)
          or lo.platform = ${platform ?? null}::text)
      order by u.created_at desc nulls last
      limit ${SEARCH_LIMIT}
    `);

    return result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      email: r.email,
      phone: r.phone,
      createdAt: r.created_at,
      needsOnboarding: r.needs_onboarding,
      accessOverride: r.access_override,
      subscriptionStatus: r.status,
      platform: asPlatform(r.platform),
      lastOpenedAt: toDate(r.opened_at),
    }));
  }

  async getDetail(userId: number): Promise<AdminUserDetail | null> {
    return this.db.transaction(
      async (tx) => {
        const userRows = await tx.execute<{
          id: number;
          uuid: string;
          name: string;
          email: string | null;
          phone: string | null;
          created_at: Date | null;
          needs_onboarding: boolean | null;
          is_active: boolean | null;
          has_push_token: boolean;
          fitness_level: string | null;
          timezone: string | null;
        }>(sql`
          select u.id, u.uuid, u.name, u.email, u.phone, u.created_at,
            u.needs_onboarding, u.is_active,
            (u.push_notification_token is not null) as has_push_token,
            p.fitness_level, p.timezone
          from users u
          left join profiles p on p.user_id = u.id
          where u.id = ${userId}
        `);
        const u = userRows.rows[0];
        if (!u) return null;

        const [sub] = await tx
          .select()
          .from(userSubscriptions)
          .where(this.eq(userSubscriptions.userId, userId))
          .limit(1);

        // A session = a plan day with at least one exercise logged, dated by
        // its first log — the same definition the weekly usage report uses.
        const sessions = await tx.execute<{
          plan_day_id: number;
          date: string;
          name: string | null;
          started_at: Date;
        }>(sql`
          select pd.id as plan_day_id, pd.date, pd.name, min(el.created_at) as started_at
          from exercise_logs el
          join plan_day_exercises pde on pde.id = el.plan_day_exercise_id
          join workout_blocks wb on wb.id = pde.workout_block_id
          join plan_days pd on pd.id = wb.plan_day_id
          join workouts w on w.id = pd.workout_id
          where w.user_id = ${userId}
          group by pd.id, pd.date, pd.name
          order by started_at desc
        `);

        const activities = await tx.execute<{
          date: string;
          activity_type: string;
          custom_type: string | null;
          duration_minutes: number;
          created_at: Date;
        }>(sql`
          select date, activity_type, custom_type, duration_minutes, created_at
          from logged_activities
          where user_id = ${userId} and dismissed_at is null
          order by created_at desc
        `);

        const opens = await tx.execute<{
          platform: string | null;
          app_version: string | null;
          created_at: Date;
        }>(sql`
          select properties->>'platform' as platform,
            properties->>'app_version' as app_version, created_at
          from analytics_events
          where user_id = ${userId} and event_name = ${BACKEND_ANALYTICS_EVENT.APP_OPENED}
          order by created_at desc
        `);
        const lastOpen = opens.rows[0];
        const platformsSeen = [
          ...new Set(opens.rows.map((o) => asPlatform(o.platform)).filter((p): p is DevicePlatform => !!p)),
        ];

        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const within30 = (d: Date) => new Date(d).getTime() >= cutoff;

        const recent: AdminUserActivity[] = [
          ...sessions.rows.slice(0, 15).map((s) => ({
            kind: "session" as const,
            date: s.date,
            label: s.name || "Workout",
            at: new Date(s.started_at),
          })),
          ...activities.rows.slice(0, 15).map((a) => ({
            kind: "activity" as const,
            date: a.date,
            label: `${a.custom_type || a.activity_type} · ${a.duration_minutes} min`,
            at: new Date(a.created_at),
          })),
        ]
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, 15);

        const lastSession = sessions.rows[0]?.started_at;
        const lastActivity = activities.rows[0]?.created_at;
        const lastTrainedAt =
          [lastSession, lastActivity]
            .filter(Boolean)
            .map((d) => new Date(d as Date))
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

        return {
          id: Number(u.id),
          uuid: u.uuid,
          name: u.name,
          email: u.email,
          phone: u.phone,
          createdAt: u.created_at,
          needsOnboarding: u.needs_onboarding,
          isActive: u.is_active,
          hasPushToken: u.has_push_token,
          fitnessLevel: u.fitness_level,
          timezone: u.timezone,
          accessOverride: sub?.accessOverride ?? null,
          subscriptionStatus: sub?.status ?? null,
          platform: asPlatform(lastOpen?.platform),
          lastOpenedAt: toDate(lastOpen?.created_at),
          device: {
            platform: asPlatform(lastOpen?.platform),
            appVersion: lastOpen?.app_version ?? null,
            lastOpenedAt: toDate(lastOpen?.created_at),
            platformsSeen,
          },
          subscription: sub
            ? {
                status: sub.status,
                planId: sub.planId,
                startDate: sub.subscriptionStartDate,
                endDate: sub.subscriptionEndDate,
                accessOverride: sub.accessOverride,
                accessOverrideExpiresAt: sub.accessOverrideExpiresAt,
              }
            : null,
          stats: {
            sessionsEver: sessions.rows.length,
            sessionsLast30: sessions.rows.filter((s) => within30(s.started_at))
              .length,
            activitiesLast30: activities.rows.filter((a) =>
              within30(a.created_at)
            ).length,
            lastTrainedAt,
          },
          recent,
        };
      },
      { accessMode: "read only" }
    );
  }

  /**
   * How many real users are on each platform, by their most recent app open.
   * "unknown" = no app_opened recorded (tracking began 2026-09-17), not "web".
   */
  async platformSplit(): Promise<PlatformSplit> {
    const result = await this.db.execute<{ email: string | null; platform: string | null }>(sql`
      select coalesce(u.email, u.phone) as email, lo.platform
      from users u
      ${LAST_OPEN_JOIN}
    `);
    const split: PlatformSplit = { ios: 0, android: 0, web: 0, unknown: 0, total: 0 };
    for (const row of result.rows) {
      if (isInternalAccount(row.email)) continue;
      split[asPlatform(row.platform) ?? "unknown"] += 1;
      split.total += 1;
    }
    return split;
  }

  /**
   * Grant (COMPLIMENTARY, no expiry) or revoke a comp. Same rules as the
   * comp-user script (src/scripts/grant-comp-single.ts): needs an existing
   * user_subscriptions row, and the "you're on MastersFit+" email goes out only
   * per shouldSendCompEmail. The email never decides success — access is
   * written first and a send failure is reported in the result.
   */
  async setComp(
    userId: number,
    grant: boolean,
    opts: { sendEmail: boolean }
  ): Promise<SetCompResult> {
    const userRows = await this.db.execute<{
      email: string | null;
      name: string;
    }>(sql`select email, name from users where id = ${userId}`);
    const user = userRows.rows[0];
    if (!user) throw new AdminUserError("No user with that id", 404);

    const [sub] = await this.db
      .select({ accessOverride: userSubscriptions.accessOverride })
      .from(userSubscriptions)
      .where(this.eq(userSubscriptions.userId, userId))
      .limit(1);
    if (!sub) {
      throw new AdminUserError(
        "This user has no subscription record yet — they need to open the app once first.",
        409
      );
    }

    const target = grant ? AccessTier.COMPLIMENTARY : null;
    const changed = sub.accessOverride !== target;

    await this.db
      .update(userSubscriptions)
      .set({
        accessOverride: target,
        accessOverrideExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(this.eq(userSubscriptions.userId, userId));

    const notify = shouldSendCompEmail({
      noEmail: !opts.sendEmail,
      revoke: !grant,
      dryRun: false,
      priorOverride: sub.accessOverride,
      email: user.email,
    });

    if (!notify || !user.email) {
      return { changed, accessOverride: target, emailed: false };
    }

    try {
      await emailService.sendCompGrantedEmail({
        to: user.email,
        name: user.name,
      });
      return { changed, accessOverride: target, emailed: true };
    } catch (error) {
      logger.error("Comp applied but email failed", error as Error, {
        operation: "adminUser.setComp",
        userId,
      });
      return {
        changed,
        accessOverride: target,
        emailed: false,
        emailError: (error as Error).message,
      };
    }
  }
}

export const adminUserService = new AdminUserService();
