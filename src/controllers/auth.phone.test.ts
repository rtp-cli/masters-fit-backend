import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import jwt from "jsonwebtoken";

import { AuthController } from "@/controllers/auth.controller";
import { authService, refreshTokenService, userService } from "@/services";
import { emailService } from "@/services/email.service";
import {
  SmsNotConfiguredError,
  smsVerifyService,
} from "@/services/sms-verify.service";

jest.mock("@/services", () => ({
  userService: {
    getUser: jest.fn(),
    getUserByEmail: jest.fn(),
    getUserByPhone: jest.fn(),
    createUser: jest.fn(),
    attachContact: jest.fn(),
  },
  authService: {
    generateAuthCode: jest.fn(),
    verifyCode: jest.fn(),
    invalidateAuthCode: jest.fn(),
  },
  refreshTokenService: { createRefreshToken: jest.fn() },
  profileService: { updateTimezone: jest.fn(async () => undefined) },
}));

jest.mock("@/services/email.service", () => ({
  emailService: { sendOtpEmail: jest.fn(async () => undefined) },
}));

jest.mock("@/services/sms-verify.service", () => {
  class SmsNotConfiguredError extends Error {}
  return {
    SmsNotConfiguredError,
    smsVerifyService: { sendCode: jest.fn(), checkCode: jest.fn() },
  };
});

const mockedUser = jest.mocked(userService);
const mockedAuth = jest.mocked(authService);
const mockedEmail = jest.mocked(emailService);
const mockedSms = jest.mocked(smsVerifyService);
const mockedRefresh = jest.mocked(refreshTokenService);

const PHONE = "+13125550123";
const existingUser = {
  id: 7,
  uuid: "u-7",
  email: null,
  phone: PHONE,
  name: "Dana",
  needsOnboarding: false,
  waiverAcceptedAt: null,
  waiverVersion: null,
  themeMode: "auto",
  colorTheme: "original",
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "test-secret";
  mockedSms.sendCode.mockResolvedValue(undefined as any);
  mockedRefresh.createRefreshToken.mockResolvedValue("refresh-1" as any);
});

describe("AuthController.startPhoneLogin", () => {
  const controller = new AuthController();

  it("texts a code to the normalized number", async () => {
    const result = await controller.startPhoneLogin({ phone: "(312) 555-0123" });
    expect(result.success).toBe(true);
    expect(mockedSms.sendCode).toHaveBeenCalledWith(PHONE);
  });

  it("refuses a non-+1 number without sending anything", async () => {
    const result = await controller.startPhoneLogin({ phone: "+44 20 7946 0958" });
    expect(result).toMatchObject({ success: false, errorCode: "INVALID_PHONE" });
    expect(mockedSms.sendCode).not.toHaveBeenCalled();
  });

  it("answers identically whether or not the number has an account (no enumeration)", async () => {
    mockedUser.getUserByPhone.mockResolvedValue(undefined as any);
    const unknown = await controller.startPhoneLogin({ phone: "3125550123" });
    mockedUser.getUserByPhone.mockResolvedValue(existingUser);
    const known = await controller.startPhoneLogin({ phone: "3125550123" });
    expect(unknown).toEqual(known);
  });

  it("points the user back to email when Twilio is not configured", async () => {
    mockedSms.sendCode.mockRejectedValue(new SmsNotConfiguredError() as any);
    const result = await controller.startPhoneLogin({ phone: "3125550123" });
    expect(result).toMatchObject({ success: false, errorCode: "SMS_UNAVAILABLE" });
  });

  it("reports a send failure instead of a silent success", async () => {
    mockedSms.sendCode.mockRejectedValue(new Error("twilio down") as any);
    const result = await controller.startPhoneLogin({ phone: "3125550123" });
    expect(result.success).toBe(false);
  });
});

