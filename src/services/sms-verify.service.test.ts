import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

import { SmsNotConfiguredError, smsVerifyService } from "@/services/sms-verify.service";

const realFetch = global.fetch;

function mockTwilio(status: number, json: unknown) {
  global.fetch = jest.fn(async () => ({ status, json: async () => json })) as any;
}

describe("smsVerifyService.sendCode", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest";
    delete process.env.TEST_ACCOUNTS_ENABLED;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("resolves when Twilio accepts the send", async () => {
    mockTwilio(201, { status: "pending" });
    await expect(smsVerifyService.sendCode("+13125550123")).resolves.toBeUndefined();
  });

  it("treats a 403 account problem (21608, no compliance profile) as unavailable, not a bad number", async () => {
    mockTwilio(403, { code: 21608, message: "unverified numbers need a compliance profile" });
    await expect(smsVerifyService.sendCode("+13125550123")).rejects.toBeInstanceOf(
      SmsNotConfiguredError
    );
  });

  it("treats other failures as a plain send failure", async () => {
    mockTwilio(400, { code: 60200, message: "Invalid parameter" });
    await expect(smsVerifyService.sendCode("+13125550123")).rejects.not.toBeInstanceOf(
      SmsNotConfiguredError
    );
  });

  it("throws not-configured without calling Twilio when env is unset", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    await expect(smsVerifyService.sendCode("+13125550123")).rejects.toBeInstanceOf(
      SmsNotConfiguredError
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
