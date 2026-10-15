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
      openAppUrl: "https://www.mastersfit.ai/continue",
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
  const OPEN = "https://www.mastersfit.ai/continue";
  const render = (over: Partial<{ name: string; isTrial: boolean }> = {}) =>
    subscriberWelcomeTemplate({ name: "Jane Doe", isTrial: false, openAppUrl: OPEN, ...over });

  afterEach(() => {
    delete process.env.SUBSCRIBER_WELCOME_OPEN_URL;
  });

  it("renders Rich's approved copy, in order", () => {
    const { text } = render();
    const expected = [
      "Hi Jane,",
      "Thanks for subscribing to MastersFit+. We're glad to be part of your training.",
      "MastersFit is built to help you stay strong, active, and consistent after 40 - with training that fits your goals, experience, and life.",
      "Your subscription gives you more flexibility and insight along the way:",
      "- Training that adapts: Generate new plans and adjust your workouts as your schedule, equipment, or goals change.",
      "- Progress you can see: Track strength trends, training volume, and personal records.",
      "- Connected workout tracking: Sync your workouts with Apple Health or Health Connect.",
      "Your next step: Open MastersFit, review your current plan, and choose your next workout. Keep your profile up to date so your training reflects where you are today.",
      `Open MastersFit: ${OPEN}`,
      "If you have questions, run into an issue, or have feedback, just reply to this email. We'd like to hear from you.",
      "Thanks for choosing MastersFit.",
      "- Rich\nFounder, MastersFit",
    ];
    let at = -1;
    for (const line of expected) {
      const next = text.indexOf(line);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it("puts the one button directly below the next-step paragraph", () => {
    const { html } = render();
    expect(html.match(/<a href="[^"]*"[^>]*>Open MastersFit<\/a>/g)).toHaveLength(1);
    const step = html.indexOf("Your next step:");
    const button = html.indexOf(">Open MastersFit</a>");
    const reply = html.indexOf("If you have questions");
    expect(step).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(step);
    expect(reply).toBeGreaterThan(button);
    expect(html).toContain(`href="${OPEN}"`);
  });

  it("bolds the benefit leads and the next-step lead", () => {
    const { html } = render();
    for (const lead of ["Training that adapts:", "Progress you can see:", "Connected workout tracking:", "Your next step:"]) {
      expect(html).toMatch(new RegExp(`<strong[^>]*>${lead}</strong>`));
    }
  });

  it("signs as Rich, founder, with no unsubscribe or postal address", () => {
    const { html, text } = render();
    expect(html).toContain("&mdash; Rich<br />Founder, MastersFit");
    expect(html).not.toMatch(/unsubscribe/i);
    expect(text).not.toMatch(/unsubscribe/i);
    expect(text).not.toContain("1606 NW 106th Ter");
  });

  it("thanks a paying customer for subscribing", () => {
    const { text } = render();
    expect(text).toContain("Thanks for subscribing to MastersFit+.");
    expect(text).not.toMatch(/trial/i);
  });

  it("never tells a free-trial customer they were charged", () => {
    const welcome = buildSubscriberWelcome(purchase({ period_type: REVENUE_CAT_PERIOD_TYPES.TRIAL }), user());
    expect(welcome.isTrial).toBe(true);

    const { text } = subscriberWelcomeTemplate(welcome);
    expect(text).toContain(
      "Thanks for starting your MastersFit+ free trial. Nothing has been charged yet. We're glad to be part of your training."
    );
    expect(text).not.toContain("Thanks for subscribing");
  });

  it("falls back to a generic greeting when there's no name", () => {
    const { text } = render({ name: "  " });
    expect(text.startsWith("Hi there,")).toBe(true);
  });

  it("escapes the customer's name in the HTML", () => {
    const { html } = render({ name: "<b>Jane" });
    expect(html).not.toContain("<b>Jane");
    expect(html).toContain("&lt;b&gt;Jane");
  });

  it("has no prices or unbuilt features", () => {
    const { text } = render();
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/why it swapped/i);
  });

  it("links the button over https by default, overridable by env", () => {
    expect(buildSubscriberWelcome(purchase(), user()).openAppUrl).toBe(OPEN);
    process.env.SUBSCRIBER_WELCOME_OPEN_URL = "https://www.mastersfit.ai/open/";
    expect(buildSubscriberWelcome(purchase(), user()).openAppUrl).toBe("https://www.mastersfit.ai/open");
  });

  it("refuses a custom-scheme button link (Gmail blocks them)", () => {
    expect(() =>
      subscriberWelcomeTemplate({ name: "Jane", isTrial: false, openAppUrl: "masters-fit://dashboard" })
    ).toThrow(/http/);
  });

  it("uses the welcome subject", () => {
    expect(SUBSCRIBER_WELCOME_SUBJECT).toBe("Welcome to MastersFit+");
  });
});
