import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import { maxSessionsPerDate } from "@/constants/workout-sessions";

describe("maxSessionsPerDate", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.MAX_SESSIONS_PER_DATE;
    delete process.env.MAX_SESSIONS_PER_DATE;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.MAX_SESSIONS_PER_DATE;
    else process.env.MAX_SESSIONS_PER_DATE = saved;
  });

  // The planned session plus one addition. Deliberately conservative: each
  // extra session spends a DAY_ADJUSTMENT, of which a free account has three
  // for its lifetime.
  it("defaults to 2", () => {
    expect(maxSessionsPerDate()).toBe(2);
  });

  it("honours an override", () => {
    process.env.MAX_SESSIONS_PER_DATE = "3";
    expect(maxSessionsPerDate()).toBe(3);
  });

  // Read at call time, not module load, so the limit can move without a deploy.
  it("picks up a change without re-importing", () => {
    expect(maxSessionsPerDate()).toBe(2);
    process.env.MAX_SESSIONS_PER_DATE = "4";
    expect(maxSessionsPerDate()).toBe(4);
  });

  it("ignores junk and falls back to the default", () => {
    process.env.MAX_SESSIONS_PER_DATE = "not-a-number";
    expect(maxSessionsPerDate()).toBe(2);
  });

  // 0 or negative would block the ordinary single session a plan already has,
  // which would break every date rather than just the bonus path.
  it("refuses a value below 1", () => {
    process.env.MAX_SESSIONS_PER_DATE = "0";
    expect(maxSessionsPerDate()).toBe(2);
    process.env.MAX_SESSIONS_PER_DATE = "-3";
    expect(maxSessionsPerDate()).toBe(2);
  });

  it("floors a fractional value", () => {
    process.env.MAX_SESSIONS_PER_DATE = "2.9";
    expect(maxSessionsPerDate()).toBe(2);
  });
});
