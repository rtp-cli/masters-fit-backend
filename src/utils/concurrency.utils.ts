/**
 * Minimal async concurrency limiter (semaphore).
 *
 * [PERF-04] Used to bound how many Claude day-generation calls a single weekly
 * generation runs at once. Without a cap, a 7-day plan fires up to 7 simultaneous
 * Anthropic requests, and with the queue processing multiple generations at once
 * (Bull concurrency 10) that can fan out to ~80 concurrent calls — enough to trip
 * account-level rate limits, which then cascade into retries and the expensive
 * serial fallback. Kept dependency-free on purpose (p-limit is only a transitive
 * dep here, not a declared one).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Run `fn` once a slot is free, always releasing the slot afterward. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
