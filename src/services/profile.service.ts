import { BaseService } from "@/services/base.service";
import { profiles, Profile, InsertProfile } from "@/models";
import { createTimestamp } from "@/utils/date.utils";
import {
  getEquipmentForEnvironment,
  WorkoutEnvironments,
} from "@/constants/profile";

export class ProfileService extends BaseService {
  async getProfileByUserId(userId: number): Promise<Profile | undefined> {
    const result = await this.db
      .select()
      .from(profiles)
      .where(this.eq(profiles.userId, userId));
    return result[0];
  }

  async createOrUpdateProfile(profileData: InsertProfile): Promise<Profile> {
    // Automatically set equipment based on environment
    const processedData = this.processProfileData(profileData);

    const existingProfile = await this.getProfileByUserId(profileData.userId);

    if (existingProfile) {
      const result = await this.db
        .update(profiles)
        .set({ ...processedData, updatedAt: createTimestamp() })
        .where(this.eq(profiles.userId, profileData.userId))
        .returning();
      return result[0];
    }

    const result = await this.db
      .insert(profiles)
      .values({ ...processedData, userId: profileData.userId })
      .returning();
    return result[0];
  }

  private processProfileData(profileData: any): any {
    const processed = { ...profileData };

    // Automatically assign equipment based on environment
    if (processed.environment) {
      if (processed.environment === WorkoutEnvironments.COMMERCIAL_GYM) {
        // Override equipment for commercial gym - has all equipment
        processed.equipment = getEquipmentForEnvironment(processed.environment);
        // Clear other equipment for commercial gym since they have everything
        processed.otherEquipment = null;
      } else if (
        processed.environment === WorkoutEnvironments.BODYWEIGHT_ONLY
      ) {
        // Override equipment for bodyweight-only - no equipment
        processed.equipment = [];
        // Clear other equipment for bodyweight since no equipment is used
        processed.otherEquipment = null;
      }
      // For HOME_GYM, keep the user-selected equipment and otherEquipment
    }

    return processed;
  }
}

export const profileService = new ProfileService();
