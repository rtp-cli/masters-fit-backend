import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { SubscriptionController } from "@/controllers/subscription.controller";
import { subscriptionService } from "@/services/subscription.service";
import { userService } from "@/services/user.service";
import { notificationService } from "@/services/notification.service";
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

// [LR-007] handleBillingIssue fires a (fire-and-forget) billing notification.
// Mock it so the un-awaited call resolves synchronously in tests — without the
// mock it reaches expo-server-sdk and logs after teardown ("Cannot log after
// tests are done"). Keeping it fire-and-forget in prod is deliberate (must not
// block/fail the webhook response).
jest.mock("@/services/notification.service", () => ({
  notificationService: {
    sendBillingIssueNotification: jest.fn(async () => true),
  },
}));

const mockedSubscriptionService = jest.mocked(subscriptionService);
const mockedUserService = jest.mocked(userService);
const mockedNotificationService = jest.mocked(notificationService);

// Webhook auth is now fail-closed: the secret must be configured AND match.
// Configure it for the business-logic webhook tests below; the calls pass the
// same "test-secret" as the Authorization header. (The dedicated auth-header
// enforcement describe overrides this per-test.)
process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = "test-secret";

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
      "test-secret"
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

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ planId: "masters_fit_annual" })
    );
  });

  it("[LR-005] normal transfer: revokes the old user and activates the new one", async () => {
    mockedUserService.getUser.mockImplementation(async (id: any) =>
      ({ id: Number(id) }) as any
    );

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_normal_transfer",
        type: "TRANSFER",
        app_user_id: "20",
        product_id: "masters_fit_monthly",
        transferred_from: ["19"],
        transferred_to: ["20"],
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ status: "expired" })
    );
    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ status: "active" })
    );
  });

  it("[LR-005] transfer to a user with no existing subscription record still activates them", async () => {
    // getUserSubscription's real implementation creates a trial record if
    // none exists — simulate that by resolving successfully regardless.
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({
      id: 1,
      userId: 21,
      status: "trial",
    } as any);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_transfer_no_history",
        type: "TRANSFER",
        app_user_id: "21",
        product_id: "masters_fit_monthly",
        transferred_from: [],
        transferred_to: ["21"],
      } as any,
    };
    mockedUserService.getUser.mockResolvedValue({ id: 21 } as any);

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    expect(mockedSubscriptionService.getUserSubscription).toHaveBeenCalledWith(
      21
    );
    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ status: "active" })
    );
  });

  it("[LR-005] transfer to a user who already has an active subscription overwrites it, doesn't skip", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({
      id: 2,
      userId: 22,
      status: "active",
      planId: "masters_fit_monthly",
    } as any);
    mockedUserService.getUser.mockResolvedValue({ id: 22 } as any);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_transfer_already_active",
        type: "TRANSFER",
        app_user_id: "22",
        product_id: "masters_fit_annual",
        transferred_from: [],
        transferred_to: ["22"],
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    // Should still update to the transferred product, not silently skip
    // because the user already had an active subscription.
    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      22,
      expect.objectContaining({ status: "active", planId: "masters_fit_annual" })
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
      "test-secret"
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
      "test-secret"
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
      "test-secret"
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

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

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

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { status: string; subscriptionEndDate: Date };
    expect(call.status).toBe("cancelled");
    expect(call.subscriptionEndDate.getTime()).toBe(futureExpiry);
  });

  // [LR-010/LR-018] The one event type in the dispatch switch with no
  // coverage at all — grace period is the one billing-state transition
  // LR-008's frontend reconciliation specifically depends on being correct.
  it("puts the user into grace period on BILLING_ISSUE, storing the grace period expiration", async () => {
    const graceExpiry = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_billing_issue",
        type: "BILLING_ISSUE",
        app_user_id: "19",
        grace_period_expiration_at_ms: graceExpiry,
      } as any,
    };

    const result = await controller.handleRevenueCatWebhook(
      {} as any,
      payload,
      "test-secret"
    );

    expect(result.success).toBe(true);
    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { status: string; subscriptionEndDate: Date | null };
    expect(call.status).toBe("grace_period");
    expect(call.subscriptionEndDate?.getTime()).toBe(graceExpiry);
    // [LR-007] user is notified of the billing issue while in grace period
    const notifyArgs =
      mockedNotificationService.sendBillingIssueNotification.mock.calls[0];
    expect(notifyArgs[0]).toBe(19);
    expect((notifyArgs[1] as Date)?.getTime()).toBe(graceExpiry);
  });

  it("puts the user into grace period on BILLING_ISSUE even with no grace_period_expiration_at_ms field", async () => {
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_billing_issue_no_expiry",
        type: "BILLING_ISSUE",
        app_user_id: "19",
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    const call = mockedSubscriptionService.updateUserSubscription.mock
      .calls[0][1] as { status: string; subscriptionEndDate: Date | null };
    expect(call.status).toBe("grace_period");
    expect(call.subscriptionEndDate).toBeNull();
  });
});

