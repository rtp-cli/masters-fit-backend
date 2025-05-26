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

  async createUser(data: { email: string; name: string }): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async updateUser(data: Partial<UpdateUser>): Promise<User> {
    const result = await this.db
      .update(users)
      .set({
        ...(data.name !== undefined &&
          data.name !== null && { name: data.name }),
        ...(data.needsOnboarding !== undefined &&
          data.needsOnboarding !== null && {
            needsOnboarding: data.needsOnboarding,
          }),
      })
      .where(this.eq(users.email, data.email!))
      .returning();
    return result[0];
  }
}

export const userService = new UserService();
