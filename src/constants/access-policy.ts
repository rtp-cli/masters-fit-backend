/**
 * Typed access-tier + capability policy — the single server-side source of
 * truth for "what can a tier do" in the MastersFit / MastersFit+ model.
 *
 * Entitlements (capabilities) are separate from usage limits (FREE_ALLOWANCES):
 * a FREE user HAS the adjustment capabilities but is additionally metered by a
 * lifetime allowance. The client mirrors capabilities via GET /subscriptions/
 * status for UX only; the server remains authoritative.
 */

export enum AccessTier {
  FREE = "FREE",
  PLUS = "PLUS",
  COMPLIMENTARY = "COMPLIMENTARY",
  BYPASS = "BYPASS",
}

/**
 * Tiers that may be granted server-side as an override (via
 * user_subscriptions.access_override). Never set from client input.
 * COMPLIMENTARY = full PLUS entitlements without payment (invited testers,
 * partners, reviewers). BYPASS = admin/dev full access + admin authorization.
 */
export type AccessOverride = AccessTier.COMPLIMENTARY | AccessTier.BYPASS;

export enum Capability {
  GENERATE_INITIAL_PLAN = "GENERATE_INITIAL_PLAN",
  GENERATE_NEW_PROGRAM = "GENERATE_NEW_PROGRAM",
  ADJUST_WEEK = "ADJUST_WEEK",
  ADJUST_DAY = "ADJUST_DAY",
  VIEW_PROGRESS_ANALYTICS = "VIEW_PROGRESS_ANALYTICS",
  SYNC_HEALTH = "SYNC_HEALTH",
}

/** AI operation types recorded in the ai_operations ledger. */
export enum AiOperationType {
  INITIAL_PLAN = "INITIAL_PLAN",
  NEW_PROGRAM = "NEW_PROGRAM",
  WEEK_ADJUSTMENT = "WEEK_ADJUSTMENT",
  DAY_ADJUSTMENT = "DAY_ADJUSTMENT",
  // Rest-day generation shares the DAY_ADJUSTMENT free allowance (decision C1).
  REST_DAY_WORKOUT = "REST_DAY_WORKOUT",
}

/** ai_operations lifecycle. reserved -> completed | failed(released). */
export enum AiOperationStatus {
  RESERVED = "reserved",
  COMPLETED = "completed",
  FAILED = "failed",
}

/** Descriptive lineage tag on workouts (metadata only — NOT entitlement truth). */
export enum WorkoutSourceType {
  AI_INITIAL = "AI_INITIAL",
  AI_NEW_PROGRAM = "AI_NEW_PROGRAM",
  AI_REGENERATION = "AI_REGENERATION",
  REST_DAY = "REST_DAY",
  REPEAT = "REPEAT",
  MANUAL = "MANUAL",
}

// FREE holds the AI-adjustment capabilities too, but they are additionally
// metered by FREE_ALLOWANCES (usage != entitlement). Only GENERATE_NEW_PROGRAM
// and the premium read/integration capabilities are PLUS-exclusive.
const FREE_CAPABILITIES: ReadonlySet<Capability> = new Set([
  Capability.GENERATE_INITIAL_PLAN,
  Capability.ADJUST_WEEK,
  Capability.ADJUST_DAY,
]);

const PAID_CAPABILITIES: ReadonlySet<Capability> = new Set(
  Object.values(Capability)
);

export const CAPABILITIES_BY_TIER: Record<AccessTier, ReadonlySet<Capability>> =
  {
    [AccessTier.FREE]: FREE_CAPABILITIES,
    [AccessTier.PLUS]: PAID_CAPABILITIES,
    [AccessTier.COMPLIMENTARY]: PAID_CAPABILITIES,
    [AccessTier.BYPASS]: PAID_CAPABILITIES,
  };

export function can(tier: AccessTier, capability: Capability): boolean {
  return CAPABILITIES_BY_TIER[tier].has(capability);
}

// --- Free-tier lifetime allowances (usage controls, not entitlements) --------
// Typed config with env overrides (no DB-managed config table at this stage).
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Lifetime free allowances by bucket. REST_DAY_WORKOUT consumes the
 * DAY_ADJUSTMENT bucket; NEW_PROGRAM has no free allowance (PLUS only).
 */
export const FREE_ALLOWANCES: Readonly<Record<string, number>> = {
  [AiOperationType.INITIAL_PLAN]: envInt("FREE_INITIAL_PLANS", 1),
  [AiOperationType.WEEK_ADJUSTMENT]: envInt("FREE_WEEK_ADJUSTMENTS", 1),
  [AiOperationType.DAY_ADJUSTMENT]: envInt("FREE_DAY_ADJUSTMENTS", 3),
};

// --- Paid reasonable-use safeguards (generous; invisible to normal users) ----
export const REASONABLE_USE = {
  MAX_CONCURRENT_AI_JOBS: envInt("RU_MAX_CONCURRENT_AI_JOBS", 1),
  MAX_OPS_PER_HOUR: envInt("RU_MAX_OPS_PER_HOUR", 15),
  MAX_OPS_PER_DAY: envInt("RU_MAX_OPS_PER_DAY", 40),
  DUPLICATE_COOLDOWN_SECONDS: envInt("RU_DUPLICATE_COOLDOWN_SECONDS", 30),
  TOKEN_WARN_PER_DAY: envInt("RU_TOKEN_WARN_PER_DAY", 500_000),
  TOKEN_HARD_STOP_PER_DAY: envInt("RU_TOKEN_HARD_STOP_PER_DAY", 2_000_000),
} as const;
