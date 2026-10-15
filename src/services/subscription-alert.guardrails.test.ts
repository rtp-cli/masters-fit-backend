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
    sendSubscriptionAlertEmail: jest.fn(async () => undefined),
    sendNewUserNotificationEmail: jest.fn(async () => undefined),
    sendStalledSignupDigestEmail: jest.fn(async () => undefined),
  },
}));

import { emailService } from "@/services/email.service";
import {
  subscriptionAlertService,
  buildSubscriptionAlert,
  describePrice,
  formatElapsed,
  type SubscriptionAlertUser,
} from "@/services/subscription-alert.service";
import {
  REVENUE_CAT_CANCEL_REASONS,
  REVENUE_CAT_PERIOD_TYPES,
  type RevenueCatWebhookEvent,
} from "@/types/subscription/requests";

const sendAlert = emailService.sendSubscriptionAlertEmail as jest.MockedFunction<
  typeof emailService.sendSubscriptionAlertEmail
>;

// A routable domain on purpose: the RFC-reserved domains (example.com, *.test)
// are suppressed as our own test data.
function user(overrides: Partial<SubscriptionAlertUser> = {}): SubscriptionAlertUser {
  return {
    userId: 148,
    name: "Jane Doe",
    email: "jane.doe@gmail.com",
    createdAt: new Date("2026-10-11T15:00:00Z"),
    ...overrides,
  };
}

const PURCHASED_AT = Date.parse("2026-10-14T15:00:00Z");

function purchase(overrides: Partial<RevenueCatWebhookEvent> = {}): RevenueCatWebhookEvent {
  return {
    id: "evt_purchase_1",
    type: "INITIAL_PURCHASE",
    app_user_id: "148",
    product_id: "masters_fit_annual",
    period_type: "NORMAL",
    environment: "PRODUCTION",
    store: "APP_STORE",
    price: 89.99,
    price_in_purchased_currency: 89.99,
    currency: "USD",
    purchased_at_ms: PURCHASED_AT,
    expiration_at_ms: Date.parse("2027-10-14T15:00:00Z"),
    ...overrides,
  } as RevenueCatWebhookEvent;
}

function cancellation(
  overrides: Partial<RevenueCatWebhookEvent> = {}
): RevenueCatWebhookEvent {
  return {
    id: "evt_cancel_1",
    type: "CANCELLATION",
    app_user_id: "148",
    product_id: "masters_fit_monthly",
    period_type: "NORMAL",
    environment: "PRODUCTION",
    store: "PLAY_STORE",
    cancel_reason: "UNSUBSCRIBE",
    event_timestamp_ms: PURCHASED_AT,
    expiration_at_ms: Date.parse("2026-11-01T15:00:00Z"),
    ...overrides,
  } as RevenueCatWebhookEvent;
}

/**
 * The dispatcher's contract, which the RevenueCat webhook depends on: it
 * resolves for every failure mode and never rejects, and it only emails for
 * real-money production events on real customers.
 */
