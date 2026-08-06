import { BaseService } from "@/services/base.service";
import { profiles, Profile, InsertProfile } from "@/models";
import { createTimestamp } from "@/utils/date.utils";
import {
  getEquipmentForEnvironment,
  WorkoutEnvironments,
} from "@/constants/profile";
import { trainingLocationService } from "@/services/training-location.service";

export class ProfileService extends BaseService {
  async getProfileByUserId(userId: number): Promise<Profile | undefined> {
    const result = await this.db
      .select()
      .from(profiles)
      .where(this.eq(profiles.userId, userId));
    const profile = result[0];
    if (profile) {
      // Strip PostgreSQL array notation if environment was stored as e.g. {"bodyweight_only"}
      profile.environment = this.normalizeEnumField(profile.environment) as any;
    }
    return profile;
  }

  // Strips PostgreSQL set literal syntax: {"value"} → "value"
  private normalizeEnumField(value: string | null | undefined): string | null | undefined {
    if (!value) return value;
    const match = value.match(/^\{"?([^"{}]+)"?\}$/);
    return match ? match[1] : value;
  }

  /**
   * Persist the user's IANA timezone. Update-only: if no profile exists yet
   * (e.g. a token refresh before onboarding) this is a no-op rather than
   * inserting a partial profile row. Onboarding sets the timezone at profile
   * creation time instead.
   */
  async updateTimezone(userId: number, timezone: string): Promise<void> {
    await this.db
      .update(profiles)
      .set({ timezone, updatedAt: createTimestamp() })
      .where(this.eq(profiles.userId, userId));
  }

  async createOrUpdateProfile(profileData: InsertProfile): Promise<Profile> {
    // Automatically set equipment based on environment
    const processedData = this.processProfileData(profileData);

    const existingProfile = await this.getProfileByUserId(profileData.userId);

    if (existingProfile) {
      // For updates, skip only fields the caller didn't provide (undefined, or
      // the `?? null` convention used by full-payload callers). Empty strings
      // and empty arrays are deliberate clears and MUST be written — dropping
      // them made it impossible to remove your last limitation, erase medical
      // notes, or clear equipment (the save silently no-opped).
      const updateFields: Partial<InsertProfile> = {};

      Object.keys(processedData).forEach(key => {
        const value = processedData[key];

        if (value !== undefined && value !== null) {
          updateFields[key as keyof InsertProfile] = value;
        }
      });

      // Always update the timestamp
      updateFields.updatedAt = createTimestamp();

      const result = await this.db
        .update(profiles)
        .set(updateFields)
        .where(this.eq(profiles.userId, profileData.userId))
        .returning();
      const saved = result[0];
      await this.syncPrimaryLocation(saved);
      return saved;
    }

    const result = await this.db
      .insert(profiles)
      .values({ ...processedData, userId: profileData.userId })
      .returning();
    const saved = result[0];
    await this.syncPrimaryLocation(saved);
    return saved;
  }

  /**
   * Keep the user's PRIMARY training location in lock-step with the profile's
   * environment+equipment. Making this the same code path as the profile write
   * is what makes the primary row a dependent mirror rather than a second
   * independently-writable copy (see training-location.service). Best-effort:
   * a location-sync hiccup must not fail the profile save the user asked for.
   */
  private async syncPrimaryLocation(profile: Profile | undefined): Promise<void> {
    if (!profile?.environment) return;
    try {
      await trainingLocationService.syncPrimaryFromProfile(
        profile.userId,
        profile.environment,
        profile.equipment
      );
    } catch (err) {
      // Non-fatal: the profile is saved; the mirror can be reconciled later.
      // Logged inside the service's retry wrapper.
    }
  }

  private processProfileData(profileData: any): any {
    const processed = { ...profileData };

    // Normalize environment before any comparison or DB write
    if (processed.environment) {
      processed.environment = this.normalizeEnumField(processed.environment);
    }

    // Automatically assign equipment based on environment
    if (processed.environment) {
      if (processed.environment === WorkoutEnvironments.COMMERCIAL_GYM) {
        // Override equipment for commercial gym - has all equipment
        processed.equipment = getEquipmentForEnvironment(processed.environment);
        // Clear other equipment for commercial gym since they have everything.
        // "" not null: null means "not provided" to the update path and would
        // be skipped, while empty string is written as a real clear.
        processed.otherEquipment = "";
      } else if (
        processed.environment === WorkoutEnvironments.BODYWEIGHT_ONLY
      ) {
        // Override equipment for bodyweight-only - no equipment
        processed.equipment = [];
        // Clear other equipment for bodyweight since no equipment is used
        processed.otherEquipment = "";
      }
      // For HOME_GYM, keep the user-selected equipment and otherEquipment
    }

    return processed;
  }
}

export const profileService = new ProfileService();
