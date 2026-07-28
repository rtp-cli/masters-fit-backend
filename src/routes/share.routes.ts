import { Router, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

import { ShareController } from "@/controllers/share.controller";
import { requireAuth } from "@/middleware/authz.middleware";
import {
  ShareRateLimitError,
  ShareNotFoundError,
  ShareRevokedError,
} from "@/services/share.service";

const router = Router();
const controller = new ShareController();

interface AuthedRequest extends Request {
  userId: number;
}

// Business/controller error mapping (authn handled by requireAuth first).
const handleError = (error: unknown, res: Response) => {
  if (error instanceof ShareRateLimitError) {
    res.status(429).json({ success: false, error: error.message });
  } else if (error instanceof ShareRevokedError) {
    res.status(410).json({ success: false, error: error.message });
  } else if (error instanceof ShareNotFoundError) {
    res.status(404).json({ success: false, error: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// Per-IP fixed-window limiter for the PUBLIC read (decision 2). The endpoint is
// unauthenticated and returns a name + a full workout, so it must not be
// trivially scrapeable. Codes are random Crockford base32 (never sequential),
// so the space isn't walkable; this stops a scripted sweep. In-memory + single
// instance is fine for v1 — move to Redis if the API is ever horizontally
// scaled. The website's hard PNG / short HTML caches absorb legit repeat traffic.
// ---------------------------------------------------------------------------
const PUBLIC_WINDOW_MS = 60 * 1000;
const PUBLIC_MAX_PER_WINDOW = Number(process.env.SHARE_PUBLIC_MAX_PER_MIN) || 60;
const hits = new Map<string, { count: number; resetAt: number }>();

const publicReadRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + PUBLIC_WINDOW_MS });
  } else {
    entry.count += 1;
    if (entry.count > PUBLIC_MAX_PER_WINDOW) {
      res.status(429).json({ success: false, error: "Too many requests" });
      return;
    }
  }
  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 10000) {
    for (const [key, val] of hits) if (val.resetAt < now) hits.delete(key);
  }
  next();
};

// POST /api/share/preview — non-persisted preview URL (nothing minted).
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const response = await controller.createPreview(req as AuthedRequest, req.body);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/share/workout — mint (or reuse) a published public link.
router.post("/workout", requireAuth, async (req, res) => {
  try {
    const response = await controller.createShare(req as AuthedRequest, req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/share — the caller's links, newest first. MUST be declared before
// the public ":code" route so "share" isn't captured as a code.
router.get("/", requireAuth, async (req, res) => {
  try {
    const response = await controller.listMine(req as AuthedRequest);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/share/:code — PUBLIC, no auth, rate-limited per IP.
router.get("/:code", publicReadRateLimit, async (req, res) => {
  try {
    const data = await controller.getPublic(req.params.code);
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/share/:code — owner-only revoke.
router.delete("/:code", requireAuth, async (req, res) => {
  try {
    const response = await controller.revoke(req as AuthedRequest, req.params.code);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as shareRouter };
