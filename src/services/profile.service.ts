import { BaseService } from "@/services/base.service";
import { profiles, Profile, InsertProfile } from "@/models";

export class ProfileService extends BaseService {
  async getProfileByUserId(userId: number): Promise<Profile | undefined> {
    const result = await this.db
      .select()
      .from(profiles)
      .where(this.eq(profiles.userId, userId));
    return result[0];
  }

  async createOrUpdateProfile(profileData: InsertProfile): Promise<Profile> {
    const existingProfile = await this.getProfileByUserId(profileData.userId);

    if (existingProfile) {
      const result = await this.db
        .update(profiles)
        .set({ ...profileData, updatedAt: new Date() })
        .where(this.eq(profiles.userId, profileData.userId))
        .returning();
      return result[0];
    }

    const result = await this.db
      .insert(profiles)
      .values({ ...profileData, userId: profileData.userId })
      .returning();
    return result[0];
  }
}

export const profileService = new ProfileService();
