import { AIProvider, getModelConfig } from "@/constants/ai-providers";

/**
 * Model canary for the Anthropic fan-out generation path.
 *
 * Lets a new model run for an allowlist of users (e.g. the team) while
 * everyone else stays on the incumbent, so a model upgrade goes
 *   eval → canary → flip the default → delete the old catalog entry
 * instead of a blind swap. Everything is env-driven, so adding a tester,
 * rolling out, or rolling back is a Render env change — no deploy.
 *
 *   MODEL_CANARY_USER_IDS="3,41"           who gets the canary (fail-closed)
 *   FANOUT_CANARY_MODEL="claude-haiku-5-5" what they get (planning AND day calls)
 *
 * The model that actually ran is already recorded per generation in
 * llm_generation_logs.planning_model / day_model, so canary and incumbent
 * runs can be compared there.
 */

// Incumbent fan-out models. FANOUT_PLANNING_MODEL / FANOUT_DAY_MODEL still
// override them globally (the eval harness sweeps models this way).
export const DEFAULT_FANOUT_MODEL = "claude-haiku-4-5-20251001";

export interface FanoutModels {
  planningModel: string;
  dayModel: string;
  isCanary: boolean;
  // Set when the user is on the canary list but FANOUT_CANARY_MODEL isn't a
  // registered Anthropic model — the caller logs it and runs the incumbent.
  misconfiguredCanaryModel?: string;
}

// Same parsing as ADMIN_USER_IDS: fail-closed, unset → nobody.
function parseCanaryIds(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

export function resolveFanoutModels(
  userId: number,
  env: NodeJS.ProcessEnv = process.env
): FanoutModels {
  const incumbent: FanoutModels = {
    planningModel: env.FANOUT_PLANNING_MODEL || DEFAULT_FANOUT_MODEL,
    dayModel: env.FANOUT_DAY_MODEL || DEFAULT_FANOUT_MODEL,
    isCanary: false,
  };

  const canaryModel = env.FANOUT_CANARY_MODEL?.trim();
  if (!canaryModel || !parseCanaryIds(env.MODEL_CANARY_USER_IDS).has(userId)) {
    return incumbent;
  }
  // A typo'd canary model would otherwise throw inside createLLMInstance and
  // fail only the canary users' generations — degrade to the incumbent.
  if (!getModelConfig(AIProvider.ANTHROPIC, canaryModel)) {
    return { ...incumbent, misconfiguredCanaryModel: canaryModel };
  }
  return { planningModel: canaryModel, dayModel: canaryModel, isCanary: true };
}
