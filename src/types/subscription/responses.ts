import { AccessLevel, PaywallType, SubscriptionStatus } from "@/constants";
import { AccessTier, Capability } from "@/constants/access-policy";

interface AllowanceStatus {
  limit: number;
  used: number;
  remaining: number;
}

/**
 * The new entitlement model surfaced to the client as its single source of
 * truth (P1/P2). Additive to the legacy `subscription.accessLevel` block so the
 * current app keeps working until it's updated to read this.
 */
export interface EntitlementsInfo {
  tier: AccessTier;
  capabilities: Record<Capability, boolean>;
  // Free-tier lifetime allowances; null for paid/complimentary/bypass tiers
  // (not metered — the client should treat those as unrestricted).
  freeAllowances: {
    initialPlan: AllowanceStatus;
    weekAdjustment: AllowanceStatus;
    dayAdjustment: AllowanceStatus;
  } | null;
}

export interface PaywallResponse {
  success: false;
  error: string;
  paywall: {
    type: PaywallType;
    message: string;
    limits?: {
      weeklyGenerations: { used: number; limit: number };
      dailyRegenerations: { used: number; limit: number };
      tokens: { used: number; limit: number };
    };
  };
}

export interface SubscriptionResponse {
  success: true;
  subscription: {
    id: number;
    userId: number;
    status: SubscriptionStatus;
    planId: string | null;
    subscriptionStartDate: string | null;
    subscriptionEndDate: string | null;
    // Computed entitlement (accounts for grace period), not just raw status —
    // this is what callers should actually gate access on.
    accessLevel: AccessLevel;
  };
  // New entitlement model (P2). Optional so the field can roll out ahead of the
  // client update that consumes it.
  entitlements?: EntitlementsInfo;
}

export interface TrialUsageResponse {
  success: true;
  usage: {
    weeklyGenerations: { used: number; limit: number };
    dailyRegenerations: { used: number; limit: number };
    tokens: { used: number; limit: number };
  };
}

export interface SubscriptionPlan {
  id: number;
  planId: string;
  name: string;
  description: string | null;
  billingPeriod: "monthly" | "annual";
  priceUsd: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPlansResponse {
  success: true;
  plans: SubscriptionPlan[];
}
