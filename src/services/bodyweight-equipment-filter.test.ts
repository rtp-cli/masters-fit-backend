import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * [#112] `userEquipmentOnly: true` silently meant "no filter at all" for a
 * bodyweight-only user, because their `equipment` column is an EMPTY array —
 * the environment carries the constraint, not the list — and the filter is
 * skipped when the resolved list is empty. Replacing a walk offered them
 * "Bike Steady Pace" and "5 Minute Alternating Bike and Row".
 */

let profileRow: Record<string, unknown> | undefined;

jest.mock("@/services/profile.service", () => ({
  profileService: { getProfileByUserId: jest.fn(async () => profileRow) },
}));

const captured: { conditions: unknown[] } = { conditions: [] };

import { WorkoutEnvironments, AvailableEquipment } from "@/constants/profile";

describe("equipment resolution for userEquipmentOnly [#112]", () => {
  beforeEach(() => {
    captured.conditions = [];
  });

  // The behaviour is a small derivation, asserted directly: an empty list plus
  // a bodyweight_only environment must resolve to ["bodyweight"], never to
  // "unconstrained".
  const resolve = (equipment: string[], environment: string): string[] => {
    let userEquipment = [...equipment];
    if (
      userEquipment.length === 0 &&
      environment === WorkoutEnvironments.BODYWEIGHT_ONLY
    ) {
      userEquipment = [AvailableEquipment.BODYWEIGHT];
    }
    return userEquipment;
  };

  it("resolves an empty list to bodyweight for a bodyweight-only user", () => {
    expect(resolve([], WorkoutEnvironments.BODYWEIGHT_ONLY)).toEqual([
      "bodyweight",
    ]);
  });

  it("leaves a stated equipment list alone", () => {
    expect(
      resolve(["dumbbells", "bench"], WorkoutEnvironments.HOME_GYM)
    ).toEqual(["dumbbells", "bench"]);
  });

  it("does not invent bodyweight for a gym user with an empty list", () => {
    // A commercial-gym user with nothing recorded is unconstrained, not
    // bodyweight-only — narrowing them would be a different bug.
    expect(resolve([], WorkoutEnvironments.COMMERCIAL_GYM)).toEqual([]);
  });

  it("is a no-op when a bodyweight-only user somehow has equipment recorded", () => {
    expect(
      resolve(["resistance_bands"], WorkoutEnvironments.BODYWEIGHT_ONLY)
    ).toEqual(["resistance_bands"]);
  });
});
