import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { SubscriptionController } from "@/controllers/subscription.controller";
import { subscriptionService } from "@/services/subscription.service";
import { userService } from "@/services/user.service";
import { RevenueCatWebhookPayload } from "@/types/subscription/requests";

jest.mock("@/services/subscription.service", () => ({
  subscriptionService: {
    isWebhookEventProcessed: jest.fn(async () => false),
    markWebhookEventProcessed: jest.fn(async () => undefined),
    getUserSubscription: jest.fn(async () => ({})),
    getPlanByRevenueCatProductId: jest.fn(async () => null),
    updateUserSubscription: jest.fn(async () => undefined),
    findUserByRevenueCatCustomerId: jest.fn(async () => null),
    getEffectiveAccessLevel: jest.fn(async () => "trial"),
  },
}));

jest.mock("@/services/user.service", () => ({
  userService: {
    getUser: jest.fn(async () => null),
  },
}));

const mockedSubscriptionService = jest.mocked(subscriptionService);
const mockedUserService = jest.mocked(userService);

describe("SubscriptionController TRANSFER handling", () => {
  const controller = new SubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSubscriptionService.isWebhookEventProcessed.mockResolvedValue(
      false
    );
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    mockedSubscriptionService.findUserByRevenueCatCustomerId.mockResolvedValue(
      null as any
    );
    mockedUserService.getUser.mockResolvedValue({ id: 19 } as any);
  });

  it("uses the raw productId as planId when no matching plan is found, not a hardcoded fallback", async () => {
    mockedSubscriptionService.getPlanByRevenueCatProductId.mockResolvedValue(
      null as any
    );

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_test_transfer",
        type: "TRANSFER",
        app_user_id: "19",
        product_id: "masters_fit_unknown_product",
        transferred_from: [],
        transferred_to: ["19"],
      } as RevenueCatWebhookPayload["event"],
    };

    const result = await controller.handleRevenueCatWebhook(
      {} as any,
      payload,
      undefined
    );

    expect(result.success).toBe(true);
    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ planId: "masters_fit_unknown_product" })
    );
    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { planId: string | null };
    expect(call.planId).not.toBe("pro");
  });

  it("uses the matched plan's planId when a plan is found", async () => {
    mockedSubscriptionService.getPlanByRevenueCatProductId.mockResolvedValue(
      { planId: "masters_fit_annual" } as any
    );

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_test_transfer_2",
        type: "TRANSFER",
        app_user_id: "19",
        product_id: "masters_fit_annual",
        transferred_from: [],
        transferred_to: ["19"],
      } as RevenueCatWebhookPayload["event"],
    };

    await controller.handleRevenueCatWebhook({} as any, payload, undefined);

    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ planId: "masters_fit_annual" })
    );
  });
});

