import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { BaseService } from "@/services/base.service";
import { subscriptionService } from "@/services/subscription.service";
import { logger } from "@/utils/logger";
import { SubscriptionStatus } from "@/constants";
import { userSubscriptions } from "@/models/subscription.schema";
import { aiOperations } from "@/models/ai-operations.schema";
import {
  AccessTier,
  Capability,
  AiOperationType,
  AiOperationStatus,
  CAPABILITIES_BY_TIER,
  FREE_ALLOWANCES,
  REASONABLE_USE,
} from "@/constants/access-policy";

/**
 * A reserved/completed operation older than this with no settlement is treated
 * as abandoned (worker crashed mid-op) — it stops counting toward concurrency
 * and free allowance. Must exceed the longest generation watchdog (~8 min) so a
 * legitimately-running op is never treated as abandoned. A background reconciler
 * that explicitly marks such rows `failed` is a follow-up; ignoring them in the
 * counts keeps correctness without it.
 */
const STALE_RESERVATION_MS = 15 * 60 * 1000;

export type ReserveDenyReason =
  | "REQUIRES_PLUS"
  | "FREE_ALLOWANCE_EXHAUSTED"
  | "CONCURRENCY_LIMIT"
  | "RATE_LIMIT";

export type ReserveResult =
  | { status: "reserved"; operationId: number; operationType: AiOperationType }
  | {
      status: "duplicate";
      operationId: number;
      backgroundJobId: number | null;
    }
  | {
      status: "denied";
      reason: ReserveDenyReason;
      tier: AccessTier;
      operationType: AiOperationType;
    };

export interface SettleTokens {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string | null;
  provider?: string | null;
  estimatedCostUsd?: number | null;
  resultWorkoutId?: number | null;
}

/** Free-allowance bucket an operation type consumes (rest-day shares day). */
function allowanceBucket(op: AiOperationType): string | null {
  switch (op) {
    case AiOperationType.INITIAL_PLAN:
      return AiOperationType.INITIAL_PLAN;
    case AiOperationType.WEEK_ADJUSTMENT:
      return AiOperationType.WEEK_ADJUSTMENT;
    case AiOperationType.DAY_ADJUSTMENT:
    case AiOperationType.REST_DAY_WORKOUT:
      return AiOperationType.DAY_ADJUSTMENT;
    case AiOperationType.NEW_PROGRAM:
      return null; // PLUS-only; no free allowance
    default:
      return null;
  }
}

function capabilityFor(op: AiOperationType): Capability {
  switch (op) {
    case AiOperationType.INITIAL_PLAN:
      return Capability.GENERATE_INITIAL_PLAN;
    case AiOperationType.NEW_PROGRAM:
      return Capability.GENERATE_NEW_PROGRAM;
    case AiOperationType.WEEK_ADJUSTMENT:
      return Capability.ADJUST_WEEK;
    case AiOperationType.DAY_ADJUSTMENT:
    case AiOperationType.REST_DAY_WORKOUT:
      return Capability.ADJUST_DAY;
    default:
      return Capability.GENERATE_NEW_PROGRAM;
  }
}

/** Statuses that count as "consuming" (an in-flight or successful op). */
const CONSUMING_STATUSES = [
  AiOperationStatus.RESERVED,
  AiOperationStatus.COMPLETED,
];

/**
 * The authoritative gate + ledger for all AI-backed operations. Every AI
 * request reserves here (atomically, under a per-user row lock) before a Bull
 * job is enqueued; the job settles the reservation on completion/failure.
 *
 * Design (see SUBSCRIPTION_IMPLEMENTATION_PLAN R-1):
 *  - Atomic reservation via `SELECT ... FOR UPDATE` on the user's
 *    user_subscriptions row → serializes a user's concurrent reserves, so two
 *    simultaneous requests can't both consume the final free allowance.
 *  - Idempotency via UNIQUE(idempotency_key): a replayed request returns the
 *    existing operation's job instead of starting a second one.
 *  - Free-allowance usage is DERIVED from the ledger (no counters table).
 *  - A failed op is released (status=failed) so it stops counting → the user
 *    is never charged an allowance for a failure.
 */
