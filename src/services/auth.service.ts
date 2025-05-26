import { BaseService } from "./base.service";
import { authCodes } from "@/models";
import type { AuthCode, InsertAuthCode } from "@/models";
import { randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";

export class AuthService extends BaseService {
  async createAuthCode(data: InsertAuthCode) {
    await this.db.insert(authCodes).values({
      email: data.email,
      code: data.code,
      expires_at: data.expires_at,
      used: false,
    });
  }

  async getValidAuthCode(code: string): Promise<AuthCode | undefined> {
    const result = await this.db
      .select()
      .from(authCodes)
      .where(
        and(
          eq(authCodes.code, code),
          eq(authCodes.used, false),
          gt(authCodes.expires_at, new Date())
        )
      )
      .limit(1);

    return result[0];
  }

  async invalidateAuthCode(code: string) {
    await this.db
      .update(authCodes)
      .set({ used: true })
      .where(eq(authCodes.code, code));
  }

  async generateAuthCode(email: string) {
    const authCode = randomBytes(3).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.createAuthCode({ email, code: authCode, expires_at: expiresAt });
    return authCode;
  }
}

export const authService = new AuthService();
