import {
  Body,
  Controller,
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
  SignUpRequest,
  AcceptWaiverRequest,
} from "@/types";
import { userService, authService } from "@/services";
import { emailService } from "@/services/email.service";
import { emailAuthSchema, InsertUser, insertUserSchema } from "@/models";
import jwt from "jsonwebtoken";
import { logger } from "@/utils/logger";
import { CURRENT_WAIVER_VERSION, hasAcceptedCurrentWaiver, isWaiverUpdate } from "@/constants/waiver";

// Simulating sessions for passwordless auth (in production, use a proper session store)
// const authCodes = new Map<string, { email: string; expires: number }>();

@Route("auth")
@Tags("Authentication")
export class AuthController extends Controller {
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

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d",
      }
    );

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? false,
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
      },
      needsOnboarding: user.needsOnboarding ?? false,
      needsWaiverUpdate: !hasAcceptedCurrentWaiver(user),
      token: token,
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

    try {
      const authCode = await authService.generateAuthCode(email);
      await emailService.sendOtpEmail(
        email,
        authCode,
        user?.name ?? email.split("@")[0]
      );

      if (process.env.NODE_ENV !== "production") {
        logger.info("Auth code generated for login", {
          operation: "login",
          metadata: {
            email,
            authCode:
              process.env.NODE_ENV === "development" ? authCode : "[REDACTED]",
          },
        });
      }
    } catch (error) {
      logger.error("Failed to send OTP email during login", error as Error, {
        operation: "login",
        metadata: { email },
      });
      // Depending on desired behavior, you might want to stop the process here
      // For now, we'll just log it and let the user continue without an email
    }

    return {
      success: true,
      message: "Authorization code generated successfully",
      userExists: !!user,
      needsOnboarding: user?.needsOnboarding ?? true,
    };
  }

  @Post("signup")
  @Response<AuthSignupResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async signup(
    @Body() requestBody: SignUpRequest
  ): Promise<AuthSignupResponse> {
    const validatedData = insertUserSchema.parse(requestBody);
    const { email, name } = validatedData;
    const user = await userService.createUser({
      email,
      name,
    });

    try {
      const authCode = await authService.generateAuthCode(email);
      await emailService.sendOtpEmail(email, authCode, name);

      if (process.env.NODE_ENV !== "production") {
        logger.info("Auth code generated for signup", {
          operation: "signup",
          metadata: {
            email,
            authCode:
              process.env.NODE_ENV === "development" ? authCode : "[REDACTED]",
          },
        });
      }
    } catch (error) {
      logger.error("Failed to send OTP email during signup", error as Error, {
        operation: "signup",
        metadata: { email },
      });
    }

    return {
      success: true,
      message: "User created successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? true,  // New users need onboarding
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
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
      logger.error(
        "Failed to send OTP email during generation",
        error as Error,
        {
          operation: "generateAuthCode",
          metadata: { email },
        }
      );
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
  public async getWaiverStatus(
    @Request() request: any
  ): Promise<{
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
    const { authCode } = requestBody;

    if (!authCode) {
      return {
        success: false,
        error: "Auth code is required",
      };
    }

    const codeInfo = await authService.getValidAuthCode(authCode);

    if (!codeInfo) {
      return {
        success: false,
        error: "Invalid or expired auth code",
      };
    }

    await authService.invalidateAuthCode(authCode);

    const user = await userService.getUserByEmail(codeInfo.email);

    if (!user) {
      // Generate a token for the pending user
      const token = jwt.sign(
        {
          email: codeInfo.email,
          isOnboarding: true,
        },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" }
      );

      return {
        success: true,
        needsOnboarding: true,
        email: codeInfo.email,
        token: token,
      };
    }

    // Generate token for existing user
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        needsOnboarding: user.needsOnboarding ?? false,
        waiverAcceptedAt: user.waiverAcceptedAt,
        waiverVersion: user.waiverVersion,
      },
      needsOnboarding: user.needsOnboarding ?? false,
      needsWaiverUpdate: !hasAcceptedCurrentWaiver(user),
      token: token,
    };
  }
}