export class AiOperationService extends BaseService {
  /**
   * For the generate-async route: decide whether this is the user's one free
   * INITIAL_PLAN or an ongoing NEW_PROGRAM (PLUS-only). Based on ledger truth
   * (a prior consuming INITIAL_PLAN), NOT workout-row existence.
   */
  async resolveGenerationType(userId: number): Promise<AiOperationType> {
    const staleCutoff = new Date(Date.now() - STALE_RESERVATION_MS);
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiOperations)
      .where(
        and(
          eq(aiOperations.userId, userId),
          eq(aiOperations.operationType, AiOperationType.INITIAL_PLAN),
          inArray(aiOperations.status, CONSUMING_STATUSES),
          gt(aiOperations.createdAt, staleCutoff)
        )
      );
    return n > 0 ? AiOperationType.NEW_PROGRAM : AiOperationType.INITIAL_PLAN;
  }

  /**
   * Free-tier lifetime allowance status per bucket (used/limit/remaining),
   * derived from the ledger. For the /subscriptions/status endpoint so the
   * client can show remaining adjustments. Rest-day ops count toward the day
   * bucket. (Meaningful for FREE; PLUS/COMP/BYPASS aren't metered this way.)
   */
  async getFreeAllowanceStatus(userId: number): Promise<{
    initialPlan: { limit: number; used: number; remaining: number };
    weekAdjustment: { limit: number; used: number; remaining: number };
    dayAdjustment: { limit: number; used: number; remaining: number };
  }> {
    const staleCutoff = new Date(Date.now() - STALE_RESERVATION_MS);
    const countBucket = async (types: AiOperationType[]): Promise<number> => {
      const [{ n }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.userId, userId),
            inArray(aiOperations.operationType, types),
            inArray(aiOperations.status, CONSUMING_STATUSES),
            eq(aiOperations.countedAgainstFreeAllowance, true),
            gt(aiOperations.createdAt, staleCutoff)
          )
        );
      return n;
    };
    const mk = (bucket: string, used: number) => {
      const limit = FREE_ALLOWANCES[bucket] ?? 0;
      return { limit, used, remaining: Math.max(0, limit - used) };
    };
    const [initialUsed, weekUsed, dayUsed] = await Promise.all([
      countBucket([AiOperationType.INITIAL_PLAN]),
      countBucket([AiOperationType.WEEK_ADJUSTMENT]),
      countBucket([
        AiOperationType.DAY_ADJUSTMENT,
        AiOperationType.REST_DAY_WORKOUT,
      ]),
    ]);
    return {
      initialPlan: mk(AiOperationType.INITIAL_PLAN, initialUsed),
      weekAdjustment: mk(AiOperationType.WEEK_ADJUSTMENT, weekUsed),
      dayAdjustment: mk(AiOperationType.DAY_ADJUSTMENT, dayUsed),
    };
  }

  /**
   * Atomically reserve an AI operation. Returns a reservation, an existing
   * duplicate (same idempotencyKey), or a denial (paywall / concurrency / rate).
   */
  async reserve(params: {
    userId: number;
    operationType: AiOperationType;
    idempotencyKey: string;
  }): Promise<ReserveResult> {
    const { userId, operationType, idempotencyKey } = params;

    // Ensure a subscription row exists to lock (auto-creates a trial if none).
    await subscriptionService.getUserSubscription(userId);

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const staleCutoff = new Date(now.getTime() - STALE_RESERVATION_MS);

      // Per-user mutex: serialize this user's reservations (R-1).
      const [sub] = await tx
        .select()
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, userId))
        .for("update")
        .limit(1);

      // Idempotency: a replay of the same intentional action returns the
      // existing operation rather than starting a second one.
      const [existing] = await tx
        .select({
          id: aiOperations.id,
          backgroundJobId: aiOperations.backgroundJobId,
        })
        .from(aiOperations)
        .where(eq(aiOperations.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        return {
          status: "duplicate" as const,
          operationId: existing.id,
          backgroundJobId: existing.backgroundJobId,
        };
      }

      const tier = this.resolveTierFromRow(sub, now);

      // Entitlement (capability) check.
      if (!CAPABILITIES_BY_TIER[tier].has(capabilityFor(operationType))) {
        return {
          status: "denied" as const,
          reason: "REQUIRES_PLUS" as const,
          tier,
          operationType,
        };
      }

      // Per-user concurrency: at most N in-flight (non-stale reserved) ops.
      const [{ active }] = await tx
        .select({ active: sql<number>`count(*)::int` })
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.userId, userId),
            eq(aiOperations.status, AiOperationStatus.RESERVED),
            gt(aiOperations.createdAt, staleCutoff)
          )
        );
      if (active >= REASONABLE_USE.MAX_CONCURRENT_AI_JOBS) {
        return {
          status: "denied" as const,
          reason: "CONCURRENCY_LIMIT" as const,
          tier,
          operationType,
        };
      }

      // Reasonable-use rate ceilings (generous; invisible to normal users).
      const dayCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const hourCutoff = new Date(now.getTime() - 60 * 60 * 1000);
      const [{ hourN }] = await tx
        .select({ hourN: sql<number>`count(*)::int` })
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.userId, userId),
            inArray(aiOperations.status, CONSUMING_STATUSES),
            gt(aiOperations.createdAt, hourCutoff)
          )
        );
      const [{ dayN }] = await tx
        .select({ dayN: sql<number>`count(*)::int` })
        .from(aiOperations)
        .where(
          and(
            eq(aiOperations.userId, userId),
            inArray(aiOperations.status, CONSUMING_STATUSES),
            gt(aiOperations.createdAt, dayCutoff)
          )
        );
      if (
        hourN >= REASONABLE_USE.MAX_OPS_PER_HOUR ||
        dayN >= REASONABLE_USE.MAX_OPS_PER_DAY
      ) {
        logger.warn("AI op rate limit hit", {
          operation: "aiOperation.reserve",
          userId,
          metadata: { hourN, dayN, operationType },
        });
        return {
          status: "denied" as const,
          reason: "RATE_LIMIT" as const,
          tier,
          operationType,
        };
      }

      // Free-tier lifetime allowance (metered ops only).
      const bucket = allowanceBucket(operationType);
      let counted = false;
      if (tier === AccessTier.FREE && bucket) {
        const limit = FREE_ALLOWANCES[bucket] ?? 0;
        const bucketTypes =
          bucket === AiOperationType.DAY_ADJUSTMENT
            ? [AiOperationType.DAY_ADJUSTMENT, AiOperationType.REST_DAY_WORKOUT]
            : [bucket as AiOperationType];
        const [{ used }] = await tx
          .select({ used: sql<number>`count(*)::int` })
          .from(aiOperations)
          .where(
            and(
              eq(aiOperations.userId, userId),
              inArray(aiOperations.operationType, bucketTypes),
              inArray(aiOperations.status, CONSUMING_STATUSES),
              eq(aiOperations.countedAgainstFreeAllowance, true),
              gt(aiOperations.createdAt, staleCutoff)
            )
          );
        if (used >= limit) {
          return {
            status: "denied" as const,
            reason: "FREE_ALLOWANCE_EXHAUSTED" as const,
            tier,
            operationType,
          };
        }
        counted = true;
      }

      const [op] = await tx
        .insert(aiOperations)
        .values({
          userId,
          operationType,
          status: AiOperationStatus.RESERVED,
          idempotencyKey,
          accessTierAtRequest: tier,
          countedAgainstFreeAllowance: counted,
        })
        .returning({ id: aiOperations.id });

      return {
        status: "reserved" as const,
        operationId: op.id,
        operationType,
      };
    });
  }

  /** Link the enqueued Bull job to its reservation. */
  async attachJob(operationId: number, backgroundJobId: number): Promise<void> {
    await this.db
      .update(aiOperations)
      .set({ backgroundJobId })
      .where(eq(aiOperations.id, operationId));
  }

  /** Settle a reservation as completed with real token/cost accounting. */
  async settleCompleted(
    operationId: number,
    tokens: SettleTokens
  ): Promise<void> {
    // Idempotent: only a still-reserved row transitions to completed, so a Bull
    // retry that re-runs a success does not double-settle.
    const updated = await this.db
      .update(aiOperations)
      .set({
        status: AiOperationStatus.COMPLETED,
        inputTokens: tokens.inputTokens ?? 0,
        outputTokens: tokens.outputTokens ?? 0,
        totalTokens: tokens.totalTokens ?? 0,
        model: tokens.model ?? null,
        provider: tokens.provider ?? null,
        estimatedCostUsd:
          tokens.estimatedCostUsd != null
            ? String(tokens.estimatedCostUsd)
            : null,
        resultWorkoutId: tokens.resultWorkoutId ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(aiOperations.id, operationId),
          eq(aiOperations.status, AiOperationStatus.RESERVED)
        )
      )
      .returning({ id: aiOperations.id });
    if (updated.length === 0) {
      logger.warn("settleCompleted no-op (not in reserved state)", {
        operation: "aiOperation.settleCompleted",
        metadata: { operationId },
      });
    }
  }

  /**
   * Settle a reservation as failed (releases the allowance — a failed op is
   * never charged). Idempotent on the reserved state.
   */
  async settleFailed(
    operationId: number,
    failure: { failureCode?: string; failureReason?: string }
  ): Promise<void> {
    await this.db
      .update(aiOperations)
      .set({
        status: AiOperationStatus.FAILED,
        failureCode: failure.failureCode ?? null,
        failureReason: failure.failureReason ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(aiOperations.id, operationId),
          eq(aiOperations.status, AiOperationStatus.RESERVED)
        )
      );
  }

  /**
   * Settle by the linked Bull background-job id — the identifier the job
   * processors already have (avoids threading operationId through job data).
   * Idempotent on the reserved state (a Bull retry that re-runs a success
   * won't double-settle; a failure after a prior success is a no-op).
   */
  async settleCompletedByJobId(
    backgroundJobId: number,
    tokens: SettleTokens
  ): Promise<void> {
    await this.db
      .update(aiOperations)
      .set({
        status: AiOperationStatus.COMPLETED,
        inputTokens: tokens.inputTokens ?? 0,
        outputTokens: tokens.outputTokens ?? 0,
        totalTokens: tokens.totalTokens ?? 0,
        model: tokens.model ?? null,
        provider: tokens.provider ?? null,
        estimatedCostUsd:
          tokens.estimatedCostUsd != null
            ? String(tokens.estimatedCostUsd)
            : null,
        resultWorkoutId: tokens.resultWorkoutId ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(aiOperations.backgroundJobId, backgroundJobId),
          eq(aiOperations.status, AiOperationStatus.RESERVED)
        )
      );
  }

  async settleFailedByJobId(
    backgroundJobId: number,
    failure: { failureCode?: string; failureReason?: string }
  ): Promise<void> {
    await this.db
      .update(aiOperations)
      .set({
        status: AiOperationStatus.FAILED,
        failureCode: failure.failureCode ?? null,
        failureReason: failure.failureReason ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(aiOperations.backgroundJobId, backgroundJobId),
          eq(aiOperations.status, AiOperationStatus.RESERVED)
        )
      );
  }

  /** Billing/override → tier, from an already-loaded subscription row. */
  private resolveTierFromRow(
    sub:
      | {
          status: SubscriptionStatus;
          subscriptionEndDate: Date | null;
          accessOverride: AccessTier | null;
          accessOverrideExpiresAt: Date | null;
        }
      | undefined,
    now: Date
  ): AccessTier {
    if (!sub) return AccessTier.FREE;
    if (sub.accessOverride) {
      const exp = sub.accessOverrideExpiresAt;
      if (!exp || exp > now) return sub.accessOverride;
    }
    switch (sub.status) {
      case SubscriptionStatus.ACTIVE:
        return AccessTier.PLUS;
      case SubscriptionStatus.GRACE_PERIOD:
      case SubscriptionStatus.CANCELLED:
        return sub.subscriptionEndDate && sub.subscriptionEndDate > now
          ? AccessTier.PLUS
          : AccessTier.FREE;
      default:
        return AccessTier.FREE;
    }
  }
}

export const aiOperationService = new AiOperationService();
