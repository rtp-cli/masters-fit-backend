import { sql } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import {
  isInternalAccount,
  usageReportTimezone,
} from "@/constants/usage-report";

/** How far a new signup got by the time the report ran. */
export type NewcomerStage = "signed-up" | "onboarded" | "has-plan" | "trained";

export interface Newcomer {
  userId: number;
  name: string;
  email: string;
  fitnessLevel: string | null;
  signedUpAt: Date;
  stage: NewcomerStage;
}

export interface TrainedUser {
  userId: number;
  name: string;
  /** Distinct plan days with at least one exercise logged this week. */
  sessions: number;
  /** Logged or imported activities (walks, runs, classes) this week. */
  activities: number;
}

export interface QuietUser {
  userId: number;
  name: string;
  email: string;
  /** Sessions + activities in the week before. */
  previousCount: number;
}

export interface MoneyEvent {
  type: string;
  userId: number;
  name: string;
  amount: number;
  at: Date;
}

/** One window's worth of comparable numbers. */
export interface WeekNumbers {
  /** Real users with any session or activity in the window. */
  active: number;
  sessions: number;
  activities: number;
  signups: number;
  revenue: number;
}

export interface UsageReport {
  /** [weekStart, weekEnd): the last full Monday–Sunday week, owner timezone. */
  weekStart: Date;
  weekEnd: Date;
  timezone: string;
  thisWeek: WeekNumbers;
  lastWeek: WeekNumbers;
  realUsers: number;
  /** Real users who have EVER logged a session or activity. */
  activatedEver: number;
  payingNow: number;
  /** Of payingNow, how many will renew (not cancelled). */
  renewing: number;
  comped: number;
  newcomers: Newcomer[];
  trained: TrainedUser[];
  wentQuiet: QuietUser[];
  moneyEvents: MoneyEvent[];
}

type UserRow = {
  id: number;
  email: string;
  name: string;
  created_at: Date;
  needs_onboarding: boolean | null;
  fitness_level: string | null;
};

type CountRow = {
  user_id: number;
  this_week: string;
  last_week: string;
  ever: string;
};

/**
 * Read layer for the weekly usage report. Every statement runs inside ONE
 * read-only transaction, so Postgres itself refuses a write — the report can be
 * run against production from a laptop without any way to change data.
 *
 * "Trained" means an exercise_logs row (joined up through the plan to reach the
 * user — exercise_logs has no user_id) or a logged_activities row. The plan_day
 * `is_complete` and plan_day_exercises `completed` flags are NOT used: they go
 * stale and undercount.
 */
