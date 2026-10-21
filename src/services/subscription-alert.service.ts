import { eq } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { users } from "@/models/user.schema";
import { emailService } from "@/services/email.service";
import { logger } from "@/utils/logger";
import { formatUsPhone } from "@/utils/phone.utils";
import {
  isSignupNotifyEnabled,
  isSuppressedSignupEmail,
} from "@/constants/signup-notifications";
import { formatClockTime } from "@/services/signup-notification.service";
import {
  REVENUE_CAT_CANCEL_REASONS,
  REVENUE_CAT_EVENT_TYPES,
  REVENUE_CAT_PERIOD_TYPES,
  REVENUE_CAT_STORES,
  type RevenueCatWebhookEvent,
} from "@/types/subscription/requests";
import type { SubscriptionAlertTemplateProps } from "@/templates/subscription-alert-email";

const MS_PER_MINUTE = 60 * 1000;

/** Same owner timezone the signup alerts are written for. */
const OWNER_TIMEZONE = process.env.OWNER_TIMEZONE || "America/Chicago";

/** The only fields of the user the alert needs. */
export interface SubscriptionAlertUser {
  userId: number;
  name: string;
  email: string;
  createdAt: Date | null;
}

export type SubscriptionAlertOutcome =
  | "sent"
  /** Event type this alert doesn't cover (renewals, expirations, …). */
  | "not-applicable"
  /** Kill switch (SIGNUP_NOTIFY_ENABLED) is off. */
  | "disabled"
  /** Sandbox / TestFlight purchase — never real money. */
  | "sandbox"
  | "suppressed"
  /** User row vanished between processing and dispatch. */
  | "skipped"
  | "failed";

/**
 * Owner alert for subscription money events: a customer started a
 * subscription (INITIAL_PURCHASE, which includes free-trial starts) or
 * cancelled one (CANCELLATION).
 *
 * Reuses the signup-alert plumbing on purpose — same kill switch, same
 * recipients, same suppression list — so there is one set of knobs for every
 * internal owner email.
 *
 * IDEMPOTENCY lives in the caller, not here. The webhook controller fires this
 * only AFTER `markWebhookEventProcessed` has inserted the event into
 * `webhook_events`, whose `event_id` is UNIQUE. A RevenueCat retry of an event
 * that already got that far is turned away by the controller's
 * already-processed check, and two concurrent deliveries of the same event
 * cannot both win the insert — so at most one dispatch per event id.
 */
export class SubscriptionAlertService extends BaseService {
  /**
   * Read-only user lookup. Deliberately NOT
   * `subscriptionService.getUserSubscription()`, which CREATES a trial row as
   * a side effect — a notification must never manufacture subscription state.
   * Everything the alert says about the subscription comes from the webhook
   * event itself, which is the authoritative record of what just happened.
   */
  async getAlertUser(userId: number): Promise<SubscriptionAlertUser | null> {
    const [row] = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return null;
    // A phone-only customer still gets an owner alert — it's money either
    // way. `email` stays an address (it is the alert's Reply-To), so their
    // number rides along in the name instead.
    return {
      userId: row.userId,
      name: row.phone && !row.email ? `${row.name} (${formatUsPhone(row.phone)})` : row.name,
      email: row.email ?? "",
      createdAt: row.createdAt,
    };
  }

  /**
   * Send the owner alert for a processed RevenueCat event.
   *
   * THIS FUNCTION MUST NEVER THROW AND MUST NEVER BE AWAITED IN THE WEBHOOK.
   * A rejected webhook makes RevenueCat retry, and a slow one risks its
   * timeout — neither may happen because of an email. Every failure mode
   * resolves to an outcome; the controller fires it with `void`.
   */
  async dispatchSubscriptionAlert(
    event: RevenueCatWebhookEvent,
    userId: number
  ): Promise<SubscriptionAlertOutcome> {
    try {
      if (
        event.type !== REVENUE_CAT_EVENT_TYPES.INITIAL_PURCHASE &&
        event.type !== REVENUE_CAT_EVENT_TYPES.CANCELLATION
      ) {
        return "not-applicable";
      }

      // Kill switch before any database work, exactly like the signup alert.
      if (!isSignupNotifyEnabled()) return "disabled";

      // Sandbox covers TestFlight, simulator and store-review purchases. An
      // event with NO environment is treated as sandbox: only a positive
      // PRODUCTION may claim real money.
      if (event.environment !== "PRODUCTION") return "sandbox";

      const user = await this.getAlertUser(userId);
      if (!user) return "skipped";
      // Only an address can be on the suppression list; a phone-only
      // customer (email "") is never an internal account.
      if (user.email && isSuppressedSignupEmail(user.email)) return "suppressed";

      await emailService.sendSubscriptionAlertEmail(
        buildSubscriptionAlert(event, user)
      );
      return "sent";
    } catch (error) {
      // Swallowing is the point: the subscription is already recorded.
      // Log loudly (Sentry picks this up) but never propagate.
      logger.error("Subscription alert dispatch failed", error as Error, {
        operation: "dispatchSubscriptionAlert",
        userId,
        eventId: event?.id,
        eventType: event?.type,
      });
      return "failed";
    }
  }
}

