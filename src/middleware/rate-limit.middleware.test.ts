import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";

/**
 * Behavior tests for the OTP send limiter. Redis is faked in-process so the
 * suite needs no server and can't flake in CI.
 */

type Entry = { count: number; ttl: number };
const store = new Map<string, Entry>();
let redisShouldThrow = false;

jest.mock("@/utils/redis", () => ({
  redisClient: {
    incr: async (key: string) => {
      if (redisShouldThrow) throw new Error("redis down");
      const entry = store.get(key) ?? { count: 0, ttl: -1 };
      entry.count += 1;
      store.set(key, entry);
      return entry.count;
    },
    expire: async (key: string, seconds: number) => {
      const entry = store.get(key);
      if (entry) entry.ttl = seconds;
      return true;
    },
    ttl: async (key: string) => store.get(key)?.ttl ?? -1,
  },
}));

jest.mock("@/utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Imported after the mocks so the middleware picks up the fake client.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { otpSendRateLimit } = require("./rate-limit.middleware");

function makeReq(email: string, ip = "203.0.113.7"): Request {
  return {
    body: { email },
    path: "/login",
    headers: { "x-forwarded-for": ip },
  } as unknown as Request;
}

function makeRes(): Response & { body?: any; statusCode?: number } {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}

async function run(email: string, ip?: string) {
  const res = makeRes();
  const next = jest.fn() as unknown as NextFunction;
  await otpSendRateLimit(makeReq(email, ip), res, next);
  return { res, called: (next as unknown as jest.Mock).mock.calls.length > 0 };
}

describe("otpSendRateLimit", () => {
  beforeEach(() => {
    store.clear();
    redisShouldThrow = false;
  });

  it("allows the first three codes for one email", async () => {
    for (let i = 0; i < 3; i++) {
      const { called, res } = await run("a@example.com");
      expect(called).toBe(true);
      expect(res.body).toBeUndefined();
    }
  });

  it("blocks the fourth code for the same email within the window", async () => {
    for (let i = 0; i < 3; i++) await run("a@example.com");

    const { called, res } = await run("a@example.com");
    expect(called).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("RATE_LIMITED");
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.error).toContain("for that email");
  });

  it("blocks a spray of distinct emails from one IP", async () => {
    // Per-IP cap (15/15min) is what stops a bot rotating addresses; each of
    // these is well under its own per-email cap.
    for (let i = 0; i < 15; i++) {
      const { called } = await run(`spray-${i}@example.com`);
      expect(called).toBe(true);
    }

    const { called, res } = await run("spray-15@example.com");
    expect(called).toBe(false);
    expect(res.body.errorCode).toBe("RATE_LIMITED");
    expect(res.body.error).toContain("from this network");
  });

  it("counts each email separately", async () => {
    for (let i = 0; i < 3; i++) await run("a@example.com");

    const { called } = await run("b@example.com");
    expect(called).toBe(true);
  });

  it("normalizes case and whitespace so padding can't reset the counter", async () => {
    for (let i = 0; i < 3; i++) await run("a@example.com");

    const { called } = await run("  A@Example.COM  ");
    expect(called).toBe(false);
  });

  it("fails open when Redis is unavailable", async () => {
    redisShouldThrow = true;

    const { called, res } = await run("a@example.com");
    expect(called).toBe(true);
    expect(res.body).toBeUndefined();
  });
});
