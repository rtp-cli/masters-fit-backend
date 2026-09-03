import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock the mail layer before importing the service — email.service builds a
// Resend client at module load, and no test may reach the network.
jest.mock("@/services/email.service", () => ({
  emailService: {
    sendNewUserNotificationEmail: jest.fn(async () => undefined),
    sendStalledSignupDigestEmail: jest.fn(async () => undefined),
  },
}));

import { emailService } from "@/services/email.service";
import {
  signupNotificationService,
  buildProfileRows,
  formatRelativeAge,
  type NewUserSnapshot,
} from "@/services/signup-notification.service";

const sendAlert = emailService.sendNewUserNotificationEmail as jest.MockedFunction<
  typeof emailService.sendNewUserNotificationEmail
>;

const CLAIMED_AT = new Date("2026-09-03T17:41:30Z");

function snapshot(overrides: Partial<NewUserSnapshot> = {}): NewUserSnapshot {
  return {
    userId: 148,
    name: "Jane Doe",
    email: "jane.doe@example.com",
    createdAt: new Date("2026-09-03T17:35:00Z"),
    completedAt: new Date("2026-09-03T17:41:00Z"),
    subscriptionStatus: "trial",
    profile: {
      age: 54,
      gender: "female",
      fitnessLevel: "intermediate",
      goals: ["strength", "mobility"],
      availableDays: ["monday", "tuesday", "thursday", "saturday"],
      workoutDuration: 45,
      environment: "home_gym",
      equipment: ["dumbbells", "bands"],
      otherEquipment: null,
      limitations: ["lower_back"],
    },
    ...overrides,
  };
}

/**
 * The dispatcher's contract, which the onboarding request path depends on:
 * it resolves for every failure mode and never rejects, and it does no work at
 * all unless the kill switch is on.
 */
