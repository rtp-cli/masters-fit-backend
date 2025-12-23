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
