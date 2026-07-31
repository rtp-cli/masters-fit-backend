import { Router } from "express";
import { ExerciseExclusionController } from "@/controllers/exercise-exclusion.controller";
import { ZodError } from "zod";
import { requireAuth, requireSelf } from "@/middleware/authz.middleware";

const router = Router();
const controller = new ExerciseExclusionController();

// Business/controller error mapping (authn/authz handled by middleware).
const handleError = (error: unknown, res: any) => {
  if (error instanceof Error && error.message === "Invalid or expired token") {
    res.status(401).json({ success: false, error: error.message });
  } else if (error instanceof Error && error.message === "Unauthorized") {
    res.status(401).json({ success: false, error: "Unauthorized" });
  } else if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// List the user's excluded exercises (Settings → Excluded exercises)
router.get("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const response = await controller.listExclusions(Number(req.params.userId));
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Ranked replacements for a slot (1e / 1f)
router.get(
  "/:userId/replacements",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const { exerciseId, limit } = req.query;
      if (!exerciseId) {
        return res
          .status(400)
          .json({ success: false, error: "exerciseId is required" });
      }
      const response = await controller.getReplacements(
        Number(req.params.userId),
        Number(exerciseId),
        limit ? Number(limit) : undefined
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Sweep-forward preview — day names only (1c disclosure)
router.get(
  "/:userId/sweep-preview",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const { exerciseId } = req.query;
      if (!exerciseId) {
        return res
          .status(400)
          .json({ success: false, error: "exerciseId is required" });
      }
      const response = await controller.getSweepPreview(
        Number(req.params.userId),
        Number(exerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Related scheduled exercises overlapping on muscle group (1d list)
router.get(
  "/:userId/related",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const { exerciseId } = req.query;
      if (!exerciseId) {
        return res
          .status(400)
          .json({ success: false, error: "exerciseId is required" });
      }
      const response = await controller.getRelated(
        Number(req.params.userId),
        Number(exerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Commit exclusions + optional limitation + sweep forward (1c commit)
router.post(
  "/:userId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.addExclusions(
        Number(req.params.userId),
        req.body
      );
      res.status(response.success ? 201 : 400).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Allow an exercise back (1g reversal)
router.delete(
  "/:userId/:exerciseId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.removeExclusion(
        Number(req.params.userId),
        Number(req.params.exerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as exclusionsRouter };
