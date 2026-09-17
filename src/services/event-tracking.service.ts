import { mixpanelService } from "./mixpanel.service";
import { analyticsPersistenceService } from "./analytics-persistence.service";
import { BACKEND_ANALYTICS_EVENT } from "@/constants/analytics-events";
import { logger } from "@/utils/logger";

/**
 * Event Tracking Service
 * Handles all custom analytics events using user UUIDs
 */
export class EventTrackingService {
  /**
   * Identify user in Mixpanel using UUID
   */
  private async identifyUser(userUuid: string, ip?: string): Promise<void> {
    try {
      await mixpanelService.identify(userUuid, ip);
      logger.debug("User identified in analytics", { userUuid, hasIP: !!ip });
    } catch (error) {
      logger.warn("Failed to identify user in analytics", {
        userUuid,
      });
    }
  }

  /**
   * Track a simple event using user UUID
   */
  async trackEvent(
    userUuid: string,
    eventName: string,
    properties: Record<string, any> = {},
    ip?: string
  ): Promise<void> {
    try {
      if (!userUuid) {
        logger.warn("Missing user UUID", { eventName });
        return;
      }

      // Identify user in Mixpanel first
      await this.identifyUser(userUuid, ip);

      // Durable mirror FIRST, deliberately. This is the copy the funnel is
      // queried from, so it must not be skipped by a Mixpanel failure -- if the
      // mirror ran after and mixpanelService.track threw, the shared catch below
      // would swallow the error and silently drop the row. Ordering it first
      // makes the durable write independent of the non-durable one. It never
      // throws, so it cannot conversely block the Mixpanel send.
      await analyticsPersistenceService.record({
        userUuid,
        eventName,
        properties,
        source: "server",
      });

      // Track the event (Mixpanel handles timestamp automatically)
      await mixpanelService.track(userUuid, eventName, properties, ip);

      logger.info("Event tracked successfully", {
        userUuid,
        eventName,
        hasIP: !!ip,
        ipPreview: ip ? ip.substring(0, 8) + "..." : undefined,
      });
    } catch (error) {
      logger.error("Failed to track event", error as Error, {
        userUuid,
        eventName,
      });
    }
  }

