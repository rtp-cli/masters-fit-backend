import { PaywallType } from "@/constants";

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
    status: "trial" | "active" | "expired" | "cancelled";
    planId: string | null;
    subscriptionStartDate: string | null;
    subscriptionEndDate: string | null;
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
