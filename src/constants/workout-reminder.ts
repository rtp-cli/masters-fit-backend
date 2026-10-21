/**
 * Configuration for the daily workout reminder — one push notification on the
 * morning of a planned workout day, in the user's own timezone.
 *
 * Why push and not email: some testers rarely read email (2026-10-20 feedback),
 * and push is already wired for "plan ready" / "regenerated" / billing. Push
 * needs no postal address, no unsubscribe link and no per-message cost; the
 * opt-out is the in-app Settings switch (users.workout_reminders_enabled).
 *
 * Same conventions as activation-nudge.ts: every value is read from
 * `process.env` at CALL time so the kill switch is honest and tests can flip a
 * setting without re-importing.
 */

/**
 * Master kill switch, checked before ANY work happens. Unset means off, so
 * merging this code pushes to nobody until the env var is set in Render.
 */
export function isWorkoutReminderEnabled(): boolean {
  return process.env.WORKOUT_REMINDER_ENABLED === "true";
}

/**
 * The local hour (0-23) the reminder goes out, in each user's own timezone.
 *
 * 8am: early enough to plan the day around the session, late enough not to be
 * the thing that wakes someone up. The scan runs hourly, so any hour works.
 */
export function workoutReminderLocalHour(): number {
  const parsed = Number(process.env.WORKOUT_REMINDER_LOCAL_HOUR);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 8;
}

/**
 * Accounts that must never get the reminder.
 *
 * Every rtp+…@mastersfit.ai address is an internal account (the nightly-reseeded
 * demo user, QA, reviewer logins) — the demo user's plan is re-anchored to
 * today every morning, so without this whichever phone is logged into it would
 * be pinged daily, and its Settings switch resets with every reseed. The owner
 * account (rtp@) is deliberately NOT suppressed: it is how the reminder gets
 * seen on a real phone. WORKOUT_REMINDER_SUPPRESS adds addresses without a
 * deploy.
 *
 * A null email (a future phone-only account) is NOT suppressed — push needs no
 * address.
 */
export function isSuppressedReminderEmail(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (/^rtp\+[^@]*@mastersfit\.ai$/.test(normalized)) return true;
  return (process.env.WORKOUT_REMINDER_SUPPRESS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

/**
 * The user's local calendar date (YYYY-MM-DD) and hour (0-23) at `now`.
 *
 * Returns null for a missing or invalid IANA timezone rather than guessing:
 * a reminder at the wrong hour (3am) is worse than no reminder, and the
 * profile timezone is persisted on every app open, so it heals itself.
 */
export function localDateAndHour(
  timezone: string | null | undefined,
  now: Date
): { date: string; hour: number } | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const hour = Number(get("hour"));
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    if (!Number.isInteger(hour) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return null;
    }
    return { date, hour };
  } catch {
    return null;
  }
}
