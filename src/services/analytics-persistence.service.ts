import { eq } from "drizzle-orm";

import { db } from "@/config/database";
import { analyticsEvents, AnalyticsEventSource, users } from "@/models";
import { logger } from "@/utils/logger";

/**
 * Durable mirror of the analytics events that otherwise live only in Mixpanel.
 *
 * Design rule: recording an event must NEVER fail the thing that produced it.
 * Every method here swallows its errors and logs. A dropped analytics row is an
 * acceptable loss; a 500 on "start workout" because the events table was
 * unreachable is not.
 */
export class AnalyticsPersistenceService {
  async record(params: {
    userId?: number | null;
    userUuid?: string | null;
    eventName: string;
    properties?: Record<string, unknown> | null;
    source: AnalyticsEventSource;
    clientEventId?: string | null;
    occurredAt?: Date | null;
  }): Promise<void> {
    try {
      // Backend-emitted events only carry the uuid (EventTrackingService is
      // keyed on Mixpanel's distinct_id), so without this every server row would
      // land with a null user_id -- making the (user_id, event_name, created_at)
      // index useless for exactly those events, and forcing funnel queries to
      // join on uuid for server rows and id for client rows. Resolve it once so
      // every row is queryable the same way. users.uuid is uniquely indexed and
      // event volume is low, so the extra lookup is not worth avoiding.
      const userId = params.userId ?? (await this.resolveUserId(params.userUuid));

      await db.insert(analyticsEvents).values({
        userId: userId ?? null,
        userUuid: params.userUuid ?? null,
        eventName: params.eventName,
        properties: params.properties ?? null,
        source: params.source,
        clientEventId: params.clientEventId ?? null,
        occurredAt: params.occurredAt ?? null,
      });
    } catch (error) {
      // A duplicate clientEventId is the expected, benign case: apiRequest
      // retried once after a token refresh. Everything else is worth a warning,
      // but neither should ever propagate.
      const message = (error as Error)?.message ?? "";
      if (message.includes("idx_analytics_events_client_event_id")) {
        logger.debug("Duplicate analytics event ignored", {
          eventName: params.eventName,
          clientEventId: params.clientEventId,
        });
        return;
      }
      logger.warn("Failed to persist analytics event", {
        eventName: params.eventName,
        source: params.source,
      });
    }
  }

  /** uuid -> users.id, or null if absent/unknown. Never throws. */
  private async resolveUserId(
    userUuid?: string | null
  ): Promise<number | null> {
    if (!userUuid) return null;
    try {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.uuid, userUuid))
        .limit(1);
      return row?.id ?? null;
    } catch {
      // A row with a null user_id is still worth keeping -- user_uuid is on it.
      return null;
    }
  }
}

export const analyticsPersistenceService = new AnalyticsPersistenceService();
