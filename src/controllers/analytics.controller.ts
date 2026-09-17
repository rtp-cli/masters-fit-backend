// Manual Express routes used - TSOA decorators removed
import { Request as ExpressRequest } from "express";
import { ApiResponse } from "@/types";
import { analyticsService } from "@/services/analytics.service";
import { logger } from "@/utils/logger";
import {
  videoEngagementSchema,
  appOpenedSchema,
  workoutAbandonedSchema,
  workoutStartedSchema,
  workoutCompletedSchema,
  clientEventSchema,
} from "@/models/analytics.schema";
import { analyticsPersistenceService } from "@/services/analytics-persistence.service";
import {
  VideoEngagementRequest,
  AppOpenedRequest,
  WorkoutAbandonedRequest,
  WorkoutStartedRequest,
  WorkoutCompletedRequest,
} from "@/types/analytics/requests";

// Helper function to get client IP from request
function getClientIP(req: any): string | undefined {
  if (!req) return undefined;
  return req.clientIP || req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || undefined;
}

/**
 * Analytics Controller
 *
 * Handles frontend UI event tracking via API.
 * Backend business logic events are automatically tracked in their respective services.
 * Uses manual Express routes instead of TSOA decorators.
 */
export class AnalyticsController {
  /**
   * Track video engagement (when user opens/plays exercise videos)
   *
   * @param requestBody Video engagement event data
   * @param request Express request object
   */
  public async trackVideoEngagement(
    requestBody: VideoEngagementRequest,
    request: ExpressRequest,
    userUuid?: string
  ): Promise<ApiResponse> {
    try {
      // Validate request data
      const validatedData = videoEngagementSchema.parse(requestBody);

      // Use authenticated user UUID (required)
      if (!userUuid) {
        throw new Error("User UUID not available from authentication");
      }

      // Track the event via service
      const clientIP = getClientIP(request);
      await analyticsService.trackVideoEngagement(userUuid, validatedData, clientIP);

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to track video engagement", error as Error, {
        userUuid: requestBody.user_id,
        operation: "trackVideoEngagement",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to track event",
      };
    }
  }

  /**
   * Track app session start
   *
   * @param requestBody App opened event data
   * @param request Express request object
   */
  public async trackAppOpened(
    requestBody: AppOpenedRequest,
    request: ExpressRequest,
    userUuid?: string
  ): Promise<ApiResponse> {
    try {
      // Validate request data
      const validatedData = appOpenedSchema.parse(requestBody);

      // Use authenticated user UUID (required)
      if (!userUuid) {
        throw new Error("User UUID not available from authentication");
      }

      // Track the event via service
      const clientIP = getClientIP(request);
      await analyticsService.trackAppOpened(userUuid, validatedData, clientIP);

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to track app opened", error as Error, {
        userUuid: requestBody.user_id,
        operation: "trackAppOpened",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to track event",
      };
    }
  }

  /**
   * Track workout abandonment
   *
   * @param requestBody Workout abandoned event data
   * @param request Express request object
   */
  public async trackWorkoutAbandoned(
    requestBody: WorkoutAbandonedRequest,
    request: ExpressRequest,
    userUuid?: string
  ): Promise<ApiResponse> {
    try {
      // Validate request data
      const validatedData = workoutAbandonedSchema.parse(requestBody);

      // Use authenticated user UUID (required)
      if (!userUuid) {
        throw new Error("User UUID not available from authentication");
      }

      // Track the event via service
      const clientIP = getClientIP(request);
      await analyticsService.trackWorkoutAbandoned(userUuid, validatedData, clientIP);

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to track workout abandoned", error as Error, {
        userUuid: requestBody.user_id,
        operation: "trackWorkoutAbandoned",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to track event",
      };
    }
  }

  /**
   * Track workout started
   *
   * @param requestBody Workout started event data
   * @param request Express request object
   */
  public async trackWorkoutStarted(
    requestBody: WorkoutStartedRequest,
    request: ExpressRequest,
    userUuid?: string
  ): Promise<ApiResponse> {
    try {
      // Validate request data
      const validatedData = workoutStartedSchema.parse(requestBody);

      // Use authenticated user UUID (required)
      if (!userUuid) {
        throw new Error("User UUID not available from authentication");
      }

      // Track the event via service
      const clientIP = getClientIP(request);
      await analyticsService.trackWorkoutStarted(userUuid, validatedData, clientIP);

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to track workout started", error as Error, {
        userUuid: requestBody.user_id,
        operation: "trackWorkoutStarted",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to track event",
      };
    }
  }

  /**
   * Track workout completed
   *
   * @param requestBody Workout completed event data
   * @param request Express request object
   */
  public async trackWorkoutCompleted(
    requestBody: WorkoutCompletedRequest,
    request: ExpressRequest,
    userUuid?: string
  ): Promise<ApiResponse> {
    try {
      // Validate request data
      const validatedData = workoutCompletedSchema.parse(requestBody);

      // Use authenticated user UUID (required)
      if (!userUuid) {
        throw new Error("User UUID not available from authentication");
      }

      // Track the event via service
      const clientIP = getClientIP(request);
      await analyticsService.trackWorkoutCompleted(userUuid, validatedData, clientIP);

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to track workout completed", error as Error, {
        userUuid: requestBody.user_id,
        operation: "trackWorkoutCompleted",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to track event",
      };
    }
  }

  /**
   * Record a client-emitted analytics event in Postgres.
   *
   * This is the durable mirror ONLY -- the client SDK has already sent the event
   * to Mixpanel itself, so this deliberately does not re-emit it. Re-emitting
   * would double-count every client event in the analytics product.
   *
   * Always returns success: analytics must never break the calling screen.
   */
  public async trackClientEvent(
    requestBody: unknown,
    request: ExpressRequest,
    userUuid?: string,
    userId?: number
  ): Promise<ApiResponse> {
    try {
      const validated = clientEventSchema.parse(requestBody);

      await analyticsPersistenceService.record({
        userId: userId ?? null,
        userUuid: userUuid ?? null,
        eventName: validated.event_name,
        properties: validated.properties ?? null,
        source: "client",
        clientEventId: validated.client_event_id,
        occurredAt: validated.occurred_at
          ? new Date(validated.occurred_at)
          : null,
      });

      return { success: true };
    } catch (error) {
      logger.warn("Failed to record client analytics event", {
        operation: "trackClientEvent",
      });
      // Swallowed on purpose. The client fires this and moves on; a failure
      // here must not surface as an error on a screen the user is using.
      return { success: true };
    }
  }

}