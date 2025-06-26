import {
  Body,
  Controller,
  Post,
  Route,
  Response,
  SuccessResponse,
  Tags,
  Example,
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
} from "@/types";
import { userService, authService } from "@/services";
import { emailService } from "@/services/email.service";
import { emailAuthSchema, InsertUser, insertUserSchema } from "@/models";
import jwt from "jsonwebtoken";

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
      },
      needsOnboarding: false,
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
        console.log(`[DEV] Magic login code for ${email}: ${authCode}`);
      }
    } catch (error) {
      console.error(
        "[AuthController] Failed to send OTP email during login:",
        error
      );
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
        console.log(`[DEV] Magic login code for ${email}: ${authCode}`);
      }
    } catch (error) {
      console.error(
        "[AuthController] Failed to send OTP email during signup:",
        error
      );
    }

    return {
      success: true,
      message: "User created successfully",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
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
        console.log(`[DEV] Magic login code for ${email}: ${authCode}`);
      }
    } catch (error) {
      console.error(
        "[AuthController] Failed to send OTP email during generation:",
        error
      );
    }

    return {
      success: true,
    };
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
      },
      needsOnboarding: user.needsOnboarding ?? false,
      token: token,
    };
  }
}