export class UsageReportService extends BaseService {
  async buildReport(now: Date): Promise<UsageReport> {
    const tz = usageReportTimezone();

    return this.db.transaction(
      async (tx) => {
        // Last full Mon–Sun week in the owner's timezone, computed by Postgres
        // so DST boundaries come out right.
        const bounds = await tx.execute<{
          week_start: Date;
          week_end: Date;
          prev_start: Date;
        }>(sql`
          select
            (date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${tz}) - interval '7 days') at time zone ${tz} as week_start,
            date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${tz}) at time zone ${tz} as week_end,
            (date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${tz}) - interval '14 days') at time zone ${tz} as prev_start
        `);
        const weekStart = new Date(bounds.rows[0].week_start);
        const weekEnd = new Date(bounds.rows[0].week_end);
        const prevStart = new Date(bounds.rows[0].prev_start);

        const allUsers = await tx.execute<UserRow>(sql`
          select u.id, u.email, u.name, u.created_at, u.needs_onboarding, p.fitness_level
          from users u
          left join profiles p on p.user_id = u.id
          where u.created_at < ${weekEnd.toISOString()}::timestamptz
        `);
        const users = allUsers.rows.filter((u) => !isInternalAccount(u.email));
        const byId = new Map(users.map((u) => [u.id, u]));
        // Passed as one text parameter and split in SQL: safe, and avoids a
        // placeholder per user.
        const ids = users.map((u) => u.id).join(",");
        const idArray = sql`string_to_array(${ids}, ',')::int[]`;

        const windowCounts = (column: string) => sql`
          count(*) filter (where ${sql.raw(column)} >= ${weekStart.toISOString()}::timestamptz and ${sql.raw(column)} < ${weekEnd.toISOString()}::timestamptz) as this_week,
          count(*) filter (where ${sql.raw(column)} >= ${prevStart.toISOString()}::timestamptz and ${sql.raw(column)} < ${weekStart.toISOString()}::timestamptz) as last_week,
          count(*) filter (where ${sql.raw(column)} < ${weekEnd.toISOString()}::timestamptz) as ever`;

        // A session = a plan day with at least one exercise logged, dated by
        // its FIRST log so a workout spanning midnight counts once.
        const sessions = await tx.execute<CountRow>(sql`
          with session_starts as (
            select w.user_id, pd.id as plan_day_id, min(el.created_at) as started_at
            from exercise_logs el
            join plan_day_exercises pde on pde.id = el.plan_day_exercise_id
            join workout_blocks wb on wb.id = pde.workout_block_id
            join plan_days pd on pd.id = wb.plan_day_id
            join workouts w on w.id = pd.workout_id
            where w.user_id = any(${idArray})
            group by w.user_id, pd.id
          )
          select user_id, ${windowCounts("started_at")}
          from session_starts
          group by user_id
        `);

        const activities = await tx.execute<CountRow>(sql`
          select user_id, ${windowCounts("created_at")}
          from logged_activities
          where dismissed_at is null and user_id = any(${idArray})
          group by user_id
        `);

        const plans = await tx.execute<{ user_id: number }>(sql`
          select distinct user_id from workouts
          where user_id = any(${idArray})
            and created_at < ${weekEnd.toISOString()}::timestamptz
        `);

        // Subscription state is "as of now", not as of the week's end: the
        // table keeps no history.
        const subs = await tx.execute<{
          user_id: number;
          paying: boolean;
          renewing: boolean;
          comped: boolean;
        }>(sql`
          select user_id,
            (revenuecat_subscription_id is not null and access_override is null
              and status in ('active', 'cancelled')
              and subscription_end_date > ${now.toISOString()}::timestamptz) as paying,
            (status = 'active') as renewing,
            (access_override = 'COMPLIMENTARY'
              and (access_override_expires_at is null
                   or access_override_expires_at > ${now.toISOString()}::timestamptz)) as comped
          from user_subscriptions
          where user_id = any(${idArray})
        `);

        // Real-money store events only. SANDBOX events are our own testing.
        const money = await tx.execute<{
          event_type: string;
          app_user_id: string;
          price: string | null;
          created_at: Date;
        }>(sql`
          select event_type,
            payload::jsonb -> 'event' ->> 'app_user_id' as app_user_id,
            payload::jsonb -> 'event' ->> 'price' as price,
            created_at
          from webhook_events
          where payload::jsonb -> 'event' ->> 'environment' = 'PRODUCTION'
            and event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'EXPIRATION')
            and created_at >= ${prevStart.toISOString()}::timestamptz
            and created_at < ${weekEnd.toISOString()}::timestamptz
          order by created_at
        `);

        return assembleReport({
          weekStart,
          weekEnd,
          prevStart,
          timezone: tz,
          users,
          byId,
          sessions: sessions.rows,
          activities: activities.rows,
          planUserIds: new Set(plans.rows.map((r) => Number(r.user_id))),
          subs: subs.rows,
          money: money.rows,
        });
      },
      { accessMode: "read only" }
    );
  }
}

interface AssembleInput {
  weekStart: Date;
  weekEnd: Date;
  prevStart: Date;
  timezone: string;
  users: UserRow[];
  byId: Map<number, UserRow>;
  sessions: CountRow[];
  activities: CountRow[];
  planUserIds: Set<number>;
  subs: { user_id: number; paying: boolean; renewing: boolean; comped: boolean }[];
  money: { event_type: string; app_user_id: string; price: string | null; created_at: Date }[];
}

