import { BaseService } from "./base.service";
import { authCodes } from "@/models";
import type { AuthCode, InsertAuthCode } from "@/models";
import { and, eq, gt } from "drizzle-orm";
import { logger } from "@/utils/logger";
import { systemConfigService } from "./system-config.service";

export class AuthService extends BaseService {
  /**
   * Check if an email is a test account
   * First checks system_config, then falls back to environment variables
   */
  private async isTestAccount(email: string): Promise<boolean> {
    // First check system_config for test emails
    const isSystemConfigTestEmail = await systemConfigService.isTestEmail(email);
    if (isSystemConfigTestEmail) {
      return true;
    }

    // Fall back to environment variables for backward compatibility
    const testAccountsEnabled = process.env.TEST_ACCOUNTS_ENABLED === "true";
    if (!testAccountsEnabled) return false;

    const testAccountNew = process.env.TEST_ACCOUNT_NEW;
    const testAccountExisting = process.env.TEST_ACCOUNT_EXISTING;

    return email === testAccountNew || email === testAccountExisting;
  }

  /**
   * Check if an email should use bypass OTP (9876)
   * This checks system_config for test emails
   */
  private async isBypassEmail(email: string): Promise<boolean> {
    return await systemConfigService.isTestEmail(email);
  }
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
    // Check if this is a bypass email (from system_config)
    const isBypass = await this.isBypassEmail(email);
    if (isBypass) {
      const bypassOtp = "9876";
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      logger.info("Generating bypass OTP for test email", {
        operation: "generateAuthCode",
        metadata: { email, isBypassEmail: true, bypassOtp },
      });

      // First, delete any existing bypass OTP codes globally to prevent unique constraint violations
      await this.db.delete(authCodes).where(eq(authCodes.code, bypassOtp));

      await this.createAuthCode({
        email,
        code: bypassOtp,
        expires_at: expiresAt,
      });

      return bypassOtp;
    }

    // Check if this is a test account (from environment variables)
    const isTest = await this.isTestAccount(email);
    if (isTest) {
      const testOtp = process.env.TEST_ACCOUNT_OTP || "1234";
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      logger.info("Generating test OTP for test account", {
        operation: "generateAuthCode",
        metadata: { email, isTestAccount: true },
      });

      // First, delete any existing test OTP codes globally to prevent unique constraint violations
      await this.db.delete(authCodes).where(eq(authCodes.code, testOtp));

      await this.createAuthCode({
        email,
        code: testOtp,
        expires_at: expiresAt,
      });

      return testOtp;
    }

    // Normal flow for regular accounts
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
          logger.debug("Auth code collision detected, retrying", {
            operation: "generateAuthCode",
            metadata: { email, attempts: attempts + 1 },
          });
          attempts++;
        } else {
          // It's a different error, so we should not retry.
          logger.error("Failed to create auth code", error, {
            operation: "generateAuthCode",
            metadata: { email },
          });
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
