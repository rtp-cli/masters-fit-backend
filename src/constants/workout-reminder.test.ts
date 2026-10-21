import { describe, it, expect, afterEach } from "@jest/globals";

import {
  isSuppressedReminderEmail,
  isWorkoutReminderEnabled,
  localDateAndHour,
  workoutReminderLocalHour,
} from "@/constants/workout-reminder";

describe("workout reminder config", () => {
  afterEach(() => {
    delete process.env.WORKOUT_REMINDER_ENABLED;
    delete process.env.WORKOUT_REMINDER_LOCAL_HOUR;
    delete process.env.WORKOUT_REMINDER_SUPPRESS;
  });

  it("is OFF unless the env flag is exactly 'true'", () => {
    expect(isWorkoutReminderEnabled()).toBe(false);
    process.env.WORKOUT_REMINDER_ENABLED = "1";
    expect(isWorkoutReminderEnabled()).toBe(false);
    process.env.WORKOUT_REMINDER_ENABLED = "true";
    expect(isWorkoutReminderEnabled()).toBe(true);
  });

  it("defaults to 8am and rejects out-of-range overrides", () => {
    expect(workoutReminderLocalHour()).toBe(8);
    process.env.WORKOUT_REMINDER_LOCAL_HOUR = "17";
    expect(workoutReminderLocalHour()).toBe(17);
    process.env.WORKOUT_REMINDER_LOCAL_HOUR = "24";
    expect(workoutReminderLocalHour()).toBe(8);
    process.env.WORKOUT_REMINDER_LOCAL_HOUR = "nope";
    expect(workoutReminderLocalHour()).toBe(8);
  });

  it("suppresses internal rtp+ accounts but not the owner or phone-only users", () => {
    expect(isSuppressedReminderEmail("rtp+demo@mastersfit.ai")).toBe(true);
    expect(isSuppressedReminderEmail("RTP+QA@mastersfit.ai")).toBe(true);
    expect(isSuppressedReminderEmail("rtp@mastersfit.ai")).toBe(false);
    expect(isSuppressedReminderEmail("someone@example.com")).toBe(false);
    expect(isSuppressedReminderEmail(null)).toBe(false);
  });

  it("honours the WORKOUT_REMINDER_SUPPRESS env list", () => {
    process.env.WORKOUT_REMINDER_SUPPRESS = " Someone@Example.com ,other@x.io";
    expect(isSuppressedReminderEmail("someone@example.com")).toBe(true);
  });
});

describe("localDateAndHour", () => {
  // 2026-10-21 13:30 UTC
  const now = new Date(Date.UTC(2026, 9, 21, 13, 30));

  it("returns the user's local date and hour", () => {
    expect(localDateAndHour("America/Chicago", now)).toEqual({
      date: "2026-10-21",
      hour: 8,
    });
    expect(localDateAndHour("America/Los_Angeles", now)).toEqual({
      date: "2026-10-21",
      hour: 6,
    });
  });

  it("rolls the local date across midnight", () => {
    // 13:30 UTC is 00:30 the NEXT day in Sydney (UTC+11 in October).
    expect(localDateAndHour("Australia/Sydney", now)).toEqual({
      date: "2026-10-22",
      hour: 0,
    });
  });

  it("returns null (no reminder) for a missing or invalid timezone", () => {
    expect(localDateAndHour(null, now)).toBeNull();
    expect(localDateAndHour("", now)).toBeNull();
    expect(localDateAndHour("Not/AZone", now)).toBeNull();
  });
});