describe("SubscriptionController.handleRevenueCatWebhook — event types [LR-018/LR-010]", () => {
  const controller = new SubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSubscriptionService.isWebhookEventProcessed.mockResolvedValue(false);
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    mockedUserService.getUser.mockResolvedValue({ id: 19 } as any);
  });

  it("returns success without processing a TEST event", async () => {
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: { id: "evt_test", type: "TEST", app_user_id: "19" } as any,
    };

    const result = await controller.handleRevenueCatWebhook(
      {} as any,
      payload,
      undefined
    );

    expect(result).toEqual({ success: true, message: "Test webhook received" });
    expect(mockedSubscriptionService.updateUserSubscription).not.toHaveBeenCalled();
    expect(mockedSubscriptionService.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("skips reprocessing an already-processed event (idempotency)", async () => {
    mockedSubscriptionService.isWebhookEventProcessed.mockResolvedValue(true);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_dup",
        type: "INITIAL_PURCHASE",
        app_user_id: "19",
        product_id: "masters_fit_monthly",
      } as any,
    };

    const result = await controller.handleRevenueCatWebhook(
      {} as any,
      payload,
      undefined
    );

    expect(result).toEqual({
      success: true,
      message: "Event already processed",
    });
    expect(mockedSubscriptionService.updateUserSubscription).not.toHaveBeenCalled();
  });

  it("activates the subscription on INITIAL_PURCHASE", async () => {
    mockedSubscriptionService.getPlanByRevenueCatProductId.mockResolvedValue({
      planId: "masters_fit_monthly",
    } as any);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: "19",
        product_id: "masters_fit_monthly",
      } as any,
    };

    const result = await controller.handleRevenueCatWebhook(
      {} as any,
      payload,
      undefined
    );

    expect(result.success).toBe(true);
    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ status: "active" })
    );
  });

  it("revokes access immediately on a refund (CUSTOMER_SUPPORT cancel reason)", async () => {
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_refund",
        type: "CANCELLATION",
        app_user_id: "19",
        cancel_reason: "CUSTOMER_SUPPORT",
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, undefined);

    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { status: string; subscriptionEndDate: Date };
    expect(call.status).toBe("cancelled");
    // Revoked immediately — end date should be ~now, not some future/original date.
    expect(call.subscriptionEndDate.getTime()).toBeCloseTo(Date.now(), -3);
  });

  it("keeps access until period end on a regular (non-refund) cancellation", async () => {
    const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_cancel",
        type: "CANCELLATION",
        app_user_id: "19",
        cancel_reason: "UNSUBSCRIBE",
        expiration_at_ms: futureExpiry,
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, undefined);

    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { status: string; subscriptionEndDate: Date };
    expect(call.status).toBe("cancelled");
    expect(call.subscriptionEndDate.getTime()).toBe(futureExpiry);
  });
});

describe("SubscriptionController.getSubscriptionStatus", () => {
  const controller = new SubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the trial default for a user with no subscription history", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({
      id: 1,
      userId: 19,
      status: "trial",
      planId: null,
      subscriptionStartDate: null,
      subscriptionEndDate: null,
    } as any);
    mockedSubscriptionService.getEffectiveAccessLevel.mockResolvedValue(
      "trial" as any
    );

    const result = await controller.getSubscriptionStatus({
      userId: 19,
    } as any);

    expect(result.success).toBe(true);
    expect(result.subscription.status).toBe("trial");
    expect(result.subscription.accessLevel).toBe("trial");
  });

  it("returns unlimited access level for an active paid subscriber", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({
      id: 1,
      userId: 19,
      status: "active",
      planId: "masters_fit_annual",
      subscriptionStartDate: new Date("2026-01-01"),
      subscriptionEndDate: new Date("2027-01-01"),
    } as any);
    mockedSubscriptionService.getEffectiveAccessLevel.mockResolvedValue(
      "unlimited" as any
    );

    const result = await controller.getSubscriptionStatus({
      userId: 19,
    } as any);

    expect(result.subscription.status).toBe("active");
    expect(result.subscription.accessLevel).toBe("unlimited");
    expect(result.subscription.planId).toBe("masters_fit_annual");
  });
});

describe("SubscriptionController webhook auth header enforcement [LR-003 regression coverage]", () => {
  const ORIGINAL_ENV = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;

  afterEach(() => {
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("rejects a webhook call with a wrong auth header when one is configured", async () => {
    jest.resetModules();
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = "correct-secret";
    const { SubscriptionController: FreshController } = await import(
      "@/controllers/subscription.controller"
    );
    const freshController = new FreshController();

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: { id: "evt_x", type: "TEST", app_user_id: "19" } as any,
    };

    const result = await freshController.handleRevenueCatWebhook(
      {} as any,
      payload,
      "wrong-secret"
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Unauthorized");
  });

  it("accepts a webhook call with the correct auth header when one is configured", async () => {
    jest.resetModules();
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = "correct-secret";
    const { SubscriptionController: FreshController } = await import(
      "@/controllers/subscription.controller"
    );
    const freshController = new FreshController();

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: { id: "evt_y", type: "TEST", app_user_id: "19" } as any,
    };

    const result = await freshController.handleRevenueCatWebhook(
      {} as any,
      payload,
      "correct-secret"
    );

    expect(result.success).toBe(true);
  });
});
