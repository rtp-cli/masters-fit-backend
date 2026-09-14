import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  isOnboardingNudgeEnabled,
  isSuppressedNudgeEmail,
  onboardingNudgeMinHours,
  onboardingNudgeMaxDays,
  companyPostalAddress,
  onboardingContinueUrl,
} from "@/constants/onboarding-nudge";

/**
 * Config for the first user-facing lifecycle email. Two rules here are the
 * difference between a nudge and a complaint: the postal-address gate, and the
 * lookback clamp that stops the first run after switch-on from mass-mailing
 * everyone who ever stalled.
 */
describe("onboarding nudge config", () => {
  const ENV_KEYS = [
    "ONBOARDING_NUDGE_ENABLED",
    "ONBOARDING_NUDGE_MIN_HOURS",
    "ONBOARDING_NUDGE_MAX_DAYS",
    "ONBOARDING_NUDGE_SUPPRESS",
    "COMPANY_POSTAL_ADDRESS",
    "ONBOARDING_CONTINUE_URL",
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
      expect(isOnboardingNudgeEnabled()).toBe(false);
    });

    it("needs the exact string 'true'", () => {
      process.env.ONBOARDING_NUDGE_ENABLED = "1";
      expect(isOnboardingNudgeEnabled()).toBe(false);
      process.env.ONBOARDING_NUDGE_ENABLED = "true";
      expect(isOnboardingNudgeEnabled()).toBe(true);
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

    it("returns a configured address trimmed", () => {
      process.env.COMPANY_POSTAL_ADDRESS = "  123 Main St, Omaha NE  ";
      expect(companyPostalAddress()).toBe("123 Main St, Omaha NE");
    });
  });

  describe("timing window", () => {
    it("defaults to a 48 hour grace period", () => {
      expect(onboardingNudgeMinHours()).toBe(48);
    });

    it("defaults the lookback to 14 days", () => {
      expect(onboardingNudgeMaxDays()).toBe(14);
    });

    it("clamps the lookback to 30 days however large the override", () => {
      // Without this, flipping the flag on would mail every stalled signup in
      // history at once — the single worst first impression available.
      process.env.ONBOARDING_NUDGE_MAX_DAYS = "3650";
      expect(onboardingNudgeMaxDays()).toBe(30);
    });

    it("ignores junk and zero overrides", () => {
      process.env.ONBOARDING_NUDGE_MIN_HOURS = "not-a-number";
      expect(onboardingNudgeMinHours()).toBe(48);
      process.env.ONBOARDING_NUDGE_MAX_DAYS = "0";
      expect(onboardingNudgeMaxDays()).toBe(14);
    });
  });

  describe("suppression", () => {
    it("suppresses a blank or missing address", () => {
      expect(isSuppressedNudgeEmail(undefined)).toBe(true);
      expect(isSuppressedNudgeEmail("")).toBe(true);
      expect(isSuppressedNudgeEmail("   ")).toBe(true);
    });

    it("honours its own env list", () => {
      process.env.ONBOARDING_NUDGE_SUPPRESS = "nope@example.com";
      expect(isSuppressedNudgeEmail("NOPE@example.com")).toBe(true);
    });

    it("inherits the signup-notification suppression list", () => {
      // One place to say "never mail this account", shared across features.
      process.env.SIGNUP_NOTIFY_SUPPRESS = "shared@example.com";
      expect(isSuppressedNudgeEmail("shared@example.com")).toBe(true);
    });

    it("does not suppress an ordinary user", () => {
      expect(isSuppressedNudgeEmail("someone@gmail.com")).toBe(false);
    });
  });

  describe("continue url", () => {
    it("is a web url, never a custom scheme", () => {
      // masters-fit:// links are stripped by mail clients — the whole reason
      // this indirection exists.
      expect(onboardingContinueUrl()).toMatch(/^https:\/\//);
    });

    it("strips a trailing slash so callers can append safely", () => {
      process.env.ONBOARDING_CONTINUE_URL = "https://example.com/continue/";
      expect(onboardingContinueUrl()).toBe("https://example.com/continue");
    });
  });
});
