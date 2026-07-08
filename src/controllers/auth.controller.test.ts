import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { AuthController } from "@/controllers/auth.controller";
import {
  userService,
  refreshTokenService,
  profileService,
} from "@/services";

jest.mock("@/services", () => ({
  userService: { getUser: jest.fn() },
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
