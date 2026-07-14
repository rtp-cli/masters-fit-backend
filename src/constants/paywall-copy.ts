/**
 * User-facing paywall copy (owner-approved 2026-07-14). The backend sends these
 * as paywall.message on 403s; the client renders the message under a static
 * "Upgrade to MastersFit+" title. Reason-specific + benefit-forward.
 */
import { Capability } from "@/constants/access-policy";

export const PAYWALL_TITLE = "Upgrade to MastersFit+";

export const PAYWALL_COPY = {
  FREE_ALLOWANCE_EXHAUSTED:
    "You've used your free workout adjustments. Upgrade to MastersFit+ to keep your training evolving as your goals, schedule, and recovery change.",
  REQUIRES_PLUS_NEW_PLAN:
    "Create new personalized training plans whenever your goals, schedule, or available equipment change—with MastersFit+.",
  REQUIRES_PLUS_ANALYTICS:
    "Track your progress over time with strength trends, training volume, and personal records—all with MastersFit+.",
  REQUIRES_PLUS_HEALTH:
    "Automatically sync your workouts with Apple Health and Health Connect using MastersFit+.",
  REQUIRES_PLUS_GENERIC:
    "Upgrade to MastersFit+ to unlock this feature and keep your training evolving.",
} as const;

/** Capability -> the requires_plus message shown when that capability is missing. */
export function requiresPlusMessageFor(capability: Capability): string {
  switch (capability) {
    case Capability.GENERATE_NEW_PROGRAM:
    case Capability.GENERATE_INITIAL_PLAN:
      return PAYWALL_COPY.REQUIRES_PLUS_NEW_PLAN;
    case Capability.VIEW_PROGRESS_ANALYTICS:
      return PAYWALL_COPY.REQUIRES_PLUS_ANALYTICS;
    case Capability.SYNC_HEALTH:
      return PAYWALL_COPY.REQUIRES_PLUS_HEALTH;
    default:
      return PAYWALL_COPY.REQUIRES_PLUS_GENERIC;
  }
}
