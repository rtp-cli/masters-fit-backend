import { subscriptionService } from "@/services/subscription.service";
import { SubscriptionStatus } from "@/constants";
import {
  AccessTier,
  Capability,
  CAPABILITIES_BY_TIER,
} from "@/constants/access-policy";

/**
 * Resolves a user's effective access tier and capabilities.
 *
 * This is the P1 replacement for the legacy `AccessLevel` resolver. It is the
 * server-side source of truth consumed by route guards and by
 * GET /subscriptions/status (which the client mirrors for UX only).
 *
 * Resolution order:
 *   1. A server-granted access_override (COMPLIMENTARY | BYPASS), while unexpired.
 *   2. Billing status: ACTIVE -> PLUS; GRACE_PERIOD / CANCELLED -> PLUS while
 *      still within the paid period, else FREE; everything else (TRIAL,
 *      EXPIRED, PAUSED, unknown) -> FREE.
 */
export class AccessService {
  async resolveAccessTier(userId: number): Promise<AccessTier> {
    const sub = await subscriptionService.getUserSubscription(userId);
    const now = new Date();

    // 1) Server-granted override wins (never derived from client input).
    if (sub.accessOverride) {
      const expires = sub.accessOverrideExpiresAt;
      if (!expires || expires > now) {
        return sub.accessOverride as AccessTier;
      }
    }

    // 2) Billing-derived tier.
    switch (sub.status) {
      case SubscriptionStatus.ACTIVE:
        return AccessTier.PLUS;
      case SubscriptionStatus.GRACE_PERIOD:
      case SubscriptionStatus.CANCELLED:
        return sub.subscriptionEndDate && sub.subscriptionEndDate > now
          ? AccessTier.PLUS
          : AccessTier.FREE;
      default:
        return AccessTier.FREE;
    }
  }

  /** Whether a user currently has a given capability (entitlement check only). */
  async hasCapability(userId: number, capability: Capability): Promise<boolean> {
    const tier = await this.resolveAccessTier(userId);
    return CAPABILITIES_BY_TIER[tier].has(capability);
  }

  /** Capability map for the status endpoint / client gating. */
  async getCapabilities(
    userId: number
  ): Promise<Record<Capability, boolean>> {
    const tier = await this.resolveAccessTier(userId);
    const grants = CAPABILITIES_BY_TIER[tier];
    const result = {} as Record<Capability, boolean>;
    for (const cap of Object.values(Capability)) {
      result[cap] = grants.has(cap);
    }
    return result;
  }
}

export const accessService = new AccessService();
