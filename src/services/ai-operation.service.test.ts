import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { eq, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users } from "@/models/user.schema";
import { userSubscriptions } from "@/models/subscription.schema";
import { aiOperations } from "@/models/ai-operations.schema";
import { aiOperationService } from "@/services/ai-operation.service";
import { subscriptionService } from "@/services/subscription.service";
import { AccessTier, AiOperationType } from "@/constants/access-policy";
import { SubscriptionStatus } from "@/constants";

/**
 * Integration test for the AI-operation reservation core. Runs against the
 * LOCAL database (the ai_operations table + access_override columns must be
 * pushed). Skips cleanly when no DB is reachable so DB-less CI does not fail.
 *
 * Covers the correctness-critical behaviors: idempotency, free-allowance
 * exhaustion, failed-op release (a failure is never charged), the concurrent
 * two-request race (FOR UPDATE serialization), and capability denial.
 */
let dbAvailable = false;
let testUserId: number;

const KEY = (s: string) => `test-aiop-${testUserId}-${s}`;

async function resetLedger() {
  await db.delete(aiOperations).where(eq(aiOperations.userId, testUserId));
}

async function setTier(tier: AccessTier) {
  // FREE = trial; PLUS = active. Set directly for the test.
  const status =
    tier === AccessTier.PLUS
      ? SubscriptionStatus.ACTIVE
      : SubscriptionStatus.TRIAL;
  await db
    .update(userSubscriptions)
    .set({ status, accessOverride: null, subscriptionEndDate: null })
    .where(eq(userSubscriptions.userId, testUserId));
}

describe("AiOperationService (integration, local DB)", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }
    const [u] = await db
      .insert(users)
      .values({
        email: `aiop-test-${Date.now()}@example.test`,
        name: "AI Op Test",
      })
      .returning({ id: users.id });
    testUserId = u.id;
    await subscriptionService.getUserSubscription(testUserId); // creates trial row
  });

  afterAll(async () => {
    if (!dbAvailable || !testUserId) return;
    await db.delete(aiOperations).where(eq(aiOperations.userId, testUserId));
    await db
      .delete(userSubscriptions)
      .where(eq(userSubscriptions.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    // NOTE: the pool is closed by the global jest-setup-after-env teardown.
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await resetLedger();
    await setTier(AccessTier.FREE);
  });

  it("idempotency: same key returns the existing reservation, not a new one", async () => {
    if (!dbAvailable) return;
    const a = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("idem"),
    });
    const b = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("idem"),
    });
    expect(a.status).toBe("reserved");
    expect(b.status).toBe("duplicate");
    if (a.status === "reserved" && b.status === "duplicate") {
      expect(b.operationId).toBe(a.operationId);
    }
  });

  it("free allowance: 1 week adjustment then exhausted", async () => {
    if (!dbAvailable) return;
    const first = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("w1"),
    });
    expect(first.status).toBe("reserved");
    if (first.status === "reserved") {
      await aiOperationService.settleCompleted(first.operationId, {
        totalTokens: 100,
      });
    }
    const second = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("w2"),
    });
    expect(second.status).toBe("denied");
    if (second.status === "denied") {
      expect(second.reason).toBe("FREE_ALLOWANCE_EXHAUSTED");
    }
  });

  it("failed op is released and does NOT consume the allowance", async () => {
    if (!dbAvailable) return;
    const r = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("wfail"),
    });
    expect(r.status).toBe("reserved");
    if (r.status === "reserved") {
      await aiOperationService.settleFailed(r.operationId, {
        failureReason: "boom",
      });
    }
    // Allowance should be intact — a fresh week adjustment still reserves.
    const again = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.WEEK_ADJUSTMENT,
      idempotencyKey: KEY("wok"),
    });
    expect(again.status).toBe("reserved");
  });

  it("concurrency: two simultaneous reserves → exactly one wins (FOR UPDATE)", async () => {
    if (!dbAvailable) return;
    // Day allowance is 3, so allowance is not the limiter here; concurrency
    // (max 1 in-flight) is. Both reserve, neither settles → 1 reserved, 1 denied.
    const [a, b] = await Promise.all([
      aiOperationService.reserve({
        userId: testUserId,
        operationType: AiOperationType.DAY_ADJUSTMENT,
        idempotencyKey: KEY("c1"),
      }),
      aiOperationService.reserve({
        userId: testUserId,
        operationType: AiOperationType.DAY_ADJUSTMENT,
        idempotencyKey: KEY("c2"),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["denied", "reserved"]);
    const denied = [a, b].find((x) => x.status === "denied");
    if (denied && denied.status === "denied") {
      expect(denied.reason).toBe("CONCURRENCY_LIMIT");
    }
  });

  it("capability: FREE user cannot start a NEW_PROGRAM (requires PLUS)", async () => {
    if (!dbAvailable) return;
    const r = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.NEW_PROGRAM,
      idempotencyKey: KEY("np"),
    });
    expect(r.status).toBe("denied");
    if (r.status === "denied") {
      expect(r.reason).toBe("REQUIRES_PLUS");
    }
  });

  it("resolveGenerationType: INITIAL first, NEW_PROGRAM after a completed initial", async () => {
    if (!dbAvailable) return;
    expect(await aiOperationService.resolveGenerationType(testUserId)).toBe(
      AiOperationType.INITIAL_PLAN
    );
    const r = await aiOperationService.reserve({
      userId: testUserId,
      operationType: AiOperationType.INITIAL_PLAN,
      idempotencyKey: KEY("init"),
    });
    if (r.status === "reserved") {
      await aiOperationService.settleCompleted(r.operationId, {
        totalTokens: 10,
      });
    }
    expect(await aiOperationService.resolveGenerationType(testUserId)).toBe(
      AiOperationType.NEW_PROGRAM
    );
  });
});
