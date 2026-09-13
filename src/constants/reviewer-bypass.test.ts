import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  isReviewerBypassCode,
  isReviewerBypassEnabled,
  reviewerBypassCode,
} from "@/constants/reviewer-bypass";

describe("reviewer bypass", () => {
  const original = process.env.REVIEWER_BYPASS_CODE;

  afterEach(() => {
    if (original === undefined) delete process.env.REVIEWER_BYPASS_CODE;
    else process.env.REVIEWER_BYPASS_CODE = original;
  });

  describe("when unset — the fail-closed case", () => {
    beforeEach(() => {
      delete process.env.REVIEWER_BYPASS_CODE;
    });

    it("reports no code and is disabled", () => {
      expect(reviewerBypassCode()).toBeNull();
      expect(isReviewerBypassEnabled()).toBe(false);
    });

    it("rejects every input, including the old hardcoded 9876", () => {
      expect(isReviewerBypassCode("9876")).toBe(false);
      expect(isReviewerBypassCode("")).toBe(false);
      expect(isReviewerBypassCode(undefined)).toBe(false);
    });

    it("treats a blank or whitespace value as unset", () => {
      process.env.REVIEWER_BYPASS_CODE = "   ";
      expect(reviewerBypassCode()).toBeNull();
      expect(isReviewerBypassCode("   ")).toBe(false);
    });
  });

  describe("when set", () => {
    beforeEach(() => {
      process.env.REVIEWER_BYPASS_CODE = "s3cret-code";
    });

    it("accepts an exact match", () => {
      expect(isReviewerBypassCode("s3cret-code")).toBe(true);
      expect(isReviewerBypassEnabled()).toBe(true);
    });

    it("rejects near-misses and the old 9876", () => {
      expect(isReviewerBypassCode("s3cret-cod")).toBe(false);
      expect(isReviewerBypassCode("s3cret-codes")).toBe(false);
      expect(isReviewerBypassCode("S3CRET-CODE")).toBe(false);
      expect(isReviewerBypassCode("9876")).toBe(false);
      expect(isReviewerBypassCode(undefined)).toBe(false);
    });

    it("trims surrounding whitespace in the env value", () => {
      process.env.REVIEWER_BYPASS_CODE = "  padded  ";
      expect(reviewerBypassCode()).toBe("padded");
      expect(isReviewerBypassCode("padded")).toBe(true);
    });

    // Guards the constant-time comparison: a same-length string that differs
    // only in the last character must still be rejected. A short-circuiting
    // === would pass this too, so this is a regression guard on behaviour,
    // not a timing measurement.
    it("rejects a same-length string differing only at the end", () => {
      expect(isReviewerBypassCode("s3cret-codX")).toBe(false);
    });
  });

  it("reads the env at call time, not module load", () => {
    process.env.REVIEWER_BYPASS_CODE = "first";
    expect(isReviewerBypassCode("first")).toBe(true);
    process.env.REVIEWER_BYPASS_CODE = "second";
    expect(isReviewerBypassCode("first")).toBe(false);
    expect(isReviewerBypassCode("second")).toBe(true);
  });
});
