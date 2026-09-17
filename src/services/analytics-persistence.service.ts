import { db } from "@/config/database";
import { analyticsEvents, AnalyticsEventSource } from "@/models";
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
      await db.insert(analyticsEvents).values({
        userId: params.userId ?? null,
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
}

export const analyticsPersistenceService = new AnalyticsPersistenceService();
