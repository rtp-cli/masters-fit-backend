import { describe, it, expect } from "@jest/globals";

import {
  AccessTier,
  Capability,
  can,
} from "@/constants/access-policy";
import { requiresPlusMessageFor, PAYWALL_COPY } from "@/constants/paywall-copy";

/**
 * [LR-069] Adding a second session to a day already trained is PLUS-only.
 *
 * The distinction that matters: ADJUST_DAY — changing today's workout — stays
 * FREE (metered by the three lifetime day-adjustments). Only asking for an
 * EXTRA session on top is gated, because that is the upgrade reason and
 * because an uncapped free path would spend a scarce lifetime allowance on it.
 */
describe("ADD_BONUS_SESSION capability", () => {
  it("is not granted to free", () => {
    expect(can(AccessTier.FREE, Capability.ADD_BONUS_SESSION)).toBe(false);
  });

  it("is granted to PLUS, complimentary and bypass", () => {
    expect(can(AccessTier.PLUS, Capability.ADD_BONUS_SESSION)).toBe(true);
    expect(can(AccessTier.COMPLIMENTARY, Capability.ADD_BONUS_SESSION)).toBe(
      true,
    );
    expect(can(AccessTier.BYPASS, Capability.ADD_BONUS_SESSION)).toBe(true);
  });

  // The load-bearing distinction. Gating the bonus must NOT take away the
  // free tier's ability to change today's workout, or to fill an empty date.
  it("leaves ADJUST_DAY free", () => {
    expect(can(AccessTier.FREE, Capability.ADJUST_DAY)).toBe(true);
  });

  it("leaves the other free capabilities alone", () => {
    expect(can(AccessTier.FREE, Capability.GENERATE_INITIAL_PLAN)).toBe(true);
    expect(can(AccessTier.FREE, Capability.ADJUST_WEEK)).toBe(true);
  });

  // The paywall names what the user was about to do rather than falling
  // through to the generic message.
  it("has its own paywall copy", () => {
    const message = requiresPlusMessageFor(Capability.ADD_BONUS_SESSION);
    expect(message).toBe(PAYWALL_COPY.REQUIRES_PLUS_BONUS_SESSION);
    expect(message).not.toBe(PAYWALL_COPY.REQUIRES_PLUS_GENERIC);
  });
});