/**
 * Turn a RevenueCat event + user into the email. Pure — every word in the
 * alert is decided here, which is what the tests pin.
 */
export function buildSubscriptionAlert(
  event: RevenueCatWebhookEvent,
  user: SubscriptionAlertUser
): SubscriptionAlertTemplateProps & { subject: string } {
  const name = user.name?.trim() || user.email;
  const eventAt = eventTime(event);
  const plan = event.product_id || "Unknown product";
  const store = humanizeStore(event.store);

  if (event.type === REVENUE_CAT_EVENT_TYPES.CANCELLATION) {
    const isRefund = event.cancel_reason === REVENUE_CAT_CANCEL_REASONS.CUSTOMER_SUPPORT;
    const wasTrial = event.period_type === REVENUE_CAT_PERIOD_TYPES.TRIAL;
    const expiresAt = msToDate(event.expiration_at_ms) ?? isoToDate(event.expires_at);

    // Mirrors handleCancellation: a refund revokes access now, anything else
    // keeps access until the paid period ends.
    const accessUntil = isRefund
      ? "Revoked immediately (refund)"
      : expiresAt
        ? formatDateTime(expiresAt)
        : "Not reported";

    const suffix = isRefund ? " (refunded)" : wasTrial ? " (during free trial)" : "";

    return {
      kind: "cancellation",
      subject: `[MastersFit] Subscription cancelled: ${name}${suffix}`,
      userId: user.userId,
      name,
      email: user.email,
      headline: `${name} cancelled${wasTrial ? " their free trial" : ""}`,
      summary: `User #${user.userId} · ${plan} · ${store} · cancelled ${formatClockTime(eventAt)}`,
      callout: isRefund
        ? "This was a refund — the money went back to the customer."
        : wasTrial
          ? "Cancelled during the free trial — they were never charged."
          : null,
      detailRows: [
        { label: "Reason", value: humanizeCancelReason(event.cancel_reason) },
        { label: "Access until", value: accessUntil },
        { label: "Plan", value: plan },
        { label: "Was on", value: describePeriodType(event.period_type) },
        { label: "Store", value: store },
        {
          label: "Signed up",
          value: describeSignup(user.createdAt, eventAt, "before cancelling"),
        },
      ],
    };
  }

  // INITIAL_PURCHASE
  const periodType = event.period_type;
  const isCharge = isRealCharge(periodType);
  const price = describePrice(event);

  const subjectTail =
    periodType === REVENUE_CAT_PERIOD_TYPES.TRIAL
      ? " (free trial — not charged yet)"
      : periodType === REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL
        ? " (promotional — no charge)"
        : price
          ? ` (${price})`
          : "";

  const trialEndsAt =
    periodType === REVENUE_CAT_PERIOD_TYPES.TRIAL
      ? (msToDate(event.expiration_at_ms) ?? isoToDate(event.expires_at))
      : null;

  const detailRows: { label: string; value: string }[] = [
    { label: "Type", value: describePeriodType(periodType) },
    { label: "Price", value: isCharge ? (price ?? "Not reported") : "$0 charged now" },
    { label: "Plan", value: plan },
    { label: "Store", value: store },
  ];
  if (trialEndsAt) {
    detailRows.push({ label: "Trial ends", value: formatDateTime(trialEndsAt) });
  }
  detailRows.push({
    label: "Signed up",
    value: describeSignup(user.createdAt, eventAt, "before buying"),
  });

  return {
    kind: "purchase",
    subject: `[MastersFit] 💰 New subscriber: ${name}${subjectTail}`,
    userId: user.userId,
    name,
    email: user.email,
    headline:
      periodType === REVENUE_CAT_PERIOD_TYPES.TRIAL
        ? `${name} started a free trial`
        : `${name} subscribed`,
    summary: `User #${user.userId} · ${plan} · ${store} · ${formatClockTime(eventAt)}`,
    callout:
      periodType === REVENUE_CAT_PERIOD_TYPES.TRIAL
        ? "FREE TRIAL — no money has changed hands yet. A RENEWAL event marks the first real charge."
        : periodType === REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL
          ? "PROMOTIONAL — access was granted, not bought. No charge."
          : null,
    detailRows,
  };
}

