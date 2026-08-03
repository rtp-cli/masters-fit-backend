import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Example,
  Security,
  Request,
} from "@tsoa/runtime";
import { randomBytes } from "crypto";
import {
  ApiResponse,
  EmailAuthRequest,
  AuthCodeRequest,
  AuthVerifyResponse,
  AuthLoginResponse,
  AuthSignupResponse,
  AuthRefreshResponse,
  SignUpRequest,
  AcceptWaiverRequest,
  RefreshTokenRequest,
} from "@/types";
import { userService, authService, refreshTokenService, profileService } from "@/services";
import { systemConfigService } from "@/services/system-config.service";
import { emailService } from "@/services/email.service";
import { emailAuthSchema, InsertUser, insertUserSchema } from "@/models";
import jwt from "jsonwebtoken";
import { logger } from "@/utils/logger";
import {
  CURRENT_WAIVER_VERSION,
  hasAcceptedCurrentWaiver,
  isWaiverUpdate,
} from "@/constants/waiver";
import { isAdminUserId } from "@/middleware/authz.middleware";

// Simulating sessions for passwordless auth (in production, use a proper session store)
// const authCodes = new Map<string, { email: string; expires: number }>();

@Route("auth")
@Tags("Authentication")
export class AuthController extends Controller {
  private isTestAccountEmail(email: string): boolean {
    const testAccountsEnabled = process.env.TEST_ACCOUNTS_ENABLED;
    if (testAccountsEnabled !== "true") return false;

    const testAccountNew = process.env.TEST_ACCOUNT_NEW;
    const testAccountExisting = process.env.TEST_ACCOUNT_EXISTING;

    return email === testAccountNew || email === testAccountExisting;
  }
  /**
   * Check if a user exists in the system
   * @param requestBody Email to check
   */
  @Post("check-email")
  @Response<AuthVerifyResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async checkEmail(
    @Body() requestBody: EmailAuthRequest
  ): Promise<AuthVerifyResponse> {
    const validatedData = emailAuthSchema.parse(requestBody);
    const { email } = validatedData;
    const user = await userService.getUserByEmail(email);
    if (!user) {
      return {
        success: true,
        needsOnboarding: true,
        email: email,
      };
    }

    // SECURITY: check-email is a public, unauthenticated endpoint. It must NOT
    // mint a session — doing so let anyone take over any account by POSTing a
    // known email. The real session is issued at /verify after the OTP. Here we
    // return only existence/onboarding/waiver flags the client needs to route.
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? false,
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
        themeMode: user.themeMode ?? "auto",
        colorTheme: user.colorTheme ?? "original",
        isAdmin: isAdminUserId(user.id),
      },
      needsOnboarding: user.needsOnboarding ?? false,
      needsWaiverUpdate: !hasAcceptedCurrentWaiver(user),
    };
  }

  /**
   * Initiate passwordless login with email
   * @param requestBody Email for login
   */
  @Post("login")
  @Response<AuthLoginResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async login(
    @Body() requestBody: EmailAuthRequest
  ): Promise<AuthLoginResponse> {
    const validatedData = emailAuthSchema.parse(requestBody);
    const { email } = validatedData;
    const user = await userService.getUserByEmail(email);

    const isTestAccount = this.isTestAccountEmail(email);

    let authCode: string;
    try {
      authCode = await authService.generateAuthCode(email);
    } catch (error) {
      logger.error("Failed to generate auth code during login", error as Error, {
        operation: "login",
        metadata: { email, isTestAccount },
      });
      return {
        success: false,
        error: "We couldn't send your code. Please try again.",
      };
    }

    // §4.6 — surface send failures instead of swallowing them; the shipped client
    // otherwise sits waiting for a code that will never arrive (frame 1h).
    if (!isTestAccount) {
      try {
        await emailService.sendOtpEmail(
          email,
          authCode,
          user?.name ?? email.split("@")[0]
        );
      } catch (error) {
        logger.error("Failed to send OTP email during login", error as Error, {
          operation: "login",
          metadata: { email, isTestAccount },
        });
        return {
          success: false,
          error: "We couldn't send your code. Check your connection and try again.",
        };
      }
    }

    if (process.env.NODE_ENV !== "production") {
      logger.info("Auth code generated for login", {
        operation: "login",
        metadata: {
          email,
          isTestAccount,
          authCode:
            process.env.NODE_ENV === "development" ? authCode : "[REDACTED]",
        },
      });
    }

    // §4.7 — no enumeration fields (userExists / needsOnboarding); the response is
    // identical for every address so login can't be used to probe who has an account.
    return {
      success: true,
      message: "Authorization code generated successfully",
    };
  }

  /**
   * Returns the verified email from an onboarding token on the request, or
   * undefined. Only `{ isOnboarding: true }` tokens qualify — signup is the one
   * route allowed to consume them (auth.middleware.ts rejects them everywhere
   * else, §4.8). An invalid/absent/real-access token falls through to undefined.
   */
  private emailFromOnboardingToken(request: any): string | undefined {
    const authHeader = request?.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return undefined;
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        email?: string;
        isOnboarding?: boolean;
      };
      return decoded.isOnboarding && decoded.email ? decoded.email : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * §5 (Work C) — create a user and authorize on the onboarding token.
   *
   * Authenticated path (merged client): the email is taken from the verified
   * onboarding token, NOT the request body, and the response carries a real
   * access + refresh token — the email was already proven at /verify, so no OTP.
   *
   * Unauthenticated path (shipped client, no token): preserves the old behavior
   * — create the user from the body email and send an OTP; the client then
   * verifies to get its session. Returns NO tokens, so this transitional path
   * never mints a session for an unauthenticated caller. Work E deletes it and
   * makes the token mandatory. See issue #19 / AUTH-SECURITY-HOTFIX.md.
   */
  @Post("signup")
  @Response<AuthSignupResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async signup(
    @Request() request: any,
    @Body() requestBody: SignUpRequest
  ): Promise<AuthSignupResponse> {
    const onboardingEmail = this.emailFromOnboardingToken(request);

    // ---- Authenticated path: the onboarding token proves the email ----
    if (onboardingEmail) {
      const name = (requestBody.name ?? "").trim();
      if (!name) {
        return { success: false, error: "Name is required" };
      }

      let user = await userService.getUserByEmail(onboardingEmail);
      if (!user) {
        user = await userService.createUser({ email: onboardingEmail, name });
      }

      const { token, refreshToken } = await this.mintUserTokens(user);

      return {
        success: true,
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          needsOnboarding: user.needsOnboarding ?? true,
          waiverAcceptedAt: user.waiverAcceptedAt,
          waiverVersion: user.waiverVersion,
          themeMode: user.themeMode ?? "auto",
          colorTheme: user.colorTheme ?? "original",
          isAdmin: isAdminUserId(user.id),
        },
        needsOnboarding: user.needsOnboarding ?? true,
        needsWaiverUpdate: !hasAcceptedCurrentWaiver(user),
        token,
        refreshToken,
      };
    }

    // ---- Unauthenticated path (shipped client): create + send OTP, no tokens ----
    const validatedData = insertUserSchema.parse(requestBody);
    const { email, name } = validatedData;

    // Idempotent so a retry after a send failure doesn't hit a unique violation.
    let user = await userService.getUserByEmail(email);
    if (!user) {
      user = await userService.createUser({ email, name });
    }

    const isTestAccount = this.isTestAccountEmail(email);

    let authCode: string;
    try {
      authCode = await authService.generateAuthCode(email);
    } catch (error) {
      logger.error("Failed to generate auth code during signup", error as Error, {
        operation: "signup",
        metadata: { email, isTestAccount },
      });
      return {
        success: false,
        error: "We couldn't send your code. Please try again.",
      };
    }

    // §4.6 — surface send failures instead of returning success with no code sent.
    if (!isTestAccount) {
      try {
        await emailService.sendOtpEmail(email, authCode, name);
      } catch (error) {
        logger.error("Failed to send OTP email during signup", error as Error, {
          operation: "signup",
          metadata: { email, isTestAccount },
        });
        return {
          success: false,
          error: "We couldn't send your code. Check your connection and try again.",
        };
      }
    }

    if (process.env.NODE_ENV !== "production") {
      logger.info("Auth code generated for signup", {
        operation: "signup",
        metadata: {
          email,
          isTestAccount,
          authCode:
            process.env.NODE_ENV === "development" ? authCode : "[REDACTED]",
        },
      });
    }

    return {
      success: true,
      message: "User created successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? true, // New users need onboarding
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
        themeMode: user.themeMode ?? "auto",
        colorTheme: user.colorTheme ?? "original",
        isAdmin: isAdminUserId(user.id),
      },
      needsOnboarding: user?.needsOnboarding ?? true,
    };
  }

  @Post("generate-auth-code")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async generateAuthCode(
    @Body() requestBody: EmailAuthRequest
  ): Promise<ApiResponse> {
    const validatedData = emailAuthSchema.parse(requestBody);
    const { email } = validatedData;
    const user = await userService.getUserByEmail(email);
    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    try {
      const authCode = await authService.generateAuthCode(email);
      await emailService.sendOtpEmail(email, authCode, user.name);

      if (process.env.NODE_ENV !== "production") {
        logger.info("Auth code generated", {
          operation: "generateAuthCode",
          metadata: {
            email,
            authCode:
              process.env.NODE_ENV === "development" ? authCode : "[REDACTED]",
          },
        });
      }
    } catch (error) {
      // §4.6 — surface the failure so the client can prompt a retry (frame 1h)
      // instead of the user waiting on a code that never sends.
      logger.error(
        "Failed to send OTP email during generation",
        error as Error,
        {
          operation: "generateAuthCode",
          metadata: { email },
        }
      );
      return {
        success: false,
        error: "We couldn't send your code. Check your connection and try again.",
      };
    }

    return {
      success: true,
    };
  }

  /**
   * Check waiver status for authenticated user
   * @param request Authenticated request
   */
  @Get("waiver-status")
  @Security("bearerAuth")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async getWaiverStatus(@Request() request: any): Promise<{
    success: boolean;
    waiverInfo: {
      currentVersion: string;
      userVersion: string | null;
      hasAccepted: boolean;
      isUpdate: boolean;
      needsAcceptance: boolean;
    };
  }> {
    const userId = request.userId;

    if (!userId) {
      return {
        success: false,
        waiverInfo: {
          currentVersion: CURRENT_WAIVER_VERSION,
          userVersion: null,
          hasAccepted: false,
          isUpdate: false,
          needsAcceptance: true,
        },
      } as any;
    }

    try {
      const user = await userService.getUser(userId);

      if (!user) {
        return {
          success: false,
          waiverInfo: {
            currentVersion: CURRENT_WAIVER_VERSION,
            userVersion: null,
            hasAccepted: false,
            isUpdate: false,
            needsAcceptance: true,
          },
        } as any;
      }

      const hasValidWaiver = hasAcceptedCurrentWaiver(user);
      const isUpdate = isWaiverUpdate(user.waiverVersion);

      return {
        success: true,
        waiverInfo: {
          currentVersion: CURRENT_WAIVER_VERSION,
          userVersion: user.waiverVersion,
          hasAccepted: user.waiverAcceptedAt !== null,
          isUpdate,
          needsAcceptance: !hasValidWaiver,
        },
      };
    } catch (error) {
      logger.error("Failed to get waiver status", error as Error, {
        operation: "getWaiverStatus",
        metadata: { userId },
      });

      return {
        success: false,
        waiverInfo: {
          currentVersion: CURRENT_WAIVER_VERSION,
          userVersion: null,
          hasAccepted: false,
          isUpdate: false,
          needsAcceptance: true,
        },
      } as any;
    }
  }

  /**
   * Accept waiver for authenticated user
   * @param requestBody Waiver version to accept
   */
  @Post("accept-waiver")
  @Security("bearerAuth")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async acceptWaiver(
    @Request() request: any,
    @Body() requestBody: AcceptWaiverRequest
  ): Promise<ApiResponse> {
    const { version } = requestBody;

    if (!version) {
      return {
        success: false,
        error: "Waiver version is required",
      };
    }

    // Validate that the version matches the current version
    if (version !== CURRENT_WAIVER_VERSION) {
      return {
        success: false,
        error: `Invalid waiver version. Current version is ${CURRENT_WAIVER_VERSION}`,
      };
    }

    const userId = request.userId;

    if (!userId) {
      return {
        success: false,
        error: "User authentication required",
      };
    }

    try {
      await userService.acceptWaiver(userId, version);

      logger.info("Waiver accepted successfully", {
        operation: "acceptWaiver",
        metadata: { userId, version },
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to accept waiver", error as Error, {
        operation: "acceptWaiver",
        metadata: { userId, version },
      });

      return {
        success: false,
        error: "Failed to accept waiver",
      };
    }
  }

  /**
   * Verify authentication code
   * @param requestBody Auth code to verify
   */
  @Post("verify")
  @Response<AuthVerifyResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async verify(
    @Body() requestBody: AuthCodeRequest
  ): Promise<AuthVerifyResponse> {
    const { authCode, email } = requestBody;

    if (!authCode) {
      return {
        success: false,
        error: "Auth code is required",
      };
    }

    // §4.5 — 9876 test bypass, now email-gated: it only works for an email on the
    // system_config.test_email allowlist (the Apple-reviewer path). Previously the
    // branch trusted whatever account held the 9876 row, so anyone submitting 9876
    // could take that account. Verification is now gated the same way generation is.
    if (authCode === "9876") {
      if (!email || !(await systemConfigService.isTestEmail(email))) {
        return {
          success: false,
          errorCode: "INVALID_CODE",
          error: "Invalid auth code or email not authorized for bypass",
        };
      }
      // Best-effort: consume any issued bypass row so it can't be replayed.
      await authService.invalidateAuthCode("9876");
      return this.issueSessionForEmail(email);
    }

    // §4.2/4.3/4.4 — normal verification. Bound to email when the client sends it
    // (attempt-capped, brute-force-resistant); legacy code-only fallback otherwise.
    const result = await authService.verifyCode(authCode, email);

    if (result.status !== "VALID") {
      switch (result.status) {
        case "EXPIRED_CODE":
          return {
            success: false,
            errorCode: "EXPIRED_CODE",
            error: "That code has expired.",
          };
        case "CODE_EXHAUSTED":
          return {
            success: false,
            errorCode: "CODE_EXHAUSTED",
            error: "No tries left on that code. Send a new one.",
          };
        default:
          return {
            success: false,
            errorCode: "INVALID_CODE",
            attemptsLeft: result.attemptsLeft,
            error: "That code didn't match.",
          };
      }
    }

    await authService.invalidateAuthCode(authCode);
    return this.issueSessionForEmail(result.authCode.email);
  }

  /** Mint a full access + refresh token pair for a real (existing) user. */
  private async mintUserTokens(user: {
    id: number;
    email: string;
  }): Promise<{ token: string; refreshToken: string }> {
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );
    const refreshToken = await refreshTokenService.createRefreshToken(user.id);
    return { token, refreshToken };
  }

  /**
   * Mint the verify/bypass success payload for a verified email. New emails get a
   * short-lived onboarding token (§4.8, 1h, no user id) that signup exchanges for a
   * real session (§5); existing users get a full access + refresh token.
   */
  private async issueSessionForEmail(
    userEmail: string
  ): Promise<AuthVerifyResponse> {
    const user = await userService.getUserByEmail(userEmail);

    if (!user) {
      const token = jwt.sign(
        { email: userEmail, isOnboarding: true },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" }
      );

      return {
        success: true,
        needsOnboarding: true,
        email: userEmail,
        token,
      };
    }

    const { token, refreshToken } = await this.mintUserTokens(user);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? false,
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
        themeMode: user.themeMode ?? "auto",
        colorTheme: user.colorTheme ?? "original",
        isAdmin: isAdminUserId(user.id),
      },
      needsOnboarding: user.needsOnboarding ?? false,
      needsWaiverUpdate: !hasAcceptedCurrentWaiver(user),
      token,
      refreshToken,
    };
  }

  /**
   * Refresh access token using refresh token
   * @param requestBody Refresh token request
   */
  @Post("refresh")
  @Response<AuthRefreshResponse>(400, "Bad Request")
  @Response<AuthRefreshResponse>(401, "Invalid refresh token")
  @SuccessResponse(200, "Success")
  public async refreshToken(
    @Body() requestBody: RefreshTokenRequest
  ): Promise<AuthRefreshResponse> {
    const { refreshToken, timezone } = requestBody;

    if (!refreshToken) {
      return {
        success: false,
        error: "Refresh token is required",
      };
    }

    try {
      const userId =
        await refreshTokenService.validateRefreshToken(refreshToken);

      if (!userId) {
        this.setStatus(401);
        return {
          success: false,
          error: "Invalid or expired refresh token",
        };
      }

      // Get user data
      const user = await userService.getUser(userId);
      if (!user) {
        this.setStatus(401);
        return {
          success: false,
          error: "User not found",
        };
      }

      // Best-effort: refresh the persisted timezone while we have the user.
      // Fire-and-forget and swallow errors — this must never delay or fail the
      // token refresh, which is a load-bearing path.
      if (timezone) {
        void profileService.updateTimezone(userId, timezone).catch((err) => {
          logger.warn("Failed to persist user timezone on refresh", {
            operation: "refreshToken",
            metadata: { userId, error: (err as Error).message },
          });
        });
      }

      // Generate new access token
      const newAccessToken = jwt.sign(
        {
          id: user.id,
          email: user.email,
        },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" }
      );

      // Rotate the refresh token for security
      const newRefreshToken =
        await refreshTokenService.rotateRefreshToken(refreshToken);

      if (!newRefreshToken) {
        this.setStatus(500);
        return {
          success: false,
          error: "Failed to rotate refresh token",
        };
      }

      logger.info("Token refreshed successfully", {
        operation: "refreshToken",
        metadata: { userId },
      });

      return {
        success: true,
        token: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      logger.error("Failed to refresh token", error as Error, {
        operation: "refreshToken",
      });

      this.setStatus(500);
      return {
        success: false,
        error: "Failed to refresh token",
      };
    }
  }

  /**
   * Logout user and revoke refresh token
   * @param requestBody Refresh token to revoke
   */
  @Post("logout")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async logout(
    @Body() requestBody: RefreshTokenRequest
  ): Promise<ApiResponse> {
    const { refreshToken } = requestBody;

    if (!refreshToken) {
      return {
        success: false,
        error: "Refresh token is required",
      };
    }

    try {
      const userId =
        await refreshTokenService.validateRefreshToken(refreshToken);

      if (userId) {
        await refreshTokenService.revokeAllUserTokens(userId);

        logger.info("User logged out successfully", {
          operation: "logout",
          metadata: { userId },
        });
      }

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to logout user", error as Error, {
        operation: "logout",
      });

      return {
        success: false,
        error: "Failed to logout",
      };
    }
  }

  /**
   * Delete user account
   * Marks the account as inactive and appends _deleted to email to prevent login
   * @param request Authenticated request
   */
  @Delete("delete-account")
  @Security("bearerAuth")
  @Response<ApiResponse>(401, "Unauthorized")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async deleteAccount(@Request() request: any): Promise<ApiResponse> {
    const userId = request.userId;

    if (!userId) {
      return {
        success: false,
        error: "User authentication required",
      };
    }

    try {
      await userService.deleteAccount(userId);

      // Revoke all refresh tokens for the user
      await refreshTokenService.revokeAllUserTokens(userId);

      logger.info("User account deleted successfully", {
        operation: "deleteAccount",
        metadata: { userId },
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error("Failed to delete account", error as Error, {
        operation: "deleteAccount",
        metadata: { userId },
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete account",
      };
    }
  }
}
