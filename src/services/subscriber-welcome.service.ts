import { eq } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { users } from "@/models/user.schema";
import { emailService } from "@/services/email.service";
import { logger } from "@/utils/logger";
import { isSuppressedSignupEmail } from "@/constants/signup-notifications";
import {
  REVENUE_CAT_EVENT_TYPES,
  REVENUE_CAT_PERIOD_TYPES,
  type RevenueCatWebhookEvent,
} from "@/types/subscription/requests";
import {
  SUBSCRIBER_WELCOME_SUBJECT,
  subscriberWelcomeOpenAppUrl,
  type SubscriberWelcomeTemplateProps,
} from "@/templates/subscriber-welcome-email";

/** The only fields of the customer the welcome needs. */
export interface SubscriberWelcomeUser {
  userId: number;
  name: string;
  email: string;
}

export type SubscriberWelcomeOutcome =
  | "sent"
  /** Not a new subscription (renewal, cancellation, …), or a promotional grant nobody paid for. */
  | "not-applicable"
  /** Sandbox / TestFlight purchase — never a real customer. */
  | "sandbox"
  /** Protected account (owner, demo, QA, reviewer) or a test / suppressed domain. */
  | "suppressed"
  /** User row vanished between processing and dispatch. */
  | "skipped"
  | "failed";

/**
 * Customer-facing welcome email (type 2: from MastersFit, signed by Rich as
 * founder, Reply-To Rich), sent when someone starts a paid subscription.
 *
 * Sits beside the owner alert (subscription-alert.service) and is fired from
 * the same point in the webhook, with the same idempotency argument: the
 * controller calls this only AFTER `markWebhookEventProcessed` has inserted the
 * event into `webhook_events` (UNIQUE event_id), so a RevenueCat retry or a
 * concurrent duplicate delivery can't send it twice.
 *
 * Deliberately NOT behind SIGNUP_NOTIFY_ENABLED: that is the kill switch for
 * the owner's internal mail, and turning the owner alerts off must not silently
 * stop customers being welcomed. It DOES reuse the alerts' suppression list, so
 * QA, reviewer, demo and test-domain accounts never get it.
 */
export class SubscriberWelcomeService extends BaseService {
  /**
   * Read-only user lookup. Deliberately NOT
   * `subscriptionService.getUserSubscription()`, which CREATES a trial row as
   * a side effect — an email must never manufacture subscription state.
   */
  async getWelcomeUser(userId: number): Promise<SubscriberWelcomeUser | null> {
    const [row] = await this.db
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // A phone-only account has no inbox — same outcome as "no such user".
    return row?.email ? { ...row, email: row.email } : null;
  }

  /**
   * Send the welcome for a processed RevenueCat event.
   *
   * THIS FUNCTION MUST NEVER THROW AND MUST NEVER BE AWAITED IN THE WEBHOOK.
   * A rejected webhook makes RevenueCat retry, and a slow one risks its
   * timeout — neither may happen because of an email. Every failure mode
   * resolves to an outcome; the controller fires it with `void`.
   */
  async dispatchSubscriberWelcome(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<SubscriberWelcomeOutcome> {
    try {
      if (event.type !== REVENUE_CAT_EVENT_TYPES.INITIAL_PURCHASE) {
        return "not-applicable";
      }

      // A promotional grant was given, not bought — "thanks for subscribing"
      // would be wrong. (Comps don't come through here at all: they're a
      // column we set, and the comp note covers them.)
      if (event.period_type === REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL) {
        return "not-applicable";
      }

      // Sandbox covers TestFlight, simulator and store-review purchases. An
      // event with NO environment is treated as sandbox: only a positive
      // PRODUCTION may reach a customer's inbox.
      if (event.environment !== "PRODUCTION") return "sandbox";

      const user = await this.getWelcomeUser(userId);
      if (!user) return "skipped";
      if (isSuppressedSignupEmail(user.email)) return "suppressed";

      await emailService.sendSubscriberWelcomeEmail(
        buildSubscriberWelcome(event, user)
      );
      return "sent";
    } catch (error) {
      // Swallowing is the point: the subscription is already recorded.
      // Log loudly (Sentry picks this up) but never propagate.
      logger.error("Subscriber welcome dispatch failed", error as Error, {
        operation: "dispatchSubscriberWelcome",
        userId,
        eventId: event?.id,
        eventType: event?.type,
      });
      return "failed";
    }
  }
}

/**
 * Turn a RevenueCat event + customer into the send parameters. Pure — which
 * variant of the copy a customer gets is decided here.
 */
export function buildSubscriberWelcome(
  event: RevenueCatWebhookEvent,
  user: SubscriberWelcomeUser
): SubscriberWelcomeTemplateProps & { to: string; subject: string } {
  return {
    to: user.email,
    subject: SUBSCRIBER_WELCOME_SUBJECT,
    name: user.name ?? "",
    isTrial: event.period_type === REVENUE_CAT_PERIOD_TYPES.TRIAL,
    openAppUrl: subscriberWelcomeOpenAppUrl(),
  };
}

export const subscriberWelcomeService = new SubscriberWelcomeService();
