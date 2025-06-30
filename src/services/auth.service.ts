import { BaseService } from "./base.service";
import { authCodes } from "@/models";
import type { AuthCode, InsertAuthCode } from "@/models";
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

  async generateAuthCode(email: string): Promise<string> {
    let authCode: string;
    let attempts = 0;
    const maxAttempts = 10; // Prevent an infinite loop in an edge case

    while (attempts < maxAttempts) {
      authCode = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      try {
        await this.createAuthCode({
          email,
          code: authCode,
          expires_at: expiresAt,
        });
        // If we get here, the code was unique and inserted successfully.
        return authCode;
      } catch (error: any) {
        // Check for PostgreSQL's unique violation error code
        if (error.code === "23505") {
          console.log(
            `[AuthService] Collision detected for auth code ${authCode}. Retrying...`
          );
          attempts++;
        } else {
          // It's a different error, so we should not retry.
          console.error("[AuthService] Failed to create auth code:", error);
          throw error;
        }
      }
    }

    // If we've exhausted all attempts, throw an error.
    throw new Error(
      "Failed to generate a unique authentication code after multiple attempts."
    );
  }
}

export const authService = new AuthService();