/** Pure: turns the raw rows into the report. Exported for tests. */
export function assembleReport(input: AssembleInput): UsageReport {
  const { weekStart, weekEnd, prevStart, users, byId } = input;

  const sessionsBy = new Map(input.sessions.map((r) => [Number(r.user_id), r]));
  const activitiesBy = new Map(input.activities.map((r) => [Number(r.user_id), r]));
  const n = (v: string | undefined) => Number(v ?? 0);

  const trained: TrainedUser[] = [];
  const wentQuiet: QuietUser[] = [];
  let activeThis = 0;
  let activePrev = 0;
  let activatedEver = 0;

  for (const user of users) {
    const s = sessionsBy.get(user.id);
    const a = activitiesBy.get(user.id);
    const thisCount = n(s?.this_week) + n(a?.this_week);
    const prevCount = n(s?.last_week) + n(a?.last_week);

    if (thisCount > 0) {
      activeThis++;
      trained.push({
        userId: user.id,
        name: user.name,
        sessions: n(s?.this_week),
        activities: n(a?.this_week),
      });
    }
    if (prevCount > 0) activePrev++;
    if (prevCount > 0 && thisCount === 0) {
      wentQuiet.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousCount: prevCount,
      });
    }
    if (n(s?.ever) + n(a?.ever) > 0) activatedEver++;
  }

  trained.sort(
    (x, y) => y.sessions + y.activities - (x.sessions + x.activities) || x.name.localeCompare(y.name)
  );

  const inWindow = (d: Date, from: Date, to: Date) => d >= from && d < to;

  const newcomers: Newcomer[] = users
    .filter((u) => inWindow(new Date(u.created_at), weekStart, weekEnd))
    .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
    .map((u) => {
      const s = sessionsBy.get(u.id);
      const a = activitiesBy.get(u.id);
      const stage: NewcomerStage =
        n(s?.ever) + n(a?.ever) > 0
          ? "trained"
          : input.planUserIds.has(u.id)
            ? "has-plan"
            : u.needs_onboarding === false
              ? "onboarded"
              : "signed-up";
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        fitnessLevel: u.fitness_level,
        signedUpAt: new Date(u.created_at),
        stage,
      };
    });

  const signupsPrev = users.filter((u) =>
    inWindow(new Date(u.created_at), prevStart, weekStart)
  ).length;

  // app_user_id is our numeric user id; anything else (anonymous RevenueCat
  // ids, internal accounts) is not a real user's money.
  const moneyEvents: MoneyEvent[] = input.money
    .filter((m) => byId.has(Number(m.app_user_id)))
    .map((m) => ({
      type: m.event_type,
      userId: Number(m.app_user_id),
      name: byId.get(Number(m.app_user_id))!.name,
      amount: Number(m.price ?? 0),
      at: new Date(m.created_at),
    }));

  const revenue = (from: Date, to: Date) =>
    round2(
      moneyEvents
        .filter(
          (m) =>
            (m.type === "INITIAL_PURCHASE" || m.type === "RENEWAL") &&
            inWindow(m.at, from, to)
        )
        .reduce((sum, m) => sum + m.amount, 0)
    );

  const sumWindow = (rows: CountRow[], key: "this_week" | "last_week") =>
    rows.reduce((sum, r) => sum + n(r[key]), 0);

  const realSubs = input.subs.filter((s) => byId.has(Number(s.user_id)));
  const paying = realSubs.filter((s) => s.paying);

  return {
    weekStart,
    weekEnd,
    timezone: input.timezone,
    thisWeek: {
      active: activeThis,
      sessions: sumWindow(input.sessions, "this_week"),
      activities: sumWindow(input.activities, "this_week"),
      signups: newcomers.length,
      revenue: revenue(weekStart, weekEnd),
    },
    lastWeek: {
      active: activePrev,
      sessions: sumWindow(input.sessions, "last_week"),
      activities: sumWindow(input.activities, "last_week"),
      signups: signupsPrev,
      revenue: revenue(prevStart, weekStart),
    },
    realUsers: users.length,
    activatedEver,
    payingNow: paying.length,
    renewing: paying.filter((s) => s.renewing).length,
    comped: realSubs.filter((s) => s.comped).length,
    newcomers,
    trained,
    wentQuiet,
    // Only this week's events are listed; last week's fed the comparison.
    moneyEvents: moneyEvents.filter((m) => inWindow(m.at, weekStart, weekEnd)),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const usageReportService = new UsageReportService();
