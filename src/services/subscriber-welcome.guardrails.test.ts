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
    sendSubscriberWelcomeEmail: jest.fn(async () => "msg_test"),
  },
}));

import { emailService } from "@/services/email.service";
import {
  subscriberWelcomeService,
  buildSubscriberWelcome,
  type SubscriberWelcomeUser,
} from "@/services/subscriber-welcome.service";
import {
  subscriberWelcomeTemplate,
  SUBSCRIBER_WELCOME_SUBJECT,
} from "@/templates/subscriber-welcome-email";
import {
  REVENUE_CAT_PERIOD_TYPES,
  REVENUE_CAT_STORES,
  type RevenueCatWebhookEvent,
} from "@/types/subscription/requests";

const sendWelcome = emailService.sendSubscriberWelcomeEmail as jest.MockedFunction<
  typeof emailService.sendSubscriberWelcomeEmail
>;

// A routable domain on purpose: the RFC-reserved domains (example.com, *.test)
// are suppressed as our own test data.
function user(overrides: Partial<SubscriberWelcomeUser> = {}): SubscriberWelcomeUser {
  return {
    userId: 148,
    name: "Jane Doe",
    email: "jane.doe@gmail.com",
    ...overrides,
  };
}

function purchase(overrides: Partial<RevenueCatWebhookEvent> = {}): RevenueCatWebhookEvent {
  return {
    id: "evt_purchase_1",
    type: "INITIAL_PURCHASE",
    app_user_id: "148",
    product_id: "masters_fit_monthly",
    period_type: "NORMAL",
    environment: "PRODUCTION",
    store: "APP_STORE",
    price: 12.99,
    price_in_purchased_currency: 12.99,
    currency: "USD",
    purchased_at_ms: Date.parse("2026-10-14T15:00:00Z"),
    ...overrides,
  } as RevenueCatWebhookEvent;
}

/**
 * The dispatcher's contract, which the RevenueCat webhook depends on: it
 * resolves for every failure mode and never rejects, and it only emails a real
 * customer for a real production purchase.
 */
