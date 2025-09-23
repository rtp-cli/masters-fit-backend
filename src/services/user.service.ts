import { BaseService } from "@/services/base.service";
import { users } from "@/models";
import type { UpdateUser, User } from "@/models";

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

  async createUser(data: { email: string; name: string }): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async updateUser(id: number, data: Partial<UpdateUser>): Promise<User> {
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
      })
      .where(this.eq(users.email, data.email!))
      .returning();
    return result[0];
  }

  async acceptWaiver(userId: number, version: string): Promise<User> {
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

  async hasAcceptedWaiver(userId: number, requiredVersion?: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user || !user.waiverAcceptedAt) {
      return false;
    }

    // If a specific version is required, check if user accepted that version or later
    if (requiredVersion && user.waiverVersion !== requiredVersion) {
      return false;
    }

    return true;
  }
}

export const userService = new UserService();
