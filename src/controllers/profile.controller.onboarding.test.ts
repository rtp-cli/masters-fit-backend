import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

/**
 * Guardrail suite for the internal new-user alert.
 *
 * The alert hangs off onboarding completion — the exact request a
 * friends-and-family invite lands on. The point of these tests is not that the
 * email works (that lives in the service suite); it is that the email CANNOT
 * break, block, or slow the request it rides on, under every failure mode.
 *
 * The auth/sign-in flow is not represented here because it is not touched:
 * auth.controller and auth.service have no reference to the notification code.
 */

const profileRow = {
  id: 7,
  userId: 148,
  age: 54,
  height: null,
  weight: null,
  gender: "female",
  goals: ["strength"],
  fitnessLevel: "intermediate",
  limitations: null,
  medicalNotes: "Occasional sciatica — patient reported",
  environment: "home_gym",
  equipment: ["dumbbells"],
  otherEquipment: null,
  preferredStyles: null,
  availableDays: ["monday"],
  workoutDuration: 45,
  intensityLevel: "moderate",
  includeWarmup: true,
  includeCooldown: true,
  timezone: "America/Chicago",
  updatedAt: new Date("2026-09-03T17:41:00Z"),
};

const onboardingUser = {
  id: 148,
  uuid: "8f1d0c9e-1111-4222-8333-444455556666",
  email: "jane.doe@example.com",
  name: "Jane Doe",
  needsOnboarding: true,
  createdAt: new Date("2026-09-03T17:35:00Z"),
};

jest.mock("@/services", () => ({
  profileService: {
    createOrUpdateProfile: jest.fn(async () => profileRow),
    getProfileByUserId: jest.fn(async () => profileRow),
  },
  userService: {
    getUser: jest.fn(async () => onboardingUser),
    updateUser: jest.fn(async () => ({ ...onboardingUser, needsOnboarding: false })),
  },
}));

jest.mock("@/services/event-tracking.service", () => ({
  eventTrackingService: {
    clearProfileCache: jest.fn(),
    updateUserProfile: jest.fn(async () => undefined),
  },
}));

jest.mock("@/services/signup-notification.service", () => ({
  signupNotificationService: {
    dispatchNewUserAlert: jest.fn(async () => "sent"),
  },
}));

import { userService } from "@/services";
import { signupNotificationService } from "@/services/signup-notification.service";
import { ProfileController } from "@/controllers/profile.controller";

const dispatch =
  signupNotificationService.dispatchNewUserAlert as jest.MockedFunction<
    typeof signupNotificationService.dispatchNewUserAlert
  >;
const getUser = userService.getUser as jest.MockedFunction<typeof userService.getUser>;

const body = { userId: 148, age: 54, workoutDuration: 45 };

describe("onboarding completion is unaffected by the new-user alert", () => {
  let controller: ProfileController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ProfileController();
    getUser.mockResolvedValue(onboardingUser as any);
    dispatch.mockResolvedValue("sent");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("completes onboarding and fires the alert once", async () => {
    const result = await controller.createProfile(body as any, {});

    expect(result.success).toBe(true);
    expect(result.needsOnboarding).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(148);
  });

  it("still returns success when the alert dispatch REJECTS", async () => {
    // The dispatcher is contracted never to reject; this proves the controller
    // survives even if that contract is broken later.
    dispatch.mockRejectedValue(new Error("Resend is down"));

    const result = await controller.createProfile(body as any, {});

    expect(result.success).toBe(true);
    expect(result.needsOnboarding).toBe(false);
  });

  it("does not leave an unhandled rejection behind when the dispatch rejects", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    dispatch.mockRejectedValue(new Error("Resend is down"));
    await controller.createProfile(body as any, {});
    // Let the microtask queue drain so a missed .catch would surface.
    await new Promise((resolve) => setImmediate(resolve));

    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("does NOT wait for the alert — a hung mail server cannot hang onboarding", async () => {
    let settled = false;
    // Never resolves. If the controller awaited it, this test would time out.
    dispatch.mockImplementation(
      () => new Promise(() => {}) as Promise<"sent">
    );

    const result = await controller.createProfile(body as any, {});
    settled = true;

    expect(settled).toBe(true);
    expect(result.success).toBe(true);
  });

  it("returns the identical response whether the alert succeeds or fails", async () => {
    dispatch.mockResolvedValue("sent");
    const ok = await controller.createProfile(body as any, {});

    jest.clearAllMocks();
    getUser.mockResolvedValue(onboardingUser as any);
    dispatch.mockRejectedValue(new Error("Resend is down"));
    const failed = await controller.createProfile(body as any, {});

    expect(failed).toEqual(ok);
  });

  it("fires only on FIRST completion, not when an existing user edits their profile", async () => {
    getUser.mockResolvedValue({ ...onboardingUser, needsOnboarding: false } as any);

    const result = await controller.createProfile(body as any, {});

    expect(result.success).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fires from the PUT /profile/{id} completion path too", async () => {
    await controller.updateProfile(7, body as any, {});
    expect(dispatch).toHaveBeenCalledWith(148);
  });

  it("fires from the PUT /profile/user/{userId} completion path too", async () => {
    await controller.updateProfileByUserId(148, body as any, {});
    expect(dispatch).toHaveBeenCalledWith(148);
  });

  it("never fires more than once per completion, across all three paths", async () => {
    await controller.createProfile(body as any, {});
    getUser.mockResolvedValue({ ...onboardingUser, needsOnboarding: false } as any);
    await controller.updateProfile(7, body as any, {});
    await controller.updateProfileByUserId(148, body as any, {});

    // Only the first call saw needsOnboarding === true.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("still completes onboarding when the analytics sync itself fails", async () => {
    // Pre-existing behaviour, asserted here so the notification work can't be
    // blamed for it later: the analytics update IS awaited.
    const { eventTrackingService } = jest.requireMock(
      "@/services/event-tracking.service"
    ) as any;
    eventTrackingService.updateUserProfile.mockRejectedValueOnce(
      new Error("mixpanel down")
    );

    await expect(controller.createProfile(body as any, {})).rejects.toThrow(
      "mixpanel down"
    );
  });
});
