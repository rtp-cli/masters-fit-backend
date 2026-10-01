import { describe, it, expect } from "@jest/globals";

import {
  AIProvider,
  AI_PROVIDERS,
  resolveEffectiveModel,
} from "@/constants/ai-providers";

/**
 * A retired model is removed from the catalog but stays stored on profiles
 * (2026-10-01: 7 prod profiles still stored claude-sonnet-4-5 after it was
 * dropped). Generation and the AI provider screen must both report the model
 * that actually runs, so they share this one rule.
 */
describe("resolveEffectiveModel", () => {
  const anthropicDefault = AI_PROVIDERS[AIProvider.ANTHROPIC].defaultModel;

  it("keeps a stored model that is still in the catalog", () => {
    expect(
      resolveEffectiveModel(AIProvider.ANTHROPIC, "claude-haiku-4-5-20251001")
    ).toEqual({ model: "claude-haiku-4-5-20251001", isFallback: false });
  });

  it("falls back to the provider default for a retired model", () => {
    expect(
      resolveEffectiveModel(AIProvider.ANTHROPIC, "claude-sonnet-4-5-20250929")
    ).toEqual({ model: anthropicDefault, isFallback: true });
  });

  it("uses the default when nothing is stored", () => {
    expect(resolveEffectiveModel(AIProvider.ANTHROPIC, null)).toEqual({
      model: anthropicDefault,
      isFallback: false,
    });
  });
});
