import { logger } from "@/utils/logger";

/**
 * Thin server-side client for the RevenueCat REST API (v1). Used by
 * POST /subscriptions/sync to reconcile a user's subscription immediately after
 * purchase, closing the webhook race (client is subscribed, but the webhook
 * that flips our DB hasn't arrived yet).
 *
 * The client logs into RevenueCat with the numeric userId
 * (frontend lib/revenuecat-identity.ts -> Purchases.logIn(userId)), so the RC
 * `app_user_id` IS our userId — we can look a subscriber up directly.
 *
 * The secret key is read at CALL TIME (never a module const) and never logged.
 */
const RC_BASE = "https://api.revenuecat.com/v1";

export interface RcActiveEntitlement {
  productId: string | null;
  /** null = non-expiring / lifetime entitlement */
  expiresDate: Date | null;
  /** RevenueCat's canonical customer id (original_app_user_id) */
  revenuecatCustomerId: string;
}

export class RevenueCatService {
  /**
   * Returns the user's currently-active entitlement (latest-expiring, or a
   * lifetime one), or null if they have none. Throws if the REST key is not
   * configured or the RC API call fails (caller decides how to surface it).
   */
  async getActiveEntitlement(
    appUserId: string
  ): Promise<RcActiveEntitlement | null> {
    const key = process.env.REVENUECAT_REST_API_KEY;
    if (!key) {
      // Fail-closed: never silently treat "unconfigured" as "no subscription".
      throw new Error("REVENUECAT_REST_API_KEY is not configured");
    }

    const res = await fetch(
      `${RC_BASE}/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("RevenueCat REST API error", new Error(`status ${res.status}`), {
        operation: "revenueCat.getActiveEntitlement",
        metadata: { status: res.status, bodyPreview: body.slice(0, 200) },
      });
      throw new Error(`RevenueCat API returned ${res.status}`);
    }

    const data = (await res.json()) as {
      subscriber?: {
        original_app_user_id?: string;
        entitlements?: Record<
          string,
          { expires_date?: string | null; product_identifier?: string | null }
        >;
      };
    };

    const subscriber = data.subscriber;
    if (!subscriber) return null;
    const rcCustomerId = subscriber.original_app_user_id ?? appUserId;
    const entitlements = subscriber.entitlements ?? {};
    const now = Date.now();

    const active = Object.values(entitlements)
      .map((e) => ({
        productId: e.product_identifier ?? null,
        expiresDate: e.expires_date ? new Date(e.expires_date) : null,
      }))
      .filter((e) => e.expiresDate === null || e.expiresDate.getTime() > now);

    if (active.length === 0) return null;

    // Prefer a lifetime (non-expiring) entitlement; else the latest-expiring.
    const lifetime = active.find((e) => e.expiresDate === null);
    const chosen =
      lifetime ??
      active.reduce((a, b) =>
        (a.expiresDate as Date) >= (b.expiresDate as Date) ? a : b
      );

    return {
      productId: chosen.productId,
      expiresDate: chosen.expiresDate,
      revenuecatCustomerId: rcCustomerId,
    };
  }
}

export const revenueCatService = new RevenueCatService();
