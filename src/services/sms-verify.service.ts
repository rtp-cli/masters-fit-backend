import { logger } from "@/utils/logger";
import { maskPhone } from "@/utils/phone.utils";

/**
 * SMS one-time codes via Twilio Verify.
 *
 * Twilio Verify generates, texts and checks the code itself, so phone sign-in
 * never touches our auth_codes table. It also carries Twilio's pre-registered
 * senders — no A2P 10DLC brand/campaign registration is needed for
 * verification-only traffic — and Fraud Guard (SMS-pumping protection) at no
 * extra cost. ~$0.058 per successful US verification (Oct 2026).
 *
 * Called over plain REST with fetch rather than the `twilio` npm package: two
 * endpoints don't justify a large dependency.
 *
 * Service setup (Twilio console → Verify → Services): code length 4 (the app's
 * code screen is 4 boxes), Fraud Guard ON, Geo permissions US + Canada only.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID.
 */

export type SmsCheckResult = "VALID" | "INVALID_CODE" | "EXPIRED_CODE" | "CODE_EXHAUSTED";

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("SMS sign-in is not configured (TWILIO_* env vars unset)");
    this.name = "SmsNotConfiguredError";
  }
}

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";

function config(): { accountSid: string; authToken: string; serviceSid: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

/**
 * Test numbers that skip Twilio and accept TEST_ACCOUNT_OTP (default "1234").
 * Gated on the SAME switch as the email test accounts (TEST_ACCOUNTS_ENABLED),
 * so production — where that switch is off — never honours a fixed code.
 * TEST_PHONE_NUMBERS is a comma list of E.164 numbers; use 555-01XX numbers
 * (reserved for fiction, never assigned) e.g. +13125550100.
 */
export function isTestPhone(phone: string): boolean {
  if (process.env.TEST_ACCOUNTS_ENABLED !== "true") return false;
  return (process.env.TEST_PHONE_NUMBERS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .includes(phone);
}

function testOtp(): string {
  return process.env.TEST_ACCOUNT_OTP || "1234";
}

async function twilioPost(
  path: string,
  body: Record<string, string>
): Promise<{ status: number; json: any }> {
  const cfg = config();
  if (!cfg) throw new SmsNotConfiguredError();
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
  const response = await fetch(`${VERIFY_BASE}/${cfg.serviceSid}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

export class SmsVerifyService {
  /** True when sign-in texts can actually be sent (or a test number is used). */
  isConfigured(): boolean {
    return config() !== null;
  }

  /**
   * Text a code to `phone` (E.164). Throws on any failure so the caller can
   * tell the user the code did NOT go out, rather than leaving them waiting.
   */
  async sendCode(phone: string): Promise<void> {
    if (isTestPhone(phone)) {
      logger.info("SMS test number — code not sent", {
        operation: "smsSendCode",
        metadata: { phone: maskPhone(phone) },
      });
      return;
    }

    const { status, json } = await twilioPost("Verifications", {
      To: phone,
      Channel: "sms",
    });
    if (status >= 200 && status < 300) return;

    logger.error("Twilio Verify send failed", new Error(json?.message ?? `HTTP ${status}`), {
      operation: "smsSendCode",
      metadata: { phone: maskPhone(phone), status, twilioCode: json?.code },
    });
    throw new Error("SMS send failed");
  }

  /**
   * Check a code. Maps Twilio's answers onto the same verdicts the email path
   * returns, so the app's code screen handles both identically:
   *   approved → VALID; pending → INVALID_CODE;
   *   404 (expired, already used, or never sent) → EXPIRED_CODE;
   *   429 / 60202 (max check attempts) → CODE_EXHAUSTED.
   */
  async checkCode(phone: string, code: string): Promise<SmsCheckResult> {
    if (isTestPhone(phone)) {
      return code === testOtp() ? "VALID" : "INVALID_CODE";
    }

    const { status, json } = await twilioPost("VerificationCheck", {
      To: phone,
      Code: code,
    });

    if (status >= 200 && status < 300) {
      return json?.status === "approved" ? "VALID" : "INVALID_CODE";
    }
    if (status === 404) return "EXPIRED_CODE";
    if (status === 429 || json?.code === 60202) return "CODE_EXHAUSTED";

    logger.error("Twilio Verify check failed", new Error(json?.message ?? `HTTP ${status}`), {
      operation: "smsCheckCode",
      metadata: { phone: maskPhone(phone), status, twilioCode: json?.code },
    });
    throw new Error("SMS check failed");
  }
}

export const smsVerifyService = new SmsVerifyService();