/**
 * NORMAL is a full-price charge and INTRO is a discounted one — both are real
 * money. TRIAL and PROMOTIONAL are not. An absent period type is treated as
 * a charge (its Price row reads "Not reported" if no price came with it).
 */
function isRealCharge(periodType: RevenueCatWebhookEvent["period_type"]): boolean {
  if (periodType === REVENUE_CAT_PERIOD_TYPES.TRIAL) return false;
  if (periodType === REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL) return false;
  return true;
}

function describePeriodType(periodType: RevenueCatWebhookEvent["period_type"]): string {
  switch (periodType) {
    case REVENUE_CAT_PERIOD_TYPES.TRIAL:
      return "FREE TRIAL (not charged)";
    case REVENUE_CAT_PERIOD_TYPES.INTRO:
      return "Intro offer (real charge, discounted)";
    case REVENUE_CAT_PERIOD_TYPES.NORMAL:
      return "Paid (real charge)";
    case REVENUE_CAT_PERIOD_TYPES.PROMOTIONAL:
      return "Promotional (no charge)";
    default:
      return "Not reported";
  }
}

/**
 * RevenueCat's `price` is already converted to USD; the amount the customer
 * actually paid is `price_in_purchased_currency` in `currency`. Show what they
 * paid, with the USD figure alongside when those differ — "124.99 CAD" next to
 * a bare USD number would misstate one or the other.
 */
export function describePrice(event: RevenueCatWebhookEvent): string | null {
  const local = event.price_in_purchased_currency;
  const currency = event.currency?.toUpperCase();
  const usd = event.price;

  if (local != null && currency) {
    const paid = formatMoney(local, currency);
    if (currency !== "USD" && usd != null) {
      return `${paid} (≈ ${formatMoney(usd, "USD")})`;
    }
    return paid;
  }
  if (usd != null) return formatMoney(usd, "USD");
  return null;
}

function formatMoney(amount: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
    return `${formatted} ${currency}`;
  } catch {
    // Unrecognised currency code — still show the number.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function humanizeStore(store: RevenueCatWebhookEvent["store"]): string {
  switch (store) {
    case REVENUE_CAT_STORES.APP_STORE:
      return "App Store (iOS)";
    case REVENUE_CAT_STORES.PLAY_STORE:
      return "Google Play";
    case undefined:
      return "Unknown store";
    default: {
      const spaced = String(store).replace(/_/g, " ").toLowerCase();
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
  }
}

function humanizeCancelReason(reason: RevenueCatWebhookEvent["cancel_reason"]): string {
  switch (reason) {
    case REVENUE_CAT_CANCEL_REASONS.UNSUBSCRIBE:
      return "They turned off auto-renew themselves";
    case REVENUE_CAT_CANCEL_REASONS.BILLING_ERROR:
      return "Payment failed (billing error)";
    case REVENUE_CAT_CANCEL_REASONS.DEVELOPER_INITIATED:
      return "Cancelled by us (developer-initiated)";
    case REVENUE_CAT_CANCEL_REASONS.PRICE_INCREASE:
      return "Didn't accept a price increase";
    case REVENUE_CAT_CANCEL_REASONS.CUSTOMER_SUPPORT:
      return "Refunded through store support";
    case REVENUE_CAT_CANCEL_REASONS.UNKNOWN:
      return "Store didn't give a reason";
    case undefined:
      return "Not reported";
    default:
      return String(reason);
  }
}

/** "Oct 11, 2026 — 3 days before buying": how long they took to decide. */
function describeSignup(createdAt: Date | null, eventAt: Date, tail: string): string {
  if (!createdAt) return "Unknown";
  return `${formatDate(createdAt)} — ${formatElapsed(createdAt, eventAt)} ${tail}`;
}

/** "6 minutes" / "2 hours" / "3 days" — coarse on purpose. */
export function formatElapsed(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** When the event happened, per RevenueCat; falls back to now. */
function eventTime(event: RevenueCatWebhookEvent): Date {
  return (
    msToDate(event.purchased_at_ms) ??
    msToDate(event.event_timestamp_ms) ??
    isoToDate(event.purchased_at) ??
    new Date()
  );
}

function msToDate(ms: number | undefined): Date | null {
  return ms ? new Date(ms) : null;
}

function isoToDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 11, 2026" in the owner's timezone. Year included: annual plans end a year out. */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: OWNER_TIMEZONE,
  }).format(date);
}

/** "Oct 11, 2026, 4:05 PM CDT" in the owner's timezone. */
function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: OWNER_TIMEZONE,
    timeZoneName: "short",
  }).format(date);
}

export const subscriptionAlertService = new SubscriptionAlertService();
