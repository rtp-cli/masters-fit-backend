import { describe, it, expect } from "@jest/globals";
import { DEFAULT_FANOUT_MODEL, resolveFanoutModels } from "@/utils/model-canary";

const CANARY = "claude-haiku-5-5";

describe("resolveFanoutModels (model canary)", () => {
  it("runs the incumbent when nothing is configured", () => {
    expect(resolveFanoutModels(3, {})).toEqual({
      planningModel: DEFAULT_FANOUT_MODEL,
      dayModel: DEFAULT_FANOUT_MODEL,
      isCanary: false,
    });
  });

  it("gives allowlisted users the canary model for planning AND day calls", () => {
    const env = { MODEL_CANARY_USER_IDS: "3, 41", FANOUT_CANARY_MODEL: CANARY };
    expect(resolveFanoutModels(41, env)).toEqual({
      planningModel: CANARY,
      dayModel: CANARY,
      isCanary: true,
    });
  });

  it("keeps everyone else on the incumbent", () => {
    const env = { MODEL_CANARY_USER_IDS: "3,41", FANOUT_CANARY_MODEL: CANARY };
    expect(resolveFanoutModels(55, env).isCanary).toBe(false);
    expect(resolveFanoutModels(55, env).dayModel).toBe(DEFAULT_FANOUT_MODEL);
  });

  it("is fail-closed: a list with no canary model, or a model with no list, does nothing", () => {
    expect(resolveFanoutModels(3, { MODEL_CANARY_USER_IDS: "3" }).isCanary).toBe(false);
    expect(resolveFanoutModels(3, { FANOUT_CANARY_MODEL: CANARY }).isCanary).toBe(false);
    expect(
      resolveFanoutModels(3, { MODEL_CANARY_USER_IDS: "abc,,0", FANOUT_CANARY_MODEL: CANARY })
        .isCanary
    ).toBe(false);
  });

  it("falls back to the incumbent (and flags it) on an unregistered canary model", () => {
    const result = resolveFanoutModels(3, {
      MODEL_CANARY_USER_IDS: "3",
      FANOUT_CANARY_MODEL: "claude-haiku-9-typo",
    });
    expect(result.isCanary).toBe(false);
    expect(result.dayModel).toBe(DEFAULT_FANOUT_MODEL);
    expect(result.misconfiguredCanaryModel).toBe("claude-haiku-9-typo");
  });

  it("still honors the global FANOUT_*_MODEL overrides for non-canary users", () => {
    const env = { FANOUT_PLANNING_MODEL: "claude-sonnet-5", FANOUT_DAY_MODEL: CANARY };
    expect(resolveFanoutModels(3, env)).toEqual({
      planningModel: "claude-sonnet-5",
      dayModel: CANARY,
      isCanary: false,
    });
  });
});
