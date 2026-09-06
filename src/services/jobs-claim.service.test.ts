import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/config/database";
import { users } from "@/models/user.schema";
import { backgroundJobs, JobStatus } from "@/models/jobs.schema";
import { jobsService } from "@/services/jobs.service";

/**
 * Integration test for the atomic job claim (duplicate-execution guard).
 * Runs against the LOCAL database; skips cleanly when no DB is reachable so
 * DB-less CI does not fail.
 *
 * Covers the correctness-critical behaviors: exactly ONE winner under
 * concurrency (the 2026-09-06 double-generation bug), no takeover of a fresh
 * PROCESSING claim, stale-claim takeover (crash recovery), terminal jobs never
 * claimable, and release re-enabling a claim without reopening terminal jobs.
 *
 * NOTE: the hooks live INSIDE the describe on purpose — the global teardown in
 * jest-setup-after-env.ts closes the pg pool in a root-level afterAll, and
 * only inner-scope afterAll hooks are guaranteed to run before it.
 */
let dbAvailable = false;
let testUserId: number;

async function createPendingJob(): Promise<number> {
  const job = await jobsService.createJob(testUserId, "workout_generation", {
    test: true,
  });
  return job.id;
}

describe("job claim (integration, local DB)", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      console.warn("Skipping jobs-claim tests — no local database reachable");
      return;
    }

    const [user] = await db
      .insert(users)
      .values({
        email: `test-jobs-claim-${Date.now()}@example.test`,
        name: "Jobs Claim Test",
      })
      .returning();
    testUserId = user.id;
  });

  afterAll(async () => {
    if (!dbAvailable || !testUserId) return;
    await db
      .delete(backgroundJobs)
      .where(eq(backgroundJobs.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe("claimJob", () => {
    it("grants exactly one claim under concurrency", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();

      // Warm the pool so the parallel claims below each grab an ALREADY-OPEN
      // connection (the drizzle concurrency-test gotcha: a cold pool
      // serializes the race away). Checked out via the pool directly and
      // released together so the pool actually holds distinct idle clients.
      const CONCURRENCY = 8;
      const warmClients = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        warmClients.push(await pool.connect());
      }
      for (const client of warmClients) {
        client.release();
      }

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => jobsService.claimJob(jobId))
      );

      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]!.status).toBe(JobStatus.PROCESSING);
    });

    it("does not grant a claim on a freshly PROCESSING job", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();
      expect(await jobsService.claimJob(jobId)).not.toBeNull();
      expect(await jobsService.claimJob(jobId)).toBeNull();
    });

    it("takes over a stale PROCESSING claim (crash recovery)", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();
      expect(await jobsService.claimJob(jobId)).not.toBeNull();

      // Age the claim past the staleness window.
      await db
        .update(backgroundJobs)
        .set({ updatedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(backgroundJobs.id, jobId));

      expect(await jobsService.claimJob(jobId, 10 * 60_000)).not.toBeNull();
    });

    it("never claims a terminal job, even a stale one", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();
      await jobsService.updateJobStatus(jobId, JobStatus.COMPLETED, 100, {
        ok: true,
      });
      await db
        .update(backgroundJobs)
        .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(backgroundJobs.id, jobId));

      expect(await jobsService.claimJob(jobId)).toBeNull();
    });
  });

  describe("releaseJobClaim", () => {
    it("release lets the next run (a Bull retry) claim again", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();
      expect(await jobsService.claimJob(jobId)).not.toBeNull();
      expect(await jobsService.claimJob(jobId)).toBeNull();

      await jobsService.releaseJobClaim(jobId);
      expect(await jobsService.claimJob(jobId)).not.toBeNull();
    });

    it("release never reopens a terminal job", async () => {
      if (!dbAvailable) return;

      const jobId = await createPendingJob();
      expect(await jobsService.claimJob(jobId)).not.toBeNull();
      await jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        0,
        undefined,
        undefined,
        "boom"
      );

      await jobsService.releaseJobClaim(jobId);
      const job = await jobsService.getJob(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
    });
  });
});