describe("dispatchNewUserAlert guardrails", () => {
  let getSnapshot: jest.SpiedFunction<typeof signupNotificationService.getNewUserSnapshot>;
  let claim: jest.SpiedFunction<typeof signupNotificationService.claimNewUserAlert>;
  let release: jest.SpiedFunction<typeof signupNotificationService.releaseNewUserAlert>;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but NOT implementations, so a
    // mockRejectedValue from an earlier test would leak into this one.
    sendAlert.mockReset();
    sendAlert.mockResolvedValue(undefined);
    process.env.SIGNUP_NOTIFY_ENABLED = "true";

    getSnapshot = jest
      .spyOn(signupNotificationService, "getNewUserSnapshot")
      .mockResolvedValue(snapshot());
    claim = jest
      .spyOn(signupNotificationService, "claimNewUserAlert")
      .mockResolvedValue(CLAIMED_AT);
    release = jest
      .spyOn(signupNotificationService, "releaseNewUserAlert")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SIGNUP_NOTIFY_ENABLED;
  });

  it("sends once for a fresh user", async () => {
    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "sent"
    );
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it("does NOTHING — not even a database read — when the kill switch is off", async () => {
    delete process.env.SIGNUP_NOTIFY_ENABLED;

    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "disabled"
    );
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("skips internal accounts without claiming them", async () => {
    getSnapshot.mockResolvedValue(snapshot({ email: "rtp+demo@mastersfit.ai" }));

    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "suppressed"
    );
    expect(claim).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("sends nothing when the claim is lost to a concurrent completion", async () => {
    claim.mockResolvedValue(null);

    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "already-sent"
    );
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("claims BEFORE sending, so a duplicate can never overlap a send", async () => {
    const order: string[] = [];
    claim.mockImplementation(async () => {
      order.push("claim");
      return CLAIMED_AT;
    });
    sendAlert.mockImplementation(async () => {
      order.push("send");
    });

    await signupNotificationService.dispatchNewUserAlert(148);

    expect(order).toEqual(["claim", "send"]);
  });

  it("releases the claim when the send fails, guarded by ITS OWN claim timestamp", async () => {
    // The timestamp guard is what stops a slow failing dispatch from nulling a
    // marker that a successful re-dispatch wrote in the meantime.
    sendAlert.mockRejectedValue(new Error("Resend is down"));

    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "failed"
    );
    expect(release).toHaveBeenCalledWith(148, CLAIMED_AT);
  });

  it("resolves rather than rejecting when the database is unreachable", async () => {
    getSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "failed"
    );
  });

  it("resolves rather than rejecting when the claim query blows up", async () => {
    claim.mockRejectedValue(new Error("deadlock detected"));
    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "failed"
    );
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("resolves rather than rejecting when releasing the claim ALSO fails", async () => {
    sendAlert.mockRejectedValue(new Error("Resend is down"));
    release.mockRejectedValue(new Error("still down"));

    await expect(signupNotificationService.dispatchNewUserAlert(148)).resolves.toBe(
      "failed"
    );
  });

  it("handles a user that no longer exists", async () => {
    getSnapshot.mockResolvedValue(null);
    await expect(signupNotificationService.dispatchNewUserAlert(999)).resolves.toBe(
      "skipped"
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it("passes the member's own address so Reply-To reaches them", async () => {
    await signupNotificationService.dispatchNewUserAlert(148);
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({
      email: "jane.doe@example.com",
      compCommand: "npm run comp-user -- jane.doe@example.com",
    });
  });
});

describe("alert content helpers", () => {
  it("keeps free-text medical notes out of the email entirely", () => {
    // medicalNotes is not part of NewUserSnapshot's profile shape at all, so
    // there is no path by which it can reach an ops inbox. Assert on the
    // rendered labels to catch anyone widening the query later.
    const labels = buildProfileRows(snapshot()).map((r) => r.label);
    expect(labels).not.toContain("Medical notes");
    expect(labels).toEqual([
      "Profile",
      "Goals",
      "Schedule",
      "Training at",
      "Limitations",
    ]);
  });

  it("renders profile values in plain English", () => {
    const rows = Object.fromEntries(
      buildProfileRows(snapshot()).map((r) => [r.label, r.value])
    );
    expect(rows.Profile).toBe("54 · female · intermediate");
    expect(rows.Goals).toBe("Strength, Mobility");
    expect(rows.Schedule).toBe("4 days a week · 45 minutes");
    expect(rows["Training at"]).toBe("Home gym — Dumbbells, Bands");
    expect(rows.Limitations).toBe("Lower back");
  });

  it("omits rows the user left empty instead of printing blanks", () => {
    const rows = buildProfileRows(
      snapshot({
        profile: {
          age: null,
          gender: null,
          fitnessLevel: "beginner",
          goals: null,
          availableDays: null,
          workoutDuration: null,
          environment: null,
          equipment: null,
          otherEquipment: null,
          limitations: null,
        },
      })
    );
    // The identity line keeps the stored casing ("54 · female · intermediate"
    // reads naturally); only the vocabulary fields below it get humanized.
    expect(rows).toEqual([{ label: "Profile", value: "beginner" }]);
  });

  it("returns no rows when onboarding somehow wrote no profile", () => {
    expect(buildProfileRows(snapshot({ profile: null }))).toEqual([]);
  });

  it("describes the signup-to-onboarding gap in human units", () => {
    const done = new Date("2026-09-03T18:00:00Z");
    expect(formatRelativeAge(new Date("2026-09-03T17:54:00Z"), done)).toBe(
      "6 minutes ago"
    );
    expect(formatRelativeAge(new Date("2026-09-03T17:59:40Z"), done)).toBe("just now");
    expect(formatRelativeAge(new Date("2026-09-03T16:00:00Z"), done)).toBe("2 hours ago");
    expect(formatRelativeAge(new Date("2026-09-01T18:00:00Z"), done)).toBe("2 days ago");
    expect(formatRelativeAge(new Date("2026-09-03T17:00:00Z"), done)).toBe("1 hour ago");
    expect(formatRelativeAge(null, done)).toBe("at an unknown time");
  });
});
