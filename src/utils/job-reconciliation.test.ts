import { describe, it, expect } from "@jest/globals";
import {
  classifyJobForReconciliation,
  reconcileJobs,
  ORPHAN_MIN_AGE_MS,
  type ReconcilerCandidate,
  type ReconcilerQueue,
} from "@/utils/job-reconciliation";

const NOW = Date.UTC(2026, 8, 7, 18, 0, 0);
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

const candidate = (
  id: number,
  updatedAt: Date,
  status = "processing"
): ReconcilerCandidate => ({ id, userId: 3, status, updatedAt });

/** Fake queue: `states` maps job id -> Bull state; a missing key means Bull has no job. */
const fakeQueue = (
  states: Record<string, string>,
  opts: { throwFor?: string[] } = {}
): ReconcilerQueue => ({
  async getJob(id: string) {
    if (opts.throwFor?.includes(id)) throw new Error("redis unavailable");
    const state = states[id];
    if (!state) return null;
    return { getState: async () => state };
  },
});

describe("classifyJobForReconciliation", () => {
  it("treats a job Bull has no record of as an orphan", () => {
    expect(
      classifyJobForReconciliation({ bullState: null, ageMs: 10 * 60_000 })
    ).toBe("orphan");
  });

  it("treats a job Bull already finished as an orphan (the 2026-09-07 deploy case)", () => {
    // Bull marked it completed when the duplicate-skip returned success, but
    // the DB row was left in `processing` by the instance that died.
    for (const state of ["completed", "failed", "stuck"]) {
      expect(
        classifyJobForReconciliation({ bullState: state, ageMs: 10 * 60_000 })
      ).toBe("orphan");
    }
  });

  it("leaves anything Bull will still run alone, however old", () => {
    for (const state of ["active", "waiting", "delayed", "paused"]) {
      expect(
        classifyJobForReconciliation({ bullState: state, ageMs: 60 * 60_000 })
      ).toBe("live");
    }
  });

  it("ignores rows younger than the grace period, even with no Bull job yet", () => {
    // createJob commits before queue.add — a fresh row legitimately has no job.
    expect(
      classifyJobForReconciliation({ bullState: null, ageMs: ORPHAN_MIN_AGE_MS - 1 })
    ).toBe("too-new");
  });
});

describe("reconcileJobs", () => {
  it("fails only the orphans and reports each bucket", async () => {
    const orphaned: number[] = [];
    const result = await reconcileJobs({
      candidates: [
        candidate(778, minutesAgo(20)), // killed in a deploy swap -> no Bull job
        candidate(779, minutesAgo(3)), // genuinely running
        candidate(780, minutesAgo(10)), // Bull finished it, DB never caught up
        candidate(781, new Date(NOW - 30_000)), // just created
      ],
      queue: fakeQueue({ "779": "active", "780": "completed" }),
      now: NOW,
      onOrphan: async (c) => {
        orphaned.push(c.id);
      },
    });

    expect(orphaned).toEqual([778, 780]);
    expect(result).toEqual({
      checked: 4,
      orphaned: [778, 780],
      live: [779],
      tooNew: [781],
    });
  });

  it("sweeps pending rows that never reached the queue", async () => {
    const orphaned: number[] = [];
    await reconcileJobs({
      candidates: [candidate(800, minutesAgo(5), "pending")],
      queue: fakeQueue({}),
      now: NOW,
      onOrphan: async (c) => {
        orphaned.push(c.id);
      },
    });
    expect(orphaned).toEqual([800]);
  });

  it("leaves a job alone when the queue can't be read (never fail on ignorance)", async () => {
    const orphaned: number[] = [];
    const result = await reconcileJobs({
      candidates: [candidate(900, minutesAgo(30))],
      queue: fakeQueue({}, { throwFor: ["900"] }),
      now: NOW,
      onOrphan: async (c) => {
        orphaned.push(c.id);
      },
    });
    expect(orphaned).toEqual([]);
    expect(result.live).toEqual([900]);
  });

  it("does nothing when there are no candidates", async () => {
    const result = await reconcileJobs({
      candidates: [],
      queue: fakeQueue({}),
      now: NOW,
      onOrphan: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result).toEqual({ checked: 0, orphaned: [], live: [], tooNew: [] });
  });
});