  /**
   * Track workout generation
   */
  async trackWorkoutGenerated(
    userUuid: string,
    data: {
      generation_scope: "day" | "week";
      workout_style?: string;
      days_per_week?: number;
      equipment_profile?: string;
      llm_model: string;
      regeneration_reason?: string;
      generation_time_ms?: number;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(
      userUuid,
      BACKEND_ANALYTICS_EVENT.SERVER_WORKOUT_GENERATED,
      data,
      ip
    );
  }

  /**
   * Track workout generation failure
   */
  async trackWorkoutGenerationFailed(
    userUuid: string,
    data: {
      generation_scope: "day" | "week";
      error?: string;
      llm_model: string;
      workout_style?: string;
      days_per_week?: number;
      equipment_profile?: string;
      regeneration_reason?: string;
      error_type?: string;
      failure_reason?: string;
      generation_time_ms?: number;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(
      userUuid,
      BACKEND_ANALYTICS_EVENT.SERVER_WORKOUT_GENERATION_FAILED,
      data,
      ip
    );
  }

  /**
   * Track exercise replacement
   */
  async trackExerciseReplaced(
    userUuid: string,
    data: {
      previous_exercise_id: number;
      previous_exercise_name: string;
      current_exercise_id: number;
      current_exercise_name: string;
      workout_id: number;
      plan_day_id: number;
      workout_block_id: number;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(
      userUuid,
      BACKEND_ANALYTICS_EVENT.EXERCISE_REPLACED,
      data,
      ip
    );
  }

  /**
   * Track workout started
   */
  async trackWorkoutStarted(
    userUuid: string,
    data: {
      workout_id: number;
      plan_day_id: number;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(
      userUuid,
      BACKEND_ANALYTICS_EVENT.WORKOUT_STARTED,
      data,
      ip
    );
  }

  /**
   * Track workout completed
   */
  async trackWorkoutCompleted(
    userUuid: string,
    data: {
      workout_id: number;
      plan_day_id: number;
      duration_ms: number;
      completion_percentage: number;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(
      userUuid,
      BACKEND_ANALYTICS_EVENT.WORKOUT_COMPLETED,
      data,
      ip
    );
  }

  /**
   * Update user profile with onboarding status
   */
  async updateUserProfile(
    userUuid: string,
    properties: Record<string, any>,
    ip?: string
  ): Promise<void> {
    try {
      if (!userUuid) {
        logger.warn("Missing user UUID for profile update");
        return;
      }

      await mixpanelService.setUserProfile(
        userUuid,
        {
          ...properties,
          onboarding_complete: properties.onboarding_complete ?? false,
        },
        ip
      );
      logger.info("User profile updated successfully", {
        userUuid,
        hasIP: !!ip,
      });
    } catch (error) {
      logger.error("Failed to update user profile", error as Error, {
        userUuid,
      });
    }
  }

  /**
   * Cache for users whose profiles have been synced to avoid duplicate API calls
   */
  private profileSyncCache = new Set<string>();

  /**
   * Ensure user profile exists in Mixpanel with comprehensive data
   */
  async ensureUserProfileExists(
    user: {
      id: number;
      uuid: string;
      email: string;
      name: string;
      createdAt: Date | null;
      needsOnboarding?: boolean | null;
      waiverAcceptedAt?: Date | null;
    },
    ip?: string
  ): Promise<void> {
    try {
      // Check cache to avoid duplicate syncs
      if (this.profileSyncCache.has(user.uuid)) {
        return;
      }

      // Identify user first
      await this.identifyUser(user.uuid, ip);

      // Create comprehensive profile data
      // No $email / $name: the profile is keyed on user.uuid, which is enough to
      // join back to an account internally, so putting a real identity into a
      // third-party analytics tool bought us nothing. Also enforced by
      // PROFILE_DENYLIST in mixpanel.service.ts.
      const profileData: Record<string, any> = {
        $created: user.createdAt,
        onboarding_complete: !user.needsOnboarding,
        waiver_accepted: !!user.waiverAcceptedAt,
      };

      // Try to get additional profile data from profile service
      try {
        const { profileService } = await import("@/services/profile.service");
        const userProfile = await profileService.getProfileByUserId(user.id);

        if (userProfile) {
          // Add fitness profile data
          if (userProfile.age) profileData.age = userProfile.age;
          if (userProfile.gender) profileData.gender = userProfile.gender;
          if (userProfile.fitnessLevel)
            profileData.fitness_level = userProfile.fitnessLevel;
          if (userProfile.environment)
            profileData.workout_environment = userProfile.environment;
          if (userProfile.equipment)
            profileData.available_equipment = userProfile.equipment;
          if (userProfile.preferredStyles)
            profileData.preferred_workout_styles = userProfile.preferredStyles;
          if (userProfile.goals) profileData.primary_goals = userProfile.goals;
          // Physical limitations are health data about an identified person and
          // are deliberately not sent to Mixpanel.
        }
      } catch (profileError) {
        // Profile might not exist yet, that's okay
        logger.debug("No profile data found for user", { userId: user.id });
      }

      // Set user profile in Mixpanel
      await mixpanelService.setUserProfile(user.uuid, profileData, ip);

      // Cache this user to avoid duplicate syncs
      this.profileSyncCache.add(user.uuid);

      logger.info("User profile ensured in Mixpanel", {
        userUuid: user.uuid,
        hasProfile: Object.keys(profileData).length > 3, // More than the 3 base fields
        hasIP: !!ip,
        ipPreview: ip ? ip.substring(0, 8) + "..." : undefined,
      });
    } catch (error) {
      logger.error("Failed to ensure user profile exists", error as Error, {
        userId: user.id,
        userUuid: user.uuid,
      });
      // Don't throw - this shouldn't break authentication flow
    }
  }

  /**
   * Clear profile sync cache for a user (useful when profile is updated)
   */
  clearProfileCache(userUuid: string): void {
    this.profileSyncCache.delete(userUuid);
  }
}

export const eventTrackingService = new EventTrackingService();
