import { logger } from "./logger";

/**
 * Raised when an operation exceeds its allotted time. Distinguished from
 * ordinary errors so callers (and the Bull job catch) can treat a timeout as
 * the bounded-failure it is rather than a mysterious hang.
 */
export class TimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race a promise against a hard deadline. On timeout this rejects with a
 * `TimeoutError` — it does NOT cancel the underlying work (use
 * {@link runWithAbortTimeout} when the operation supports an AbortSignal).
 *
 * This is the backstop that guarantees a long-running job (workout generation)
 * always reaches a terminal state: without it, a stalled LLM/network call that
 * never resolves leaves the Bull job `active` forever and the client stuck
 * until its own multi-minute timeout fires.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run an abortable operation with a hard deadline. The operation receives an
 * `AbortSignal` that fires on timeout OR when `parentSignal` aborts, so the
 * underlying request is actually cancelled (not just abandoned). On timeout
 * this rejects with a `TimeoutError`.
 *
 * Used to bound each LLM call in the fan-out: a single stalled provider
 * connection (one that hangs without an RST) would otherwise wait forever.
 */
export async function runWithAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string
): Promise<T> {
  const callAbort = new AbortController();

  const onParentAbort = () => callAbort.abort();
  if (parentSignal) {
    if (parentSignal.aborted) callAbort.abort();
    else parentSignal.addEventListener("abort", onParentAbort);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      callAbort.abort();
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(callAbort.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    if (timedOut) {
      logger.warn("Operation aborted by timeout", { label, timeoutMs });
    }
  }
}
