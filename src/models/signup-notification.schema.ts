import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per email address that has appeared in a stalled-signup digest as a
 * "never finished sign-in" — someone who was mailed a code and never came back,
 * so no `users` row was ever created for them and there is nowhere else to hang
 * the marker.
 *
 * Why its own table rather than a column on `auth_codes`:
 *  - auth_codes is per-CODE; this fact is per-ADDRESS. A person who requests
 *    three codes must still be reported once.
 *  - auth_codes rows get deleted (the bypass/test-OTP paths do it today, and a
 *    retention sweep is a known future fix). A marker living there would be
 *    silently erased and the address would be re-reported.
 *
 * The email is stored lowercased, because nothing in the auth flow normalizes
 * case before writing auth_codes.email or users.email.
 */
export const stalledSigninReports = pgTable("stalled_signin_reports", {
  /** Lowercased email address. */
  email: text("email").primaryKey(),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
});

export interface StalledSigninReport {
  email: string;
  reportedAt: Date;
}
