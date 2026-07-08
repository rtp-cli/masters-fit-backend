import { AccessLevel, PaywallType, SubscriptionStatus } from "@/constants";

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
