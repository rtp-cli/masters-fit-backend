import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * [#109] The replace-suggestion path ran none of the three Tier-1 safety
 * guardrails. Measured on real data: a BEGINNER with ARTHRITIS whose only
 * style is Walking & Movement, tapping Replace on their walk, was offered
 * "Driveway Hill Run", "Box Jump", "Bodyweight Jumping Jacks" and "Burpees".
 *
 * The db and search layers are mocked so this asserts the GUARDRAILS, not
 * retrieval — the filters themselves have their own unit tests.
 */

const ORIGINAL = {
  id: 1760,
  name: "Walking",
  muscleGroups: ["cardio", "quads", "glutes"],
  difficulty: "low",
  equipment: ["bodyweight"],
  hasDemo: true,
  description: null,
};

// A beginner with arthritis whose only style is walking — the real QA profile.
const PROFILE = {
  userId: 1480,
  fitnessLevel: "beginner",
  limitations: ["arthritis"],
  preferredStyles: ["walking_movement"],
};

const CANDIDATES = [
  { id: 1, name: "Burpees", muscleGroups: ["cardio"], difficulty: "high", equipment: ["bodyweight"], hasDemo: true, description: null },
  { id: 2, name: "Box Jump", muscleGroups: ["cardio", "quads"], difficulty: "high", equipment: ["plyo_box"], hasDemo: true, description: null },
  { id: 3, name: "Driveway Hill Run", muscleGroups: ["cardio", "quads"], difficulty: "moderate", equipment: ["bodyweight"], hasDemo: true, description: null },
  { id: 4, name: "Bodyweight Jumping Jacks", muscleGroups: ["cardio"], difficulty: "moderate", equipment: ["bodyweight"], hasDemo: true, description: null },
  { id: 5, name: "Walking in Place", muscleGroups: ["cardio"], difficulty: "low", equipment: ["bodyweight"], hasDemo: true, description: null },
  { id: 6, name: "Brisk Walk", muscleGroups: ["cardio", "quads", "glutes"], difficulty: "moderate", equipment: ["bodyweight"], hasDemo: true, description: null },
  { id: 7, name: "Bike Steady Pace", muscleGroups: ["cardio", "quads"], difficulty: "low", equipment: ["bike"], hasDemo: true, description: null },
];

let profileRow: Record<string, unknown> | undefined = PROFILE;

jest.mock("@/config/database", () => ({
  db: {
    query: {
      exercises: { findFirst: jest.fn(async () => ORIGINAL) },
      profiles: { findFirst: jest.fn(async () => profileRow) },
    },
  },
  pool: { query: jest.fn() },
}));

jest.mock("@/services/search.service", () => ({
  searchService: {
    searchExercisesWithFilters: jest.fn(async () => ({ exercises: CANDIDATES })),
  },
}));

import { exerciseExclusionService } from "@/services/exercise-exclusion.service";

const namesFor = async () =>
  (await exerciseExclusionService.rankReplacements(1480, 1760, 20)).map((c) => c.name);

describe("rankReplacements safety guardrails [#109]", () => {
  beforeEach(() => {
    profileRow = PROFILE;
  });

  it("never offers a movement the beginner guardrail bans", async () => {
    const names = await namesFor();
    expect(names).not.toContain("Burpees");
    expect(names).not.toContain("Box Jump");
  });

  it("never offers a contraindicated movement for the user's limitations", async () => {
    // arthritis hard-bans box jumps (added after prod gave them to a
    // double-knee-replacement user).
    expect(await namesFor()).not.toContain("Box Jump");
  });

  it("never offers running or in-place cardio to a walking-only user", async () => {
    const names = await namesFor();
    expect(names).not.toContain("Driveway Hill Run");
    expect(names).not.toContain("Bodyweight Jumping Jacks");
    expect(names).not.toContain("Walking in Place");
  });

  it("still offers the sensible replacements", async () => {
    const names = await namesFor();
    expect(names).toContain("Brisk Walk");
    expect(names).toContain("Bike Steady Pace");
  });

  it("leaves the pool unconstrained when no profile can be loaded", async () => {
    // A data hiccup must not empty the replace list; matches the stance
    // fitness-level-validation documents for a null fitnessLevel.
    profileRow = undefined;
    expect((await namesFor()).length).toBe(CANDIDATES.length);
  });
});
