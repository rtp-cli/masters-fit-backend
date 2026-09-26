import { Router } from "express";
import { ZodError } from "zod";

import { LoggedActivityController } from "@/controllers/logged-activity.controller";
import { requireAuth } from "@/middleware/authz.middleware";
import {
  ActivityDateInFutureError,
  LoggedActivityNotFoundError,
} from "@/services/logged-activity.service";
import { logger } from "@/utils/logger";

const router = Router();
const controller = new LoggedActivityController();

// Business/controller error mapping (authn/authz handled by middleware).
const handleError = (error: unknown, res: any) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof ActivityDateInFutureError) {
    res.status(400).json({ success: false, error: error.message });
  } else if (error instanceof LoggedActivityNotFoundError) {
    res.status(404).json({ success: false, error: error.message });
  } else {
    logger.error(
      "Logged activity request failed",
      error instanceof Error ? error : undefined
    );
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// [LR-077] There is no /:userId in any of these paths on purpose. The caller's
// id comes from the verified JWT (requireAuth → req.userId), so there is no id
// in the path for an attacker to swap.

// List the caller's logged activities, optionally within a date window.
router.get("/", requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const response = await controller.listActivities(
      req,
      typeof startDate === "string" ? startDate : undefined,
      typeof endDate === "string" ? endDate : undefined
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Record something the user already did.
router.post("/", requireAuth, async (req, res) => {
  try {
    const response = await controller.createActivity(req, req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Remove one (the mis-tap escape hatch — there is no edit in v1).
router.delete("/:activityId", requireAuth, async (req, res) => {
  try {
    const activityId = Number(req.params.activityId);
    if (!Number.isInteger(activityId) || activityId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid activity id" });
    }
    const response = await controller.deleteActivity(req, activityId);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as loggedActivitiesRouter };
