/**
 * Per-generation phase timing collector.
 *
 * Motivation (2026-09-06 forensics): prod jobs showed a 40–140s gap between
 * Bull pickup and the first LLM call that `llm_generation_logs.llmDurationMs`
 * can't attribute — the pre-LLM pipeline (job pre-work, profile fetches, agent
 * setup, exercise-catalog fetch/format, feedback digest, progression scan) was
 * unmeasured. The job handler starts a run; each layer records the phases it
 * owns; the generation-log insert attaches the snapshot, so slow runs can be
 * attributed with SQL on `phase_timings` instead of Render log archaeology.
 *
 * Keyed by userId, like `lastTokenUsageByUser` in prompts.service — the same
 * side-channel pattern with the same caveat: two generations for ONE user
 * running concurrently in one process would share an entry. Post-claim
 * (PR #53) a job runs single-flight, and the ledger reservation serializes a
 * user's generation ops, so in practice a run owns its entry. Timings are
 * diagnostics, not correctness data — a rare overlap skews one row, nothing
 * else.
 *
 * Vocabulary:
 * - `recordPhase` / `timePhase` — a DURATION (how long one phase took).
 * - `markPhaseElapsed` — a WATERFALL MARK (elapsed since the run started),
 *   named `at...Ms`. Comparing marks against the summed durations exposes any
 *   still-unmeasured residue.
 */

type PhaseRun = { startedAt: number; phases: Record<string, number> };

const runsByUser = new Map<number, PhaseRun>();

/** Begin a fresh run at job pickup; discards any previous entry for the user. */
export function startPhaseRun(userId: number): void {
  runsByUser.set(userId, { startedAt: Date.now(), phases: {} });
}

/** Record a phase duration in ms. No-op when no run is active for the user. */
export function recordPhase(userId: number, phase: string, ms: number): void {
  const run = runsByUser.get(userId);
  if (run) run.phases[phase] = Math.round(ms);
}

/** Record elapsed-since-run-start under `phase` (waterfall mark, `at...Ms`). */
export function markPhaseElapsed(userId: number, phase: string): void {
  const run = runsByUser.get(userId);
  if (run) run.phases[phase] = Date.now() - run.startedAt;
}

/** Time an async phase and record it, propagating the result/error. */
export async function timePhase<T>(
  userId: number,
  phase: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    recordPhase(userId, phase, Date.now() - startedAt);
  }
}

/**
 * The phases recorded so far plus `totalMs` (elapsed since the run started).
 * Undefined when no run is active (e.g. the eval harness calling the agent
 * directly) — callers pass it straight into the generation-log insert.
 */
export function snapshotPhases(
  userId: number
): Record<string, number> | undefined {
  const run = runsByUser.get(userId);
  if (!run) return undefined;
  return { ...run.phases, totalMs: Date.now() - run.startedAt };
}
