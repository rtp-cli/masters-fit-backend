import { BaseService } from "./base.service";
import { authCodes } from "@/models";
import type { AuthCode, InsertAuthCode } from "@/models";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "@/utils/logger";
import { systemConfigService } from "./system-config.service";

// §4.3 — a code is invalidated after this many failed verify attempts.
export const MAX_VERIFY_ATTEMPTS = 5;

// §4.4 — discriminated result so the controller can return distinct error codes.
export type VerifyCodeResult =
  | { status: "VALID"; authCode: AuthCode }
  | { status: "INVALID_CODE"; attemptsLeft: number }
  | { status: "EXPIRED_CODE" }
  | { status: "CODE_EXHAUSTED" };

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

  async invalidateAuthCode(code: string) {
    await this.db
      .update(authCodes)
      .set({ used: true })
      .where(eq(authCodes.code, code));
  }

  /**
   * §4.2/4.3/4.4 — verify a submitted code and return a distinct status.
   *
   * When `email` is provided (the merged client), the lookup is bound to the
   * email: we load that email's most recent unused code and compare, so a wrong
   * code increments a per-code attempt counter and the code is invalidated at
   * MAX_VERIFY_ATTEMPTS. This is what actually closes the brute-force hole.
   *
   * When `email` is absent (shipped client — sends only { authCode }), we fall
   * back to the legacy code-keyed lookup so live users keep working. That path
   * can't count attempts (a wrong guess is simply a different, non-existent
   * code); it fully closes when Work E makes `email` required. See issue #19.
   */
  async verifyCode(
    submittedCode: string,
    email?: string
  ): Promise<VerifyCodeResult> {
    if (email) {
      // Email-bound path — load this email's newest unused code.
      const [row] = await this.db
        .select()
        .from(authCodes)
        .where(and(eq(authCodes.email, email), eq(authCodes.used, false)))
        .orderBy(desc(authCodes.created_at))
        .limit(1);

      if (!row) {
        return { status: "INVALID_CODE", attemptsLeft: 0 };
      }
      if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
        return { status: "CODE_EXHAUSTED" };
      }
      if (row.expires_at < new Date()) {
        return { status: "EXPIRED_CODE" };
      }
      if (row.code !== submittedCode) {
        const attempts = row.attempts + 1;
        const exhausted = attempts >= MAX_VERIFY_ATTEMPTS;
        await this.db
          .update(authCodes)
          .set({ attempts, used: exhausted })
          .where(eq(authCodes.id, row.id));
        return exhausted
          ? { status: "CODE_EXHAUSTED" }
          : {
              status: "INVALID_CODE",
              attemptsLeft: MAX_VERIFY_ATTEMPTS - attempts,
            };
      }
      return { status: "VALID", authCode: row };
    }

    // Legacy code-keyed path (no email) — backward compat for shipped clients.
    const [row] = await this.db
      .select()
      .from(authCodes)
      .where(eq(authCodes.code, submittedCode))
      .limit(1);

    if (!row || row.used) {
      return { status: "INVALID_CODE", attemptsLeft: 0 };
    }
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      return { status: "CODE_EXHAUSTED" };
    }
    if (row.expires_at < new Date()) {
      return { status: "EXPIRED_CODE" };
    }
    return { status: "VALID", authCode: row };
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
