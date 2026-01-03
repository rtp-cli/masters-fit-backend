// RevenueCat webhook payload types
// Based on: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

/**
 * RevenueCat webhook event types
 * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#event-types
 */
export enum REVENUE_CAT_EVENT_TYPES {
  TEST = "TEST", // Test event issued through dashboard
  INITIAL_PURCHASE = "INITIAL_PURCHASE", // New subscription purchased
  RENEWAL = "RENEWAL", // Subscription renewed or lapsed user resubscribed
  CANCELLATION = "CANCELLATION", // Subscription cancelled or refunded
  UNCANCELLATION = "UNCANCELLATION", // Non-expired cancelled subscription re-enabled
  NON_RENEWING_PURCHASE = "NON_RENEWING_PURCHASE", // Purchase that won't auto-renew
  SUBSCRIPTION_PAUSED = "SUBSCRIPTION_PAUSED", // Subscription set to pause at end of period (Play Store only)
  EXPIRATION = "EXPIRATION", // Subscription expired, access should be removed
  BILLING_ISSUE = "BILLING_ISSUE", // Problem charging subscriber
  PRODUCT_CHANGE = "PRODUCT_CHANGE", // Subscriber changed products
  TRANSFER = "TRANSFER", // Subscription transferred between users
  SUBSCRIBER_ALIAS = "SUBSCRIBER_ALIAS", // New alias created for subscriber
}

export type RevenueCatEventType =
  (typeof REVENUE_CAT_EVENT_TYPES)[keyof typeof REVENUE_CAT_EVENT_TYPES];

export enum REVENUE_CAT_CANCEL_REASONS {
  UNSUBSCRIBE = "UNSUBSCRIBE", // User cancelled voluntarily
  BILLING_ERROR = "BILLING_ERROR", // Payment method failed
  DEVELOPER_INITIATED = "DEVELOPER_INITIATED", // Developer cancelled subscription
  PRICE_INCREASE = "PRICE_INCREASE", // User didn't agree to price increase
  CUSTOMER_SUPPORT = "CUSTOMER_SUPPORT", // Refund from support
  UNKNOWN = "UNKNOWN", // Apple didn't provide reason
  SUBSCRIPTION_PAUSED = "SUBSCRIPTION_PAUSED", // Subscription paused (Play Store)
}

/**
 * Cancellation and expiration reasons
 * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#cancellation-and-expiration-reasons
 */
export type RevenueCatCancelReason =
  (typeof REVENUE_CAT_CANCEL_REASONS)[keyof typeof REVENUE_CAT_CANCEL_REASONS];

export enum REVENUE_CAT_PERIOD_TYPES {
  TRIAL = "TRIAL", // Trial period
  INTRO = "INTRO", // Introductory period
  NORMAL = "NORMAL", // Normal period
  PROMOTIONAL = "PROMOTIONAL", // Promotion period
}

/**
 * Period type for the subscription
 */
export type RevenueCatPeriodType =
  (typeof REVENUE_CAT_PERIOD_TYPES)[keyof typeof REVENUE_CAT_PERIOD_TYPES];

export enum REVENUE_CAT_STORES {
  APP_STORE = "APP_STORE", // App Store
  MAC_APP_STORE = "MAC_APP_STORE", // Mac App Store
  PLAY_STORE = "PLAY_STORE", // Play Store
  AMAZON = "AMAZON", // Amazon
  STRIPE = "STRIPE", // Stripe
  RC_BILLING = "RC_BILLING", // RevenueCat billing
  PROMOTIONAL = "PROMOTIONAL", // Promotion period
  ROKU = "ROKU", // Roku
}

export type RevenueCatStore =
  (typeof REVENUE_CAT_STORES)[keyof typeof REVENUE_CAT_STORES];

/**
 * Environment (sandbox or production)
 */
export type RevenueCatEnvironment = "SANDBOX" | "PRODUCTION";

/**
 * RevenueCat webhook event payload
 * Contains all fields that may be present in webhook events
 * @see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#common-fields
 */
export interface RevenueCatWebhookEvent {
  // Common fields (always present)
  id: string; // Unique identifier for the event
  type: RevenueCatEventType;
  app_user_id: string; // RevenueCat App User ID

  // Subscriber info
  aliases?: string[]; // List of aliases
  original_app_user_id?: string; // Original app user ID

  // Product/Subscription info
  product_id?: string; // Store product identifier
  entitlement_ids?: string[]; // Array of entitlement IDs
  entitlement_id?: string; // Single entitlement ID (deprecated but may still appear)

  // Timing fields (milliseconds since Unix epoch)
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  event_timestamp_ms?: number;

  // Legacy timing fields (ISO 8601 strings - for backwards compatibility)
  purchased_at?: string;
  expires_at?: string;

  // Subscription details
  period_type?: RevenueCatPeriodType;
  environment?: RevenueCatEnvironment;
  store?: RevenueCatStore;

  // Transaction identifiers
  transaction_id?: string;
  original_transaction_id?: string; // Use this to identify a subscription across renewals

  // Pricing info
  price?: number;
  price_in_purchased_currency?: number;
  currency?: string;
  country_code?: string; // ISO 3166 country code

  // Offer info
  offer_code?: string;
  presented_offering_id?: string;

  // Subscription state
  is_trial_conversion?: boolean;
  is_family_share?: boolean;
  renewal_number?: number;
  auto_resume_at_ms?: number; // For paused subscriptions

  // Cancellation/Expiration info
  cancel_reason?: RevenueCatCancelReason;
  expiration_reason?: RevenueCatCancelReason;
  grace_period_expiration_at_ms?: number; // Grace period end for billing issues

  // Transfer event specific fields
  transferred_from?: string[];
  transferred_to?: string[];

  // Takehome revenue (after store fees)
  takehome_percentage?: number;
  tax_percentage?: number;
  commission_percentage?: number;

  // Subscriber attributes
  subscriber_attributes?: Record<
    string,
    {
      value: string;
      updated_at_ms: number;
    }
  >;
}

/**
 * RevenueCat webhook payload structure
 * @see https://www.revenuecat.com/docs/integrations/webhooks
 */
export interface RevenueCatWebhookPayload {
  api_version?: string;
  event: RevenueCatWebhookEvent;
}

/**
 * Parsed subscription info from webhook for internal use
 */
export interface ParsedSubscriptionInfo {
  userId: number;
  revenuecatCustomerId: string;
  originalTransactionId: string | null;
  productId: string | null;
  purchasedAt: Date | null;
  expiresAt: Date | null;
  periodType: RevenueCatPeriodType | null;
  environment: RevenueCatEnvironment | null;
  store: RevenueCatStore | null;
  isTrialConversion: boolean;
  cancelReason: RevenueCatCancelReason | null;
  gracePeriodExpiresAt: Date | null;
}
