import { describe, it, expect } from "@jest/globals";
import {
  createLoggedActivitySchema,
  LOGGED_ACTIVITY_TYPES,
  MAX_ACTIVITY_DURATION_MINUTES,
} from "@/models/logged-activity.schema";

const valid = {
  date: "2026-09-22",
  activityType: "walk" as const,
  durationMinutes: 20,
};

describe("createLoggedActivitySchema [LR-077]", () => {
  it("accepts the minimum a user can actually give us", () => {
    // Type + duration + date. Effort and notes are genuinely optional — most
    // people will log a walk and leave, and requiring more is friction at the
    // exact moment the feature exists to remove it.
    const parsed = createLoggedActivitySchema.parse(valid);
    expect(parsed.activityType).toBe("walk");
    expect(parsed.durationMinutes).toBe(20);
  });

  it("rejects a userId smuggled in the body", () => {
    // Identity comes from the verified JWT. If this ever started passing
    // through, a caller could file activities against someone else's account.
    const parsed = createLoggedActivitySchema.parse({
      ...valid,
      userId: 999,
    }) as Record<string, unknown>;
    expect(parsed.userId).toBeUndefined();
  });

  it("requires a label when the type is 'other'", () => {
    // An unlabeled "Other" is an unreadable row in the UI and an uncountable
    // one in analytics.
    expect(() =>
      createLoggedActivitySchema.parse({ ...valid, activityType: "other" })
    ).toThrow();

    expect(() =>
      createLoggedActivitySchema.parse({
        ...valid,
        activityType: "other",
        customType: "Pickleball",
      })
    ).not.toThrow();
  });

  it("does not require a label for a known type", () => {
    expect(() =>
      createLoggedActivitySchema.parse({ ...valid, activityType: "swim" })
    ).not.toThrow();
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    // The column is compared as a string against planDays.date; any other
    // shape silently sorts and windows wrong rather than failing loudly.
    for (const date of ["09/22/2026", "2026-9-22", "2026-09-22T10:00:00Z"]) {
      expect(() =>
        createLoggedActivitySchema.parse({ ...valid, date })
      ).toThrow();
    }
  });

  it("rejects a duration that is zero, negative, or absurd", () => {
    for (const durationMinutes of [0, -30, MAX_ACTIVITY_DURATION_MINUTES + 1]) {
      expect(() =>
        createLoggedActivitySchema.parse({ ...valid, durationMinutes })
      ).toThrow();
    }
    expect(() =>
      createLoggedActivitySchema.parse({
        ...valid,
        durationMinutes: MAX_ACTIVITY_DURATION_MINUTES,
      })
    ).not.toThrow();
  });

  it("rejects an activity type outside the vocabulary", () => {
    expect(() =>
      createLoggedActivitySchema.parse({ ...valid, activityType: "sauna" })
    ).toThrow();
  });

  it("keeps 'other' as the only free-text escape hatch", () => {
    // If a second catch-all is ever added, the analytics claim that these rows
    // are countable stops being true — so assert the shape of the vocabulary.
    expect(LOGGED_ACTIVITY_TYPES).toContain("other");
    expect(LOGGED_ACTIVITY_TYPES.filter((t) => t === "other")).toHaveLength(1);
  });

  it("caps notes so a paste can't become the row", () => {
    expect(() =>
      createLoggedActivitySchema.parse({ ...valid, notes: "x".repeat(501) })
    ).toThrow();
  });
});