describe("AuthController.verifyPhoneLogin", () => {
  const controller = new AuthController();

  it("gives a returning number a full session", async () => {
    mockedSms.checkCode.mockResolvedValue("VALID" as any);
    mockedUser.getUserByPhone.mockResolvedValue(existingUser);

    const result = await controller.verifyPhoneLogin({ phone: "3125550123", code: "1234" });

    expect(result.success).toBe(true);
    expect(result.user).toMatchObject({ id: 7, phone: PHONE, email: null });
    expect(result.refreshToken).toBe("refresh-1");
  });

  it("gives a new number a 1-hour onboarding token carrying the phone", async () => {
    mockedSms.checkCode.mockResolvedValue("VALID" as any);
    mockedUser.getUserByPhone.mockResolvedValue(undefined as any);

    const result = await controller.verifyPhoneLogin({ phone: "3125550123", code: "1234" });

    expect(result).toMatchObject({ success: true, needsOnboarding: true, phone: PHONE });
    expect(result.user).toBeUndefined();
    const decoded = jwt.verify(result.token!, "test-secret") as any;
    expect(decoded).toMatchObject({ phone: PHONE, isOnboarding: true });
    expect(decoded.id).toBeUndefined();
  });

  it.each([
    ["INVALID_CODE"],
    ["EXPIRED_CODE"],
    ["CODE_EXHAUSTED"],
  ])("maps a %s check onto the same errorCode the email path uses", async (status) => {
    mockedSms.checkCode.mockResolvedValue(status as any);
    const result = await controller.verifyPhoneLogin({ phone: "3125550123", code: "1234" });
    expect(result).toMatchObject({ success: false, errorCode: status });
  });

  it("rejects a malformed code without calling Twilio", async () => {
    const result = await controller.verifyPhoneLogin({ phone: "3125550123", code: "12a4" });
    expect(result.success).toBe(false);
    expect(mockedSms.checkCode).not.toHaveBeenCalled();
  });
});

describe("AuthController.signup — phone onboarding token", () => {
  const controller = new AuthController();

  it("creates a phone-only account from the token, ignoring any body email", async () => {
    const token = jwt.sign({ phone: PHONE, isOnboarding: true }, "test-secret");
    mockedUser.getUserByPhone.mockResolvedValue(undefined as any);
    mockedUser.createUser.mockResolvedValue({ ...existingUser, needsOnboarding: true } as any);

    const result = await controller.signup(
      { headers: { authorization: `Bearer ${token}` } },
      { name: "Dana", email: "attacker@example.com" } as any
    );

    expect(mockedUser.createUser).toHaveBeenCalledWith({ phone: PHONE, name: "Dana" });
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
  });
});

describe("AuthController add-contact (Settings)", () => {
  const controller = new AuthController();

  it("refuses to text a number that belongs to another account", async () => {
    mockedUser.getUserByPhone.mockResolvedValue({ ...existingUser, id: 99 } as any);
    const result = await controller.startAddContact(7, { phone: "3125550123" });
    expect(result).toMatchObject({ success: false, errorCode: "TAKEN" });
    expect(mockedSms.sendCode).not.toHaveBeenCalled();
  });

  it("emails a code to a new address for a phone-only user", async () => {
    mockedUser.getUserByEmail.mockResolvedValue(undefined as any);
    mockedUser.getUser.mockResolvedValue(existingUser);
    mockedAuth.generateAuthCode.mockResolvedValue("4821" as any);

    const result = await controller.startAddContact(7, { email: "dana@example.com" });

    expect(result.success).toBe(true);
    expect(mockedEmail.sendOtpEmail).toHaveBeenCalledWith("dana@example.com", "4821", "Dana");
  });

  it("attaches a verified email and returns the updated user", async () => {
    mockedAuth.verifyCode.mockResolvedValue({ status: "VALID", authCode: {} } as any);
    mockedUser.attachContact.mockResolvedValue({
      status: "ok",
      user: { ...existingUser, email: "dana@example.com" },
    } as any);

    const result = await controller.verifyAddContact(7, {
      email: "dana@example.com",
      code: "4821",
    });

    expect(mockedUser.attachContact).toHaveBeenCalledWith(7, { email: "dana@example.com" });
    expect(result.user).toMatchObject({ email: "dana@example.com", phone: PHONE });
  });

  it("attaches a verified phone", async () => {
    mockedSms.checkCode.mockResolvedValue("VALID" as any);
    mockedUser.attachContact.mockResolvedValue({ status: "ok", user: existingUser } as any);

    const result = await controller.verifyAddContact(7, { phone: "3125550123", code: "1234" });

    expect(mockedUser.attachContact).toHaveBeenCalledWith(7, { phone: PHONE });
    expect(result.success).toBe(true);
  });

  it("does not attach anything when the code is wrong", async () => {
    mockedSms.checkCode.mockResolvedValue("INVALID_CODE" as any);
    const result = await controller.verifyAddContact(7, { phone: "3125550123", code: "0000" });
    expect(result).toMatchObject({ success: false, errorCode: "INVALID_CODE" });
    expect(mockedUser.attachContact).not.toHaveBeenCalled();
  });

  it("reports TAKEN when another account claimed it first", async () => {
    mockedSms.checkCode.mockResolvedValue("VALID" as any);
    mockedUser.attachContact.mockResolvedValue({ status: "taken" } as any);
    const result = await controller.verifyAddContact(7, { phone: "3125550123", code: "1234" });
    expect(result).toMatchObject({ success: false, errorCode: "TAKEN" });
  });
});
