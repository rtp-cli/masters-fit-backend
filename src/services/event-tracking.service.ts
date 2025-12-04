import { mixpanelService } from "./mixpanel.service";
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
      logger.warn("Failed to identify user in analytics", error as Error, {
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

      // Track the event (Mixpanel handles timestamp automatically)
      await mixpanelService.track(userUuid, eventName, properties, ip);

      logger.info("Event tracked successfully", {
        userUuid,
        eventName,
        hasIP: !!ip,
        ipPreview: ip ? ip.substring(0, 8) + "..." : undefined
      });
    } catch (error) {
      logger.error("Failed to track event", error as Error, {
        userUuid,
        eventName,
      });
    }
  }

  /**
   * Track onboarding completion
   */
  async trackOnboardingCompleted(userUuid: string, ip?: string): Promise<void> {
    await this.trackEvent(userUuid, "Onboarding Completed", {}, ip);
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
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(userUuid, "Workout Generated", data, ip);
  }

  /**
   * Track workout generation failure
   */
  async trackWorkoutGenerationFailed(
    userUuid: string,
    data: {
      generation_scope: "day" | "week";
      error: string;
      llm_model: string;
    },
    ip?: string
  ): Promise<void> {
    await this.trackEvent(userUuid, "Workout Generation Failed", data, ip);
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
    await this.trackEvent(userUuid, "Exercise Replaced", data, ip);
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
    await this.trackEvent(userUuid, "Workout Started", data, ip);
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
    await this.trackEvent(userUuid, "Workout Completed", data, ip);
  }

  /**
   * Track onboarding started
   */
  async trackOnboardingStarted(userUuid: string, ip?: string): Promise<void> {
    await this.trackEvent(userUuid, "Onboarding Started", {}, ip);
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

      await mixpanelService.setUserProfile(userUuid, {
        ...properties,
        onboarding_complete: properties.onboarding_complete ?? false,
      }, ip);
      logger.info("User profile updated successfully", { userUuid, hasIP: !!ip });
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
  async ensureUserProfileExists(user: {
    id: number;
    uuid: string;
    email: string;
    name: string;
    createdAt: Date;
    needsOnboarding?: boolean;
    waiverAcceptedAt?: Date;
  }, ip?: string): Promise<void> {
    try {
      // Check cache to avoid duplicate syncs
      if (this.profileSyncCache.has(user.uuid)) {
        return;
      }

      // Identify user first
      await this.identifyUser(user.uuid, ip);

      // Create comprehensive profile data
      const profileData: Record<string, any> = {
        $email: user.email,
        $name: user.name,
        $created: user.createdAt,
        onboarding_complete: !user.needsOnboarding,
        waiver_accepted: !!user.waiverAcceptedAt,
      };

      // Try to get additional profile data from profile service
      try {
        const { profileService } = await import('@/services/profile.service');
        const userProfile = await profileService.getProfileByUserId(user.id);

        if (userProfile) {
          // Add fitness profile data
          if (userProfile.age) profileData.age = userProfile.age;
          if (userProfile.gender) profileData.gender = userProfile.gender;
          if (userProfile.fitnessLevel) profileData.fitness_level = userProfile.fitnessLevel;
          if (userProfile.environment) profileData.workout_environment = userProfile.environment;
          if (userProfile.equipment) profileData.available_equipment = userProfile.equipment;
          if (userProfile.preferredStyles) profileData.preferred_workout_styles = userProfile.preferredStyles;
          if (userProfile.goals) profileData.primary_goals = userProfile.goals;
          if (userProfile.limitations) profileData.physical_limitations = userProfile.limitations;
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
        hasProfile: Object.keys(profileData).length > 4, // More than basic fields
        hasIP: !!ip,
        ipPreview: ip ? ip.substring(0, 8) + "..." : undefined
      });
    } catch (error) {
      logger.error("Failed to ensure user profile exists", error as Error, {
        userId: user.id,
        userUuid: user.uuid
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