describe("dispatchSubscriberWelcome guardrails", () => {
  let getUser: jest.SpiedFunction<typeof subscriberWelcomeService.getWelcomeUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but NOT implementations.
    sendWelcome.mockReset();
    sendWelcome.mockResolvedValue("msg_test");

    getUser = jest
      .spyOn(subscriberWelcomeService, "getWelcomeUser")
      .mockResolvedValue(user());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SIGNUP_NOTIFY_SUPPRESS_DOMAINS;
    delete process.env.SIGNUP_NOTIFY_ENABLED;
  });

  it("sends once, to the CUSTOMER, for a production purchase", async () => {
    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("sent");
    expect(getUser).toHaveBeenCalledWith(148);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendWelcome.mock.calls[0]?.[0]).toEqual({
      to: "jane.doe@gmail.com",
      subject: "Welcome to MastersFit+",
      name: "Jane Doe",
      isTrial: false,
      store: "app_store",
    });
  });

  it("does not depend on the owner-alert kill switch", async () => {
    delete process.env.SIGNUP_NOTIFY_ENABLED;
    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("sent");
  });

  it("does NOT email a sandbox purchase — and never reads the database", async () => {
    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(
        purchase({ environment: "SANDBOX" }),
        148
      )
    ).resolves.toBe("sandbox");
    expect(getUser).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("treats a missing environment as sandbox, not production", async () => {
    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(
        purchase({ environment: undefined }),
        148
      )
    ).resolves.toBe("sandbox");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it.each(["RENEWAL", "CANCELLATION", "UNCANCELLATION", "PRODUCT_CHANGE", "EXPIRATION", "BILLING_ISSUE"])(
    "does not email for a %s event",
    async (type) => {
      await expect(
        subscriberWelcomeService.dispatchSubscriberWelcome(
          purchase({ type } as Partial<RevenueCatWebhookEvent>),
          148
        )
      ).resolves.toBe("not-applicable");
      expect(getUser).not.toHaveBeenCalled();
      expect(sendWelcome).not.toHaveBeenCalled();
    }
  );

  it("does not thank someone for a promotional grant they didn't buy", async () => {
    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(
        purchase({ period_type: REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL }),
        148
      )
    ).resolves.toBe("not-applicable");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it.each([
    "rtp@mastersfit.ai",
    "rtp+demo@mastersfit.ai",
    "rtp+review@mastersfit.ai",
    "rtp+qa@mastersfit.ai",
  ])("does not email the protected account %s", async (email) => {
    getUser.mockResolvedValue(user({ email }));

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("suppressed");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not email a reserved test domain", async () => {
    getUser.mockResolvedValue(user({ email: "test-jobs-claim-1@example.test" }));

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("suppressed");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not email a configured suppressed domain", async () => {
    process.env.SIGNUP_NOTIFY_SUPPRESS_DOMAINS = "mastersfit.air";
    getUser.mockResolvedValue(user({ email: "someone@mastersfit.air" }));

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("suppressed");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("resolves rather than rejecting when the send fails", async () => {
    sendWelcome.mockRejectedValue(new Error("Resend error: rate limited"));

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("failed");
  });

  it("resolves rather than rejecting when the database is unreachable", async () => {
    getUser.mockRejectedValue(new Error("connection refused"));

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("failed");
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("handles a user that no longer exists", async () => {
    getUser.mockResolvedValue(null);

    await expect(
      subscriberWelcomeService.dispatchSubscriberWelcome(purchase(), 148)
    ).resolves.toBe("skipped");
    expect(sendWelcome).not.toHaveBeenCalled();
  });
});

describe("welcome content", () => {
  it("picks the store from the event", () => {
    expect(buildSubscriberWelcome(purchase({ store: REVENUE_CAT_STORES.APP_STORE }), user()).store).toBe("app_store");
    expect(buildSubscriberWelcome(purchase({ store: REVENUE_CAT_STORES.MAC_APP_STORE }), user()).store).toBe("app_store");
    expect(buildSubscriberWelcome(purchase({ store: REVENUE_CAT_STORES.PLAY_STORE }), user()).store).toBe("play_store");
    expect(buildSubscriberWelcome(purchase({ store: REVENUE_CAT_STORES.STRIPE }), user()).store).toBe("unknown");
    expect(buildSubscriberWelcome(purchase({ store: undefined }), user()).store).toBe("unknown");
  });

  it("tells an App Store customer to manage it through Apple", () => {
    const { html, text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "app_store" });
    expect(text).toContain("that's handled by Apple");
    expect(text).toContain("open Settings, tap your name, then Subscriptions");
    expect(text).not.toContain("Google Play");
    expect(html).toContain("that's handled by Apple");
  });

  it("tells a Google Play customer to manage it through Google Play", () => {
    const { text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "play_store" });
    expect(text).toContain("that's handled by Google Play");
    expect(text).toContain("Payments & subscriptions");
    expect(text).not.toContain("handled by Apple");
  });

  it("stays generic when the store is unknown", () => {
    const { text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "unknown" });
    expect(text).toContain("handled by the store you subscribed through");
  });

  it("thanks a paying customer for subscribing", () => {
    const { text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "app_store" });
    expect(text).toContain("Thanks for subscribing to MastersFit+.");
    expect(text).not.toMatch(/trial/i);
  });

  it("never tells a free-trial customer they were charged", () => {
    const welcome = buildSubscriberWelcome(purchase({ period_type: REVENUE_CAT_PERIOD_TYPES.TRIAL }), user());
    expect(welcome.isTrial).toBe(true);

    const { text } = subscriberWelcomeTemplate(welcome);
    expect(text).toContain("Thanks for starting your MastersFit+ free trial. Nothing has been charged yet.");
    expect(text).not.toContain("Thanks for subscribing");
  });

  it("greets by first name, signs as Rich, and invites a reply", () => {
    const { html, text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "app_store" });
    expect(text.startsWith("Hi Jane,")).toBe(true);
    expect(text).toContain("Just reply to this email if anything feels off or you want something changed. It comes straight to me.");
    expect(text.trimEnd().endsWith("- Rich")).toBe(true);
    expect(html).toContain("&mdash; Rich");
  });

  it("falls back to a generic greeting when there's no name", () => {
    const { text } = subscriberWelcomeTemplate({ name: "  ", isTrial: false, store: "app_store" });
    expect(text.startsWith("Hi there,")).toBe(true);
  });

  it("escapes the customer's name in the HTML", () => {
    const { html } = subscriberWelcomeTemplate({ name: "<b>Jane", isTrial: false, store: "app_store" });
    expect(html).not.toContain("<b>Jane");
    expect(html).toContain("&lt;b&gt;Jane");
  });

  it("lists exactly the paywall's benefits, and no prices or unbuilt features", () => {
    const { text } = subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, store: "app_store" });
    expect(text).toContain("- Flexible plan adjustments - reshape any week or day as your training needs change");
    expect(text).toContain("- New training plans whenever your goals, schedule, or equipment change");
    expect(text).toContain("- Progress analytics - strength trends, training volume, and personal records");
    expect(text).toContain("- Auto-sync your workouts to Apple Health and Health Connect");
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/why it swapped/i);
  });

  it("uses the welcome subject", () => {
    expect(SUBSCRIBER_WELCOME_SUBJECT).toBe("Welcome to MastersFit+");
  });
});
