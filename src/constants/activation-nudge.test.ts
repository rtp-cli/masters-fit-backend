import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import {
  activationNudgeMaxDays,
  activationNudgeMinHours,
  activationStartUrl,
  companyPostalAddress,
  isActivationNudgeEnabled,
  isSuppressedNudgeEmail,
} from "@/constants/activation-nudge";

/**
 * Config for the activation nudge. The rules that separate a nudge from a
 * complaint: the postal-address gate, the lookback clamp that stops the first
 * run after switch-on from mass-mailing history, and the suppression of
 * internal test accounts.
 */
describe("activation nudge config", () => {
  const ENV_KEYS = [
    "ACTIVATION_NUDGE_ENABLED",
    "ACTIVATION_NUDGE_MIN_HOURS",
    "ACTIVATION_NUDGE_MAX_DAYS",
    "ACTIVATION_NUDGE_SUPPRESS",
    "ACTIVATION_START_URL",
    "COMPANY_POSTAL_ADDRESS",
    "ONBOARDING_NUDGE_SUPPRESS",
    "SIGNUP_NOTIFY_SUPPRESS",
    "TEST_ACCOUNT_NEW",
    "TEST_ACCOUNT_EXISTING",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("kill switch", () => {
    it("is off when unset — merging the code mails nobody", () => {
      expect(isActivationNudgeEnabled()).toBe(false);
    });

    it("needs the exact string 'true'", () => {
      process.env.ACTIVATION_NUDGE_ENABLED = "1";
      expect(isActivationNudgeEnabled()).toBe(false);
      process.env.ACTIVATION_NUDGE_ENABLED = "true";
      expect(isActivationNudgeEnabled()).toBe(true);
    });
  });

  describe("postal address gate", () => {
    it("is null when unset, which stops the send", () => {
      expect(companyPostalAddress()).toBeNull();
    });

    it("treats whitespace as unset rather than as an address", () => {
      process.env.COMPANY_POSTAL_ADDRESS = "   ";
      expect(companyPostalAddress()).toBeNull();
    });
  });

  describe("timing window", () => {
    // 24h, not the onboarding nudge's 48h: 6 of the 9 users who ever activated
    // did so within 22 hours of their plan being generated.
    it("defaults to a 24 hour grace period", () => {
      expect(activationNudgeMinHours()).toBe(24);
    });

    it("defaults the lookback to 14 days", () => {
      expect(activationNudgeMaxDays()).toBe(14);
    });

    it("clamps the lookback to 30 days however large the override", () => {
      process.env.ACTIVATION_NUDGE_MAX_DAYS = "3650";
      expect(activationNudgeMaxDays()).toBe(30);
    });

    it("ignores junk and zero overrides", () => {
      process.env.ACTIVATION_NUDGE_MIN_HOURS = "not-a-number";
      expect(activationNudgeMinHours()).toBe(24);
      process.env.ACTIVATION_NUDGE_MIN_HOURS = "0";
      expect(activationNudgeMinHours()).toBe(24);
    });
  });

  describe("suppression", () => {
    it("suppresses a blank or missing address", () => {
      expect(isSuppressedNudgeEmail(null)).toBe(true);
      expect(isSuppressedNudgeEmail(undefined)).toBe(true);
      expect(isSuppressedNudgeEmail("   ")).toBe(true);
    });

    it("suppresses protected accounts", () => {
      expect(isSuppressedNudgeEmail("rtp@mastersfit.ai")).toBe(true);
      expect(isSuppressedNudgeEmail("rtp+demo@mastersfit.ai")).toBe(true);
    });

    // PROTECTED_EMAILS answers "never hard delete" and deliberately leaves the
    // disposable rtp+<tag>@ accounts out. "Safe to delete" is not "safe to
    // email" — without this rule every throwaway test account receives a real
    // customer lifecycle email. Both of these appeared as live candidates
    // against the local database before the rule was added.
    it("suppresses internal plus-addressed test accounts", () => {
      expect(isSuppressedNudgeEmail("rtp+qa01@mastersfit.ai")).toBe(true);
      expect(isSuppressedNudgeEmail("rtp+qatester01@mastersfit.ai")).toBe(true);
      expect(isSuppressedNudgeEmail("rtp+anything-new@mastersfit.ai")).toBe(true);
    });

    it("is case and whitespace insensitive", () => {
      expect(isSuppressedNudgeEmail("  RTP+QA01@MastersFit.ai ")).toBe(true);
    });

    // The rule is scoped to the owner's own mailbox on his own domain — it must
    // not swallow a real customer who happens to plus-address their address.
    it("does not suppress a lookalike on another domain or mailbox", () => {
      expect(isSuppressedNudgeEmail("rtp+qa01@gmail.com")).toBe(false);
      expect(isSuppressedNudgeEmail("someone+tag@mastersfit.ai")).toBe(false);
    });

    it("honours its own env list", () => {
      process.env.ACTIVATION_NUDGE_SUPPRESS = "blocked@example.com";
      expect(isSuppressedNudgeEmail("blocked@example.com")).toBe(true);
    });

    it("inherits the shared suppression lists", () => {
      process.env.SIGNUP_NOTIFY_SUPPRESS = "shared@example.com";
      expect(isSuppressedNudgeEmail("shared@example.com")).toBe(true);
    });

    it("does not suppress an ordinary user", () => {
      expect(isSuppressedNudgeEmail("someone@gmail.com")).toBe(false);
    });
  });

  describe("start url", () => {
    // Never a masters-fit:// scheme — mail clients strip custom schemes.
    it("defaults to the web continue page and strips a trailing slash", () => {
      expect(activationStartUrl()).toBe("https://www.mastersfit.ai/continue");
      process.env.ACTIVATION_START_URL = "https://example.com/go/";
      expect(activationStartUrl()).toBe("https://example.com/go");
    });
  });
});
