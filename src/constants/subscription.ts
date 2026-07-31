// Trial limits
export const TRIAL_LIMITS = {
  WEEKLY_GENERATIONS: 2,
  DAILY_REGENERATIONS: 5,
  TOKEN_CAP: 50000, // Will be set based on existing usage
} as const;

export enum AccessLevel {
  UNLIMITED = "unlimited",
  TRIAL = "trial",
  BLOCKED = "blocked",
}

export enum PaywallType {
  WEEKLY_LIMIT_EXCEEDED = "weekly_limit_exceeded",
  DAILY_REGENERATION_LIMIT_EXCEEDED = "daily_regeneration_limit_exceeded",
  TOKEN_LIMIT_EXCEEDED = "token_limit_exceeded",
  SUBSCRIPTION_REQUIRED = "subscription_required",
}

export enum SubscriptionStatus {
  TRIAL = "trial",
  ACTIVE = "active",
  EXPIRED = "expired",
  CANCELLED = "cancelled",
  GRACE_PERIOD = "grace_period", // Billing issue - user still has access during grace period
  PAUSED = "paused", // Subscription paused (Play Store only)
}

export enum BillingPeriod {
  MONTHLY = "monthly",
  ANNUAL = "annual",
}

// How many days before an auto-renewal we send the reminder email, per billing
// period. Annual gets a longer lead — the big-ticket "silent" charge people
// complain about most. Tune here; the reminder scan reads these directly.
export const RENEWAL_REMINDER_DAYS: Record<BillingPeriod, number> = {
  [BillingPeriod.ANNUAL]: 7,
  [BillingPeriod.MONTHLY]: 3,
};

// Fallback lead time when a subscription's plan (and thus billing period) can't
// be resolved — send at the wider window rather than skip the reminder.
export const RENEWAL_REMINDER_FALLBACK_DAYS = 7;

// Where the email's "Manage your subscription" button points. A store-agnostic
// help page with iOS + Android instructions (cancelling an IAP happens in the
// OS, not in-app). Overridable via env for staging/preview.
export const MANAGE_SUBSCRIPTION_URL =
  process.env.MANAGE_SUBSCRIPTION_URL ||
  "https://mastersfit.ai/manage-subscription";
