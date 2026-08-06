import { Router } from "express";
import { ZodError } from "zod";
import { TrainingLocationController } from "@/controllers/training-location.controller";
import { requireAuth, requireSelf } from "@/middleware/authz.middleware";
import {
  LocationCapReachedError,
  CannotDeletePrimaryError,
  LocationNotFoundError,
} from "@/services/training-location.service";

const router = Router();
const controller = new TrainingLocationController();

const handleError = (error: unknown, res: any) => {
  if (error instanceof Error && error.message === "Invalid or expired token") {
    res.status(401).json({ success: false, error: error.message });
  } else if (error instanceof Error && error.message === "Unauthorized") {
    res.status(401).json({ success: false, error: "Unauthorized" });
  } else if (error instanceof LocationCapReachedError) {
    // Stated-reason refusal (spec §6): surface the message so the client can
    // show it rather than silently disabling.
    res.status(409).json({ success: false, error: error.message });
  } else if (error instanceof CannotDeletePrimaryError) {
    res.status(409).json({ success: false, error: error.message });
  } else if (error instanceof LocationNotFoundError) {
    res.status(404).json({ success: false, error: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// List a user's places (primary first)
router.get("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    res.json(await controller.list(Number(req.params.userId)));
  } catch (error) {
    handleError(error, res);
  }
});

// Save a new secondary place
router.post("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const response = await controller.create(Number(req.params.userId), req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Record the session's location on a plan day (no regeneration).
// Declared before the /:locationId routes so "plan-day" isn't captured as an id.
router.put(
  "/:userId/plan-day/:planDayId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      res.json(
        await controller.setDayLocation(
          Number(req.params.userId),
          Number(req.params.planDayId),
          req.body
        )
      );
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Promote a secondary to primary
router.post(
  "/:userId/:locationId/make-primary",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      res.json(
        await controller.makePrimary(
          Number(req.params.userId),
          Number(req.params.locationId)
        )
      );
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Rename / re-equip a place
router.put(
  "/:userId/:locationId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      res.json(
        await controller.update(
          Number(req.params.userId),
          Number(req.params.locationId),
          req.body
        )
      );
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Remove a saved secondary
router.delete(
  "/:userId/:locationId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      res.json(
        await controller.remove(
          Number(req.params.userId),
          Number(req.params.locationId)
        )
      );
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as trainingLocationRouter };
