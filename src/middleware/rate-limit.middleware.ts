import { NextFunction, Request, Response } from "express";
import { redisClient } from "@/utils/redis";
import { logger } from "@/utils/logger";
import { getClientIP } from "@/utils/ip.utils";

/**
 * Rate limiting for the endpoints that MAIL a one-time code (/auth/login,
 * /auth/signup, /auth/generate-auth-code).
 *
 * Why: those endpoints send an email to whatever address is POSTed, with no
 * authentication and — until this middleware — no cap. That let anyone mail-bomb
 * an arbitrary inbox on our Resend quota. The `attempts` column on auth_codes
 * caps failed *verify* tries (5 per code); nothing capped code *requests*.
 *
 * Counters live in Redis (not in-process) because the backend is expected to run
 * multiple Render instances later — an in-memory limiter would let the cap scale
 * up with the instance count.
 *
 * Fails OPEN: if Redis is down, requests are allowed through. A limiter outage
 * must not lock every user out of signing in.
 */

type Bucket = {
  /** Redis key suffix, e.g. "email:15m" */
  readonly name: string;
  /** Window length in seconds. */
  readonly windowSec: number;
  /** Max requests allowed inside one window. */
  readonly max: number;
};

const EMAIL_BUCKETS: readonly Bucket[] = [
  { name: "email:15m", windowSec: 15 * 60, max: 3 },
  { name: "email:24h", windowSec: 24 * 60 * 60, max: 10 },
];

// Deliberately looser than the per-email caps: a household, office, or carrier
// NAT can legitimately share one IP across several accounts.
const IP_BUCKETS: readonly Bucket[] = [
  { name: "ip:15m", windowSec: 15 * 60, max: 15 },
  { name: "ip:24h", windowSec: 24 * 60 * 60, max: 40 },
];

type BucketState = { blocked: boolean; retryAfterSec: number };

/**
 * Fixed-window counter: INCR the key, and set its TTL on first use. Returns
 * whether this request exceeded the bucket, plus the seconds until the window
 * rolls over. Throws if Redis is unreachable — callers fail open.
 */
async function hitBucket(key: string, bucket: Bucket): Promise<BucketState> {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, bucket.windowSec);
  }
  if (count <= bucket.max) {
    return { blocked: false, retryAfterSec: 0 };
  }
  const ttl = await redisClient.ttl(key);
  return {
    blocked: true,
    retryAfterSec: ttl > 0 ? ttl : bucket.windowSec,
  };
}

function humanizeWait(seconds: number): string {
  if (seconds <= 90) return "a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}

/**
 * Caps how many one-time codes a single email address or IP can request.
 *
 * Responds 200 with `{ success: false, ... }` rather than 429 on purpose: the
 * shipped 1.2.x clients funnel any thrown HTTP error through a generic
 * "Failed to login" string (`loginAPI` in the app's lib/api.ts swallows it), so
 * a 429 would hide the wait time from exactly the users who need to see it.
 * `errorCode` lets a future client branch without string-matching.
 */
export async function otpSendRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
  const ip = getClientIP(req);

  // Audit trail: every code request, allowed or not. Low volume, and it's what
  // makes a burst attributable to an address + origin in the Render logs.
  logger.info("OTP code requested", {
    operation: "otpSendRateLimit",
    metadata: { path: req.path, email: rawEmail || undefined, ip },
  });

  const checks: Array<{ key: string; bucket: Bucket }> = [];
  if (rawEmail) {
    for (const bucket of EMAIL_BUCKETS) {
      checks.push({ key: `otp-rl:${bucket.name}:${rawEmail}`, bucket });
    }
  }
  if (ip) {
    for (const bucket of IP_BUCKETS) {
      checks.push({ key: `otp-rl:${bucket.name}:${ip}`, bucket });
    }
  }

  if (checks.length === 0) {
    next();
    return;
  }

  let worst: { state: BucketState; bucket: Bucket } | undefined;

  try {
    // Every bucket is incremented (not short-circuited) so one blocked window
    // doesn't leave the other counters undercounted.
    for (const { key, bucket } of checks) {
      const state = await hitBucket(key, bucket);
      if (state.blocked && (!worst || state.retryAfterSec > worst.state.retryAfterSec)) {
        worst = { state, bucket };
      }
    }
  } catch (error) {
    logger.error("OTP rate limiter unavailable, allowing request", error as Error, {
      operation: "otpSendRateLimit",
      metadata: { path: req.path, ip },
    });
    next();
    return;
  }

  if (!worst) {
    next();
    return;
  }

  // Logged at warn with both identifiers so a burst is attributable in the
  // Render logs (which address, from which IP, against which endpoint).
  logger.warn("OTP request rate-limited", {
    operation: "otpSendRateLimit",
    metadata: {
      path: req.path,
      email: rawEmail || undefined,
      ip,
      bucket: worst.bucket.name,
      retryAfterSec: worst.state.retryAfterSec,
    },
  });

  const subject = worst.bucket.name.startsWith("ip:")
    ? "from this network"
    : "for that email";

  res.status(200).json({
    success: false,
    errorCode: "RATE_LIMITED",
    retryAfterSeconds: worst.state.retryAfterSec,
    error: `Too many codes requested ${subject}. Try again in ${humanizeWait(
      worst.state.retryAfterSec
    )}.`,
  });
}
