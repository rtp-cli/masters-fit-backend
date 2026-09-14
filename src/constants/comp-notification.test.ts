import { describe, it, expect } from "@jest/globals";
import { shouldSendCompEmail } from "@/constants/comp-notification";
import { AccessTier } from "@/constants/access-policy";

/**
 * The comp email is transactional and fires from an ops script a human is
 * running, so the risk isn't spam at scale — it's one surprising email to one
 * real person. These cases are the ones that would produce that.
 */
describe("shouldSendCompEmail", () => {
  const base = {
    noEmail: false,
    revoke: false,
    dryRun: false,
    priorOverride: null as string | null,
    email: "someone@gmail.com",
  };

  it("sends on a real first-time grant", () => {
    expect(shouldSendCompEmail(base)).toBe(true);
  });

  it("does not send when the operator passes --no-email", () => {
    expect(shouldSendCompEmail({ ...base, noEmail: true })).toBe(false);
  });

  it("never sends on revoke", () => {
    // "Your free access was removed" must never be a script side effect.
    expect(shouldSendCompEmail({ ...base, revoke: true })).toBe(false);
  });

  it("does not send on a dry run", () => {
    expect(shouldSendCompEmail({ ...base, dryRun: true })).toBe(false);
  });

  it("does not send when they were ALREADY comped", () => {
    // This is what makes the script safe to re-run — no second thank-you.
    expect(
      shouldSendCompEmail({ ...base, priorOverride: AccessTier.COMPLIMENTARY })
    ).toBe(false);
  });

  it("does send when upgrading from a different override", () => {
    expect(
      shouldSendCompEmail({ ...base, priorOverride: AccessTier.BYPASS })
    ).toBe(true);
  });

  it("does not send to protected internal accounts", () => {
    expect(
      shouldSendCompEmail({ ...base, email: "rtp+demo@mastersfit.ai" })
    ).toBe(false);
  });

  it("matches protected accounts regardless of case or padding", () => {
    expect(
      shouldSendCompEmail({ ...base, email: "  RTP+DEMO@MastersFit.ai  " })
    ).toBe(false);
  });

  it("does not send with no address", () => {
    for (const email of [null, undefined, "", "   "]) {
      expect(shouldSendCompEmail({ ...base, email })).toBe(false);
    }
  });
});
