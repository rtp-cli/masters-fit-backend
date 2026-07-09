import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { AuthController } from "@/controllers/auth.controller";
import {
  userService,
  refreshTokenService,
  profileService,
} from "@/services";

jest.mock("@/services", () => ({
  userService: { getUser: jest.fn(), acceptWaiver: jest.fn() },
  authService: {},
  refreshTokenService: {
    validateRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
  },
  profileService: { updateTimezone: jest.fn(async () => undefined) },
}));

const mockedUserService = jest.mocked(userService);
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
