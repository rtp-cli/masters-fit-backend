import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { AuthController } from "@/controllers/auth.controller";
import {
  userService,
  authService,
  refreshTokenService,
  profileService,
} from "@/services";
import { emailService } from "@/services/email.service";

jest.mock("@/services", () => ({
  userService: {
    getUser: jest.fn(),
    getUserByEmail: jest.fn(),
    acceptWaiver: jest.fn(),
  },
  authService: { generateAuthCode: jest.fn() },
  refreshTokenService: {
    validateRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
  },
  profileService: { updateTimezone: jest.fn(async () => undefined) },
}));

jest.mock("@/services/email.service", () => ({
  emailService: { sendOtpEmail: jest.fn(async () => undefined) },
}));

const mockedUserService = jest.mocked(userService);
const mockedAuthService = jest.mocked(authService);
const mockedEmailService = jest.mocked(emailService);
const mockedRefreshTokenService = jest.mocked(refreshTokenService);
const mockedProfileService = jest.mocked(profileService);

describe("AuthController.refreshToken", () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProfileService.updateTimezone.mockResolvedValue(undefined as any);
  });

  it("rejects with no refresh token in the body", async () => {
    const result = await controller.refreshToken({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Refresh token is required");
  });

  it("rejects an invalid/expired refresh token", async () => {
    mockedRefreshTokenService.validateRefreshToken.mockResolvedValue(
      null as any
    );

    const result = await controller.refreshToken({
      refreshToken: "bad-token",
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid or expired refresh token");
  });

  it("rejects when the token is valid but the user no longer exists", async () => {
    mockedRefreshTokenService.validateRefreshToken.mockResolvedValue(
      42 as any
    );
    mockedUserService.getUser.mockResolvedValue(null as any);

    const result = await controller.refreshToken({
      refreshToken: "valid-token",
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");
  });

  it("issues a new access token and rotates the refresh token on success", async () => {
    mockedRefreshTokenService.validateRefreshToken.mockResolvedValue(
      42 as any
    );
    mockedUserService.getUser.mockResolvedValue({
      id: 42,
      email: "user@example.com",
    } as any);
    mockedRefreshTokenService.rotateRefreshToken.mockResolvedValue(
      "new-refresh-token" as any
    );

    const result = await controller.refreshToken({
      refreshToken: "valid-token",
    } as any);

    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
    expect(result.refreshToken).toBe("new-refresh-token");
  });

  it("fails if rotating the refresh token fails, without issuing a token", async () => {
    mockedRefreshTokenService.validateRefreshToken.mockResolvedValue(
      42 as any
    );
    mockedUserService.getUser.mockResolvedValue({
      id: 42,
      email: "user@example.com",
    } as any);
    mockedRefreshTokenService.rotateRefreshToken.mockResolvedValue(
      null as any
    );

    const result = await controller.refreshToken({
      refreshToken: "valid-token",
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to rotate refresh token");
  });
});

describe("AuthController.getWaiverStatus [LR-017]", () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("needs acceptance when the request has no userId (not authenticated)", async () => {
    const result = await controller.getWaiverStatus({} as any);
    expect(result.success).toBe(false);
    expect(result.waiverInfo.needsAcceptance).toBe(true);
    expect(mockedUserService.getUser).not.toHaveBeenCalled();
  });

  it("needs acceptance when the user record can't be found", async () => {
    mockedUserService.getUser.mockResolvedValue(null as any);
    const result = await controller.getWaiverStatus({ userId: 42 } as any);
    expect(result.success).toBe(false);
    expect(result.waiverInfo.needsAcceptance).toBe(true);
  });

  it("needs acceptance for a user who has never accepted any waiver", async () => {
    mockedUserService.getUser.mockResolvedValue({
      id: 42,
      waiverAcceptedAt: null,
      waiverVersion: null,
    } as any);
    const result = await controller.getWaiverStatus({ userId: 42 } as any);
    expect(result.success).toBe(true);
    expect(result.waiverInfo.needsAcceptance).toBe(true);
    expect(result.waiverInfo.hasAccepted).toBe(false);
    expect(result.waiverInfo.isUpdate).toBe(false);
  });

  it("does not need acceptance for a user on the current waiver version", async () => {
    mockedUserService.getUser.mockResolvedValue({
      id: 42,
      waiverAcceptedAt: new Date(),
      waiverVersion: "1.0",
    } as any);
    const result = await controller.getWaiverStatus({ userId: 42 } as any);
    expect(result.waiverInfo.needsAcceptance).toBe(false);
    expect(result.waiverInfo.hasAccepted).toBe(true);
    expect(result.waiverInfo.isUpdate).toBe(false);
  });

  it("flags an update (not a fresh acceptance) for a user on an old waiver version", async () => {
    mockedUserService.getUser.mockResolvedValue({
      id: 42,
      waiverAcceptedAt: new Date(),
      waiverVersion: "0.9",
    } as any);
    const result = await controller.getWaiverStatus({ userId: 42 } as any);
    expect(result.waiverInfo.needsAcceptance).toBe(true);
    expect(result.waiverInfo.isUpdate).toBe(true);
  });

  it("needs acceptance (fails safe) if the user lookup throws", async () => {
    mockedUserService.getUser.mockRejectedValue(new Error("db down"));
    const result = await controller.getWaiverStatus({ userId: 42 } as any);
    expect(result.success).toBe(false);
    expect(result.waiverInfo.needsAcceptance).toBe(true);
  });
});

describe("AuthController.acceptWaiver [LR-017]", () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects with no version in the request body", async () => {
    const result = await controller.acceptWaiver(
      { userId: 42 } as any,
      {} as any
    );
    expect(result.success).toBe(false);
    expect(mockedUserService.acceptWaiver).not.toHaveBeenCalled();
  });

  it("rejects a version that doesn't match the current waiver version", async () => {
    const result = await controller.acceptWaiver(
      { userId: 42 } as any,
      { version: "0.9" } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid waiver version");
    expect(mockedUserService.acceptWaiver).not.toHaveBeenCalled();
  });

  it("rejects when the request has no userId (not authenticated)", async () => {
    const result = await controller.acceptWaiver(
      {} as any,
      { version: "1.0" } as any
    );
    expect(result.success).toBe(false);
    expect(mockedUserService.acceptWaiver).not.toHaveBeenCalled();
  });

  it("accepts the current version for an authenticated user", async () => {
    mockedUserService.acceptWaiver.mockResolvedValue(undefined as any);
    const result = await controller.acceptWaiver(
      { userId: 42 } as any,
      { version: "1.0" } as any
    );
    expect(result.success).toBe(true);
    expect(mockedUserService.acceptWaiver).toHaveBeenCalledWith(42, "1.0");
  });

  it("returns a failure (not a throw) if persisting the acceptance fails", async () => {
    mockedUserService.acceptWaiver.mockRejectedValue(new Error("db down"));
    const result = await controller.acceptWaiver(
      { userId: 42 } as any,
      { version: "1.0" } as any
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to accept waiver");
  });
});

/**
 * Regression guard for the 2026-09-01 production outage.
 *
 * PR #43 short-circuited `login` for an address with no account: it returned
 * success but minted no code and sent no mail, on the assumption that "the
 * client routes unknown emails to /signup, which creates the user first."
 *
 * That assumption is false for every shipped client. `login-screen.tsx` has
 * been a single merged entry point since 2026-08-02 (Work D §6.1) — it does not
 * call /check-email and does not branch new-vs-returning; every address is
 * POSTed to /auth/login. /auth/signup sits *behind* /verify (the name screen
 * exchanges the onboarding token for the account), so a new user can never
 * reach it. The result was that new signups could not get into the app at all:
 * the OTP screen claimed a code had been sent, none had, and verify answered
 * "That code didn't match" because no auth_codes row existed.
 *
 * These tests pin the contract that actually matters — /login mints AND mails a
 * code regardless of whether the address already has an account. Abuse is
 * capped by otpSendRateLimit on the route, not by refusing unknown addresses.
 */
describe("AuthController.login — unknown emails must still get a code", () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuthService.generateAuthCode.mockResolvedValue("4821" as any);
    mockedEmailService.sendOtpEmail.mockResolvedValue(undefined as any);
  });

  it("mints and mails a code for an address with no account", async () => {
    mockedUserService.getUserByEmail.mockResolvedValue(null as any);

    const result = await controller.login({
      email: "brand-new@example.com",
    } as any);

    expect(result.success).toBe(true);
    // The actual regression: both of these were skipped entirely.
    expect(mockedAuthService.generateAuthCode).toHaveBeenCalledWith(
      "brand-new@example.com"
    );
    expect(mockedEmailService.sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  it("greets a first-time address by its local part", async () => {
    mockedUserService.getUserByEmail.mockResolvedValue(null as any);

    await controller.login({ email: "brand-new@example.com" } as any);

    expect(mockedEmailService.sendOtpEmail).toHaveBeenCalledWith(
      "brand-new@example.com",
      "4821",
      "brand-new"
    );
  });

  it("mints and mails a code for an existing account, greeting them by name", async () => {
    mockedUserService.getUserByEmail.mockResolvedValue({
      id: 7,
      email: "returning@example.com",
      name: "Dana",
    } as any);

    const result = await controller.login({
      email: "returning@example.com",
    } as any);

    expect(result.success).toBe(true);
    expect(mockedEmailService.sendOtpEmail).toHaveBeenCalledWith(
      "returning@example.com",
      "4821",
      "Dana"
    );
  });

  it("responds identically for known and unknown addresses (no enumeration, §4.7)", async () => {
    mockedUserService.getUserByEmail.mockResolvedValue(null as any);
    const unknown = await controller.login({ email: "nobody@example.com" } as any);

    mockedUserService.getUserByEmail.mockResolvedValue({
      id: 7,
      email: "somebody@example.com",
      name: "Dana",
    } as any);
    const known = await controller.login({ email: "somebody@example.com" } as any);

    expect(unknown).toEqual(known);
  });

  it("reports failure instead of a silent success when the mail send throws (§4.6)", async () => {
    mockedUserService.getUserByEmail.mockResolvedValue(null as any);
    mockedEmailService.sendOtpEmail.mockRejectedValue(
      new Error("resend is down") as any
    );

    const result = await controller.login({
      email: "brand-new@example.com",
    } as any);

    // A user who is told "we sent a code" when nothing was sent is the exact
    // shape of the outage this suite exists to prevent.
    expect(result.success).toBe(false);
  });
});
