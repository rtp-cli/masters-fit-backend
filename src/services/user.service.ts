import { BaseService } from "@/services/base.service";
import { users } from "@/models";
import type { UpdateUser, User } from "@/models";
import { CURRENT_WAIVER_VERSION } from "@/constants/waiver";

export class UserService extends BaseService {
  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.email, email));
    return result[0];
  }

  async getUser(id: number): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.id, id));
    return result[0];
  }

  async getUserById(id: number): Promise<User | undefined> {
    return this.getUser(id);
  }

  async getUserByUuid(uuid: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(this.eq(users.uuid, uuid));
    return result[0];
  }

  async createUser(data: { email: string; name: string }): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async updateUser(id: number, data: Partial<UpdateUser>): Promise<User> {
    const result = await this.db
      .update(users)
      .set({
        ...(data.email !== undefined &&
          data.email !== null && { email: data.email }),
        ...(data.name !== undefined &&
          data.name !== null && { name: data.name }),
        ...(data.needsOnboarding !== undefined &&
          data.needsOnboarding !== null && {
            needsOnboarding: data.needsOnboarding,
          }),
        ...(data.pushNotificationToken !== undefined && {
          pushNotificationToken: data.pushNotificationToken,
        }),
        ...(data.waiverAcceptedAt !== undefined && {
          waiverAcceptedAt: data.waiverAcceptedAt,
        }),
        ...(data.waiverVersion !== undefined && {
          waiverVersion: data.waiverVersion,
        }),
        ...(data.isActive !== undefined &&
          data.isActive !== null && {
            isActive: data.isActive,
          }),
      })
      .where(this.eq(users.id, id))
      .returning();
    return result[0];
  }

  async updateUserByEmail(data: Partial<UpdateUser>): Promise<User> {
    const result = await this.db
      .update(users)
      .set({
        ...(data.name !== undefined &&
          data.name !== null && { name: data.name }),
        ...(data.needsOnboarding !== undefined &&
          data.needsOnboarding !== null && {
            needsOnboarding: data.needsOnboarding,
          }),
        ...(data.pushNotificationToken !== undefined && {
          pushNotificationToken: data.pushNotificationToken,
        }),
        ...(data.waiverAcceptedAt !== undefined && {
          waiverAcceptedAt: data.waiverAcceptedAt,
        }),
        ...(data.waiverVersion !== undefined && {
          waiverVersion: data.waiverVersion,
        }),
        ...(data.isActive !== undefined &&
          data.isActive !== null && {
            isActive: data.isActive,
          }),
      })
      .where(this.eq(users.email, data.email!))
      .returning();
    return result[0];
  }

  async acceptWaiver(userId: number, version: string): Promise<User> {
    // Validate version before updating
    if (version !== CURRENT_WAIVER_VERSION) {
      throw new Error(
        `Invalid waiver version. Expected ${CURRENT_WAIVER_VERSION}, received ${version}`
      );
    }

    const result = await this.db
      .update(users)
      .set({
        waiverAcceptedAt: new Date(),
        waiverVersion: version,
      })
      .where(this.eq(users.id, userId))
      .returning();
    return result[0];
  }

  async hasAcceptedWaiver(
    userId: number,
    requiredVersion?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user || !user.waiverAcceptedAt) {
      return false;
    }

    // Use the required version or default to current version
    const versionToCheck = requiredVersion || CURRENT_WAIVER_VERSION;

    // Check if user has accepted the specific version (exact match required)
    if (user.waiverVersion !== versionToCheck) {
      return false;
    }

    return true;
  }

  async hasAcceptedCurrentWaiver(userId: number): Promise<boolean> {
    return this.hasAcceptedWaiver(userId, CURRENT_WAIVER_VERSION);
  }

  async deleteAccount(userId: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Append _deleted to email to prevent login
    const deletedEmail = `${user.email}_deleted`;

    const result = await this.db
      .update(users)
      .set({
        email: deletedEmail,
        isActive: false,
      })
      .where(this.eq(users.id, userId))
      .returning();
    return result[0];
  }
}

export const userService = new UserService();