describe("dispatchSubscriptionAlert guardrails", () => {
  let getUser: jest.SpiedFunction<typeof subscriptionAlertService.getAlertUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but NOT implementations.
    sendAlert.mockReset();
    sendAlert.mockResolvedValue(undefined);
    process.env.SIGNUP_NOTIFY_ENABLED = "true";

    getUser = jest
      .spyOn(subscriptionAlertService, "getAlertUser")
      .mockResolvedValue(user());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SIGNUP_NOTIFY_ENABLED;
    delete process.env.SIGNUP_NOTIFY_SUPPRESS_DOMAINS;
  });

  it("sends once for a production purchase", async () => {
    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("sent");
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({
      kind: "purchase",
      userId: 148,
      email: "jane.doe@gmail.com",
    });
  });

  it("sends once for a production cancellation", async () => {
    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(cancellation(), 148)
    ).resolves.toBe("sent");
    expect(sendAlert.mock.calls[0]?.[0]).toMatchObject({ kind: "cancellation" });
  });

  it("does NOT email a sandbox purchase — and never reads the database", async () => {
    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(
        purchase({ environment: "SANDBOX" }),
        148
      )
    ).resolves.toBe("sandbox");
    expect(getUser).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("treats a missing environment as sandbox, not production", async () => {
    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(
        purchase({ environment: undefined }),
        148
      )
    ).resolves.toBe("sandbox");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("does not email a customer on a suppressed domain", async () => {
    process.env.SIGNUP_NOTIFY_SUPPRESS_DOMAINS = "mastersfit.air";
    getUser.mockResolvedValue(user({ email: "someone@mastersfit.air" }));

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("suppressed");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("does not email for internal/protected accounts", async () => {
    getUser.mockResolvedValue(user({ email: "rtp+demo@mastersfit.ai" }));

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("suppressed");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("does NOTHING when the kill switch is off", async () => {
    delete process.env.SIGNUP_NOTIFY_ENABLED;

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("disabled");
    expect(getUser).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it.each(["RENEWAL", "EXPIRATION", "BILLING_ISSUE", "UNCANCELLATION", "PRODUCT_CHANGE"])(
    "ignores %s events",
    async (type) => {
      await expect(
        subscriptionAlertService.dispatchSubscriptionAlert(
          purchase({ type: type as RevenueCatWebhookEvent["type"] }),
          148
        )
      ).resolves.toBe("not-applicable");
      expect(sendAlert).not.toHaveBeenCalled();
    }
  );

  it("resolves rather than rejecting when the send fails", async () => {
    sendAlert.mockRejectedValue(new Error("Resend is down"));

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("failed");
  });

  it("resolves rather than rejecting when the database is unreachable", async () => {
    getUser.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 148)
    ).resolves.toBe("failed");
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("handles a user that no longer exists", async () => {
    getUser.mockResolvedValue(null);

    await expect(
      subscriptionAlertService.dispatchSubscriptionAlert(purchase(), 999)
    ).resolves.toBe("skipped");
    expect(sendAlert).not.toHaveBeenCalled();
  });
});

describe("alert content", () => {
  const rows = (alert: ReturnType<typeof buildSubscriptionAlert>) =>
    Object.fromEntries(alert.detailRows.map((r) => [r.label, r.value]));

  it("labels a real charge as paid and shows what they paid", () => {
    const alert = buildSubscriptionAlert(purchase(), user());

    expect(alert.subject).toBe(
      "[MastersFit] 💰 New subscriber: Jane Doe ($89.99 USD)"
    );
    expect(alert.headline).toBe("Jane Doe subscribed");
    expect(alert.callout).toBeNull();
    expect(rows(alert)).toMatchObject({
      Type: "Paid (real charge)",
      Price: "$89.99 USD",
      Plan: "masters_fit_annual",
      Store: "App Store (iOS)",
      "Signed up": "Oct 11, 2026 — 3 days before buying",
    });
  });

  it("labels a free trial unmistakably — subject, headline, callout and price", () => {
    const alert = buildSubscriptionAlert(
      purchase({ period_type: REVENUE_CAT_PERIOD_TYPES.TRIAL, price: 0, price_in_purchased_currency: 0 }),
      user()
    );

    expect(alert.subject).toBe(
      "[MastersFit] 💰 New subscriber: Jane Doe (free trial — not charged yet)"
    );
    expect(alert.headline).toBe("Jane Doe started a free trial");
    expect(alert.callout).toMatch(/^FREE TRIAL/);
    expect(rows(alert)).toMatchObject({
      Type: "FREE TRIAL (not charged)",
      Price: "$0 charged now",
    });
    expect(rows(alert)["Trial ends"]).toBeDefined();
  });

  it("shows the purchased currency AND the USD figure when they differ", () => {
    expect(
      describePrice(
        purchase({ price: 89.1, price_in_purchased_currency: 124.99, currency: "CAD" })
      )
    ).toBe("CA$124.99 CAD (≈ $89.10 USD)");
  });

  it("builds a cancellation with reason and access-until date", () => {
    const alert = buildSubscriptionAlert(cancellation(), user());

    expect(alert.subject).toBe("[MastersFit] Subscription cancelled: Jane Doe");
    expect(alert.callout).toBeNull();
    expect(rows(alert)).toMatchObject({
      Reason: "They turned off auto-renew themselves",
      "Access until": expect.stringMatching(/^Nov 1, 2026/),
      Plan: "masters_fit_monthly",
      Store: "Google Play",
      "Was on": "Paid (real charge)",
      "Signed up": "Oct 11, 2026 — 3 days before cancelling",
    });
  });

  it("flags a refund as revoking access now", () => {
    const alert = buildSubscriptionAlert(
      cancellation({ cancel_reason: REVENUE_CAT_CANCEL_REASONS.CUSTOMER_SUPPORT }),
      user()
    );
    expect(alert.subject).toBe("[MastersFit] Subscription cancelled: Jane Doe (refunded)");
    expect(rows(alert)["Access until"]).toBe("Revoked immediately (refund)");
  });

  it("flags a cancellation during the free trial as never charged", () => {
    const alert = buildSubscriptionAlert(cancellation({ period_type: REVENUE_CAT_PERIOD_TYPES.TRIAL }), user());
    expect(alert.subject).toBe(
      "[MastersFit] Subscription cancelled: Jane Doe (during free trial)"
    );
    expect(alert.callout).toMatch(/never charged/);
  });

  it("falls back to the email when the user has no name", () => {
    const alert = buildSubscriptionAlert(purchase(), user({ name: "  " }));
    expect(alert.name).toBe("jane.doe@gmail.com");
  });

  it("formats time-to-purchase coarsely", () => {
    const t0 = new Date("2026-10-14T12:00:00Z");
    expect(formatElapsed(t0, new Date("2026-10-14T12:00:20Z"))).toBe("under a minute");
    expect(formatElapsed(t0, new Date("2026-10-14T12:06:00Z"))).toBe("6 minutes");
    expect(formatElapsed(t0, new Date("2026-10-14T14:00:00Z"))).toBe("2 hours");
    expect(formatElapsed(t0, new Date("2026-10-15T12:00:00Z"))).toBe("1 day");
  });
});
