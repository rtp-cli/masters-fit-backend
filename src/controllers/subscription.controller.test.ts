import { describe, it, expect, jest, beforeEach } from "@jest/globals";
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
