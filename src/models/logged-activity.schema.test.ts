import { describe, it, expect } from "@jest/globals";
import {
  createLoggedActivitySchema,
  importActivitiesSchema,
  importedActivitySchema,
  MAX_IMPORT_BATCH,
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

describe("createLoggedActivitySchema — import-only fields", () => {
  it("strips source / externalId / dismissedAt from a manual log", () => {
    // The manual sheet must not be able to forge a watch-sourced row or a
    // tombstone that would block a real import.
    const parsed = createLoggedActivitySchema.parse({
      ...valid,
      source: "apple_health",
      externalId: "abc",
      dismissedAt: new Date().toISOString(),
    }) as Record<string, unknown>;
    expect(parsed.source).toBeUndefined();
    expect(parsed.externalId).toBeUndefined();
    expect(parsed.dismissedAt).toBeUndefined();
  });
});

describe("importedActivitySchema", () => {
  const imported = {
    externalId: "6F1C-UUID",
    source: "apple_health" as const,
    activityType: "walk" as const,
    date: "2026-10-08",
    startedAt: "2026-10-08T12:00:00.000Z",
    endedAt: "2026-10-08T12:45:00.000Z",
    durationMinutes: 45,
  };

  it("accepts a mapped watch workout", () => {
    expect(importedActivitySchema.parse(imported).externalId).toBe("6F1C-UUID");
  });

  it("accepts offset timestamps from the device", () => {
    expect(() =>
      importedActivitySchema.parse({
        ...imported,
        startedAt: "2026-10-08T07:00:00.000-05:00",
        endedAt: "2026-10-08T07:45:00.000-05:00",
      })
    ).not.toThrow();
  });

  it("rejects source 'manual' — imports are never manual", () => {
    expect(() =>
      importedActivitySchema.parse({ ...imported, source: "manual" })
    ).toThrow();
  });

  it("rejects an end before the start", () => {
    expect(() =>
      importedActivitySchema.parse({
        ...imported,
        endedAt: "2026-10-08T11:00:00.000Z",
      })
    ).toThrow();
  });

  it("requires a label for 'other'", () => {
    expect(() =>
      importedActivitySchema.parse({ ...imported, activityType: "other" })
    ).toThrow();
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: MAX_IMPORT_BATCH + 1 }, (_, i) => ({
      ...imported,
      externalId: `id-${i}`,
    }));
    expect(() => importActivitiesSchema.parse({ activities: many })).toThrow();
  });
});
