import { describe, it, expect } from "@jest/globals";
import { buildClaudePrompt } from "@/utils/prompt-generator";
import { Profile } from "@/models";

// Matches a real DB row with every optional column unset (null, not
// omitted) — the actual shape LR-053's bug hit, not just a TS-convenience
// partial object.
const minimalProfile: Profile = {
  id: 1,
  userId: 1,
  age: null,
  height: null,
  weight: null,
  gender: null,
  goals: null,
  limitations: null,
  fitnessLevel: null,
  environment: null,
  equipment: null,
  otherEquipment: null,
  preferredStyles: null,
  availableDays: null,
  workoutDuration: null,
  intensityLevel: null,
  medicalNotes: null,
  includeWarmup: null,
  includeCooldown: null,
  aiProvider: null,
  aiModel: null,
  timezone: null,
  updatedAt: null,
};

describe("buildClaudePrompt [LR-053]", () => {
  it("does not throw when availableDays/workoutDuration/environment/preferredStyles are all null", () => {
    expect(() => buildClaudePrompt(minimalProfile, [])).not.toThrow();
  });

  it("defaults workoutDuration to 30 when null, matching the fan-out path's default", () => {
    const prompt = buildClaudePrompt(minimalProfile, []);
    expect(prompt).toContain("30-minute");
    expect(prompt).toContain("30 minutes per session");
  });

  it("shows 'not specified' for a null environment instead of the literal word 'undefined'", () => {
    const prompt = buildClaudePrompt(minimalProfile, []);
    expect(prompt).toContain("Environment: not specified");
    expect(prompt).not.toContain("Environment: undefined");
    expect(prompt).not.toContain("Environment: null");
  });

  it("defaults availableDays to a 7-day week when null", () => {
    const prompt = buildClaudePrompt(minimalProfile, []);
    expect(prompt).toContain("ALL 7 days");
  });

  it("still uses the profile's real values when they ARE present (no regression)", () => {
    const fullProfile: Profile = {
      ...minimalProfile,
      availableDays: ["monday", "wednesday", "friday"] as any,
      workoutDuration: 45,
      environment: "home_gym" as any,
      preferredStyles: ["strength"] as any,
    };

    const prompt = buildClaudePrompt(fullProfile, []);
    expect(prompt).toContain("45-minute");
    expect(prompt).toContain("45 minutes per session");
    expect(prompt).toContain("Environment: home_gym");
    expect(prompt).toContain("ALL 3 days");
  });
});
