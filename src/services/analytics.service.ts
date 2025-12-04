import { BaseService } from "@/services/base.service";
import { eventTrackingService } from "@/services/event-tracking.service";
import { logger } from "@/utils/logger";
import {
  VideoEngagementRequest,
  AppOpenedRequest,
  WorkoutAbandonedRequest,
  WorkoutStartedRequest,
  WorkoutCompletedRequest,
} from "@/types/analytics/requests";

/**
 * Analytics Service
 *
 * Handles frontend UI event tracking. Business logic events are automatically
 * tracked within their respective service methods.
 */
export class AnalyticsService extends BaseService {

  /**
   * Track video engagement event
   */
  async trackVideoEngagement(
    userUuid: string,
    data: VideoEngagementRequest,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackEvent(userUuid, "Video Link Opened", {
      exercise_id: data.exercise_id,
      exercise_name: data.exercise_name,
      video_url: data.video_url,
    }, ip);

    logger.info("Video engagement tracked", {
      userUuid,
      exerciseId: data.exercise_id,
      hasIP: !!ip
    });
  }

  /**
   * Track app session start
   */
  async trackAppOpened(
    userUuid: string,
    data: AppOpenedRequest,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackEvent(userUuid, "App Opened", {
      app_version: data.app_version,
      platform: data.platform,
      $os: data.platform,
    }, ip);

    logger.info("App session tracked", {
      userUuid,
      platform: data.platform,
      hasIP: !!ip
    });
  }

  /**
   * Track workout abandonment
   */
  async trackWorkoutAbandoned(
    userUuid: string,
    data: WorkoutAbandonedRequest,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackEvent(userUuid, "Workout Abandoned", {
      workout_id: data.workout_id,
      plan_day_id: data.plan_day_id,
      current_exercise: data.current_exercise,
      current_block: data.current_block,
      duration: data.duration,
    }, ip);

    logger.info("Workout abandonment tracked", {
      userUuid,
      workoutId: data.workout_id,
      duration: data.duration,
      hasIP: !!ip
    });
  }

  /**
   * Track workout started
   */
  async trackWorkoutStarted(
    userUuid: string,
    data: WorkoutStartedRequest,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackWorkoutStarted(userUuid, {
      workout_id: data.workout_id,
      plan_day_id: data.plan_day_id,
      workout_name: data.workout_name,
    }, ip);

    logger.info("Workout started tracked", {
      userUuid,
      workoutId: data.workout_id,
      planDayId: data.plan_day_id
    });
  }

  /**
   * Track workout completed
   */
  async trackWorkoutCompleted(
    userUuid: string,
    data: WorkoutCompletedRequest,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackWorkoutCompleted(userUuid, {
      workout_id: data.workout_id,
      plan_day_id: data.plan_day_id,
      duration: data.duration,
      completion_percentage: data.completion_percentage,
    }, ip);

    logger.info("Workout completed tracked", {
      userUuid,
      workoutId: data.workout_id,
      planDayId: data.plan_day_id,
      duration: data.duration,
      completionPercentage: data.completion_percentage
    });
  }

  /**
   * Track onboarding started
   */
  async trackOnboardingStarted(
    userUuid: string,
    ip?: string
  ): Promise<void> {
    await eventTrackingService.trackOnboardingStarted(userUuid, ip);

    logger.info("Onboarding started tracked", {
      userUuid
    });
  }
}

export const analyticsService = new AnalyticsService();