import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  isSignupNotifyEnabled,
  isSuppressedSignupEmail,
  signupNotifyRecipients,
  stalledSignupMaxDays,
  stalledSignupMinHours,
} from "@/constants/signup-notifications";

/**
 * Config for the internal signup notifications. The suppression rule is the
 * only thing standing between an ops inbox and a notification every time the
 * demo user is reseeded, so it gets the most attention here.
 */
describe("signup notification config", () => {
  const ENV_KEYS = [
    "SIGNUP_NOTIFY_ENABLED",
    "SIGNUP_NOTIFY_EMAIL",
    "SIGNUP_NOTIFY_SUPPRESS",
    "TEST_ACCOUNT_NEW",
    "TEST_ACCOUNT_EXISTING",
    "STALLED_SIGNUP_MIN_HOURS",
    "STALLED_SIGNUP_MAX_DAYS",
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
    it("is OFF when the env var is unset — the feature ships inert", () => {
      expect(isSignupNotifyEnabled()).toBe(false);
    });

    it("is off for any value other than the exact string 'true'", () => {
      for (const value of ["", "false", "1", "yes", "TRUE", "True"]) {
        process.env.SIGNUP_NOTIFY_ENABLED = value;
        expect(isSignupNotifyEnabled()).toBe(false);
      }
    });

    it("is on for 'true'", () => {
      process.env.SIGNUP_NOTIFY_ENABLED = "true";
      expect(isSignupNotifyEnabled()).toBe(true);
    });

    it("is read at call time, so flipping the env takes effect immediately", () => {
      expect(isSignupNotifyEnabled()).toBe(false);
      process.env.SIGNUP_NOTIFY_ENABLED = "true";
      expect(isSignupNotifyEnabled()).toBe(true);
      delete process.env.SIGNUP_NOTIFY_ENABLED;
      expect(isSignupNotifyEnabled()).toBe(false);
    });
  });

  describe("recipients", () => {
    it("defaults to the owner", () => {
      expect(signupNotifyRecipients()).toEqual(["rtp@mastersfit.ai"]);
    });

    it("splits a comma-separated list and trims whitespace", () => {
      process.env.SIGNUP_NOTIFY_EMAIL = " a@example.com , b@example.com ";
      expect(signupNotifyRecipients()).toEqual(["a@example.com", "b@example.com"]);
    });

    it("drops empty entries from a trailing comma", () => {
      process.env.SIGNUP_NOTIFY_EMAIL = "a@example.com,,";
      expect(signupNotifyRecipients()).toEqual(["a@example.com"]);
    });
  });

  describe("suppression", () => {
    it("suppresses the recurring internal accounts", () => {
      // Straight from PROTECTED_EMAILS — the owner plus the accounts that get
      // recreated on a schedule (Dave's 6am reseed) or reused constantly.
      for (const email of [
        "rtp@mastersfit.ai",
        "rtp+demo@mastersfit.ai",
        "rtp+qa@mastersfit.ai",
        "rtp+review@mastersfit.ai",
        "rtp+applereview@mastersfit.ai",
      ]) {
        expect(isSuppressedSignupEmail(email)).toBe(true);
      }
    });

    it("does NOT suppress a disposable rtp+<n>@ test account", () => {
      // These are how the feature gets tested end-to-end on the simulator. A
      // domain-wide rule used to swallow them, which made a real test look
      // like a broken feature.
      expect(isSuppressedSignupEmail("rtp+9912@mastersfit.ai")).toBe(false);
      expect(isSuppressedSignupEmail("rtp+1@mastersfit.ai")).toBe(false);
    });

    it("does NOT suppress a real tester", () => {
      for (const email of [
        "jane.doe@gmail.com",
        "marcus@example.com",
        "rtp@notmastersfit.ai",
      ]) {
        expect(isSuppressedSignupEmail(email)).toBe(false);
      }
    });

    it("ignores case and surrounding whitespace", () => {
      expect(isSuppressedSignupEmail("  RTP+Demo@MastersFit.AI ")).toBe(true);
      expect(isSuppressedSignupEmail(" Jane@Gmail.com ")).toBe(false);
    });

    it("suppresses the auth bypass test accounts", () => {
      process.env.TEST_ACCOUNT_NEW = "new-tester@example.com";
      process.env.TEST_ACCOUNT_EXISTING = "existing-tester@example.com";
      expect(isSuppressedSignupEmail("new-tester@example.com")).toBe(true);
      expect(isSuppressedSignupEmail("existing-tester@example.com")).toBe(true);
      expect(isSuppressedSignupEmail("other@example.com")).toBe(false);
    });

    it("suppresses anything in the ad-hoc env list", () => {
      process.env.SIGNUP_NOTIFY_SUPPRESS = "loud@example.com, noisy@example.com";
      expect(isSuppressedSignupEmail("noisy@example.com")).toBe(true);
      expect(isSuppressedSignupEmail("quiet@example.com")).toBe(false);
    });

    it("treats a missing or blank address as suppressed", () => {
      expect(isSuppressedSignupEmail(null)).toBe(true);
      expect(isSuppressedSignupEmail(undefined)).toBe(true);
      expect(isSuppressedSignupEmail("   ")).toBe(true);
    });
  });

  describe("digest window", () => {
    it("defaults to a 24-hour grace period and a 30-day tail", () => {
      expect(stalledSignupMinHours()).toBe(24);
      // 30 days is not arbitrary: expired refresh tokens are deleted on a
      // 30-day TTL, and they are what tells the two groups apart.
      expect(stalledSignupMaxDays()).toBe(30);
    });

    it("accepts env overrides", () => {
      process.env.STALLED_SIGNUP_MIN_HOURS = "48";
      process.env.STALLED_SIGNUP_MAX_DAYS = "14";
      expect(stalledSignupMinHours()).toBe(48);
      expect(stalledSignupMaxDays()).toBe(14);
    });

    it("falls back on junk or non-positive values rather than producing an absurd window", () => {
      for (const junk of ["", "abc", "0", "-5"]) {
        process.env.STALLED_SIGNUP_MIN_HOURS = junk;
        process.env.STALLED_SIGNUP_MAX_DAYS = junk;
        expect(stalledSignupMinHours()).toBe(24);
        expect(stalledSignupMaxDays()).toBe(30);
      }
    });
  });
});