describe("SubscriptionController.handleRevenueCatWebhook — EXPIRATION reason branching [LR-010/LR-018]", () => {
  const controller = new SubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSubscriptionService.isWebhookEventProcessed.mockResolvedValue(false);
    mockedUserService.getUser.mockResolvedValue({ id: 19 } as any);
  });

  async function expireWith(cancelReason: string | undefined) {
    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: `evt_expire_${cancelReason ?? "none"}`,
        type: "EXPIRATION",
        app_user_id: "19",
        expiration_reason: cancelReason,
        expiration_at_ms: Date.now(),
      } as any,
    };
    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");
    return mockedSubscriptionService.updateUserSubscription.mock.calls[0][1] as {
      status: string;
    };
  }

  it("maps SUBSCRIPTION_PAUSED to paused", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    expect((await expireWith("SUBSCRIPTION_PAUSED")).status).toBe("paused");
  });

  it("maps BILLING_ERROR to expired", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    expect((await expireWith("BILLING_ERROR")).status).toBe("expired");
  });

  it("maps UNSUBSCRIBE to cancelled", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    expect((await expireWith("UNSUBSCRIBE")).status).toBe("cancelled");
  });

  it("maps DEVELOPER_INITIATED to cancelled", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    expect((await expireWith("DEVELOPER_INITIATED")).status).toBe("cancelled");
  });

  it("maps an unrecognized/missing reason to expired (the default branch)", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({} as any);
    expect((await expireWith(undefined)).status).toBe("expired");
  });

  it("keeps a user already cancelled as cancelled, regardless of the expiration reason", async () => {
    mockedSubscriptionService.getUserSubscription.mockResolvedValue({
      status: "cancelled",
    } as any);
    // Even a reason that would normally map to "expired" shouldn't override
    // an existing cancellation.
    expect((await expireWith("BILLING_ERROR")).status).toBe("cancelled");
  });
});

describe("SubscriptionController.handleRevenueCatWebhook — PRODUCT_CHANGE [LR-010/LR-018]", () => {
  const controller = new SubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSubscriptionService.isWebhookEventProcessed.mockResolvedValue(false);
    mockedUserService.getUser.mockResolvedValue({ id: 19 } as any);
  });

  it("activates the subscription under the new plan when the new product matches a known plan", async () => {
    mockedSubscriptionService.getPlanByRevenueCatProductId.mockResolvedValue({
      planId: "masters_fit_annual",
    } as any);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_product_change",
        type: "PRODUCT_CHANGE",
        app_user_id: "19",
        product_id: "masters_fit_annual",
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ planId: "masters_fit_annual", status: "active" })
    );
  });

  it("falls back to the raw product id (not a hardcoded default) when no matching plan is found", async () => {
    mockedSubscriptionService.getPlanByRevenueCatProductId.mockResolvedValue(null);

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: {
        id: "evt_product_change_unknown",
        type: "PRODUCT_CHANGE",
        app_user_id: "19",
        product_id: "some_unmapped_product",
      } as any,
    };

    await controller.handleRevenueCatWebhook({} as any, payload, "test-secret");

    expect(mockedSubscriptionService.updateUserSubscription).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ planId: "some_unmapped_product", status: "active" })
    );
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

  it("rejects a webhook call when no auth secret is configured (fail-closed)", async () => {
    jest.resetModules();
    delete process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    const { SubscriptionController: FreshController } = await import(
      "@/controllers/subscription.controller"
    );
    const freshController = new FreshController();

    const payload: RevenueCatWebhookPayload = {
      api_version: "1.0",
      event: { id: "evt_z", type: "TEST", app_user_id: "19" } as any,
    };

    // Even a caller supplying *some* header must be rejected when the server
    // has no secret configured (previously this path accepted all requests).
    const result = await freshController.handleRevenueCatWebhook(
      {} as any,
      payload,
      "anything"
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Unauthorized");
  });
});
