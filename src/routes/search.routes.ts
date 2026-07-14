import { Router } from "express";
import { SearchController } from "@/controllers/search.controller";
import { ZodError } from "zod";
import { requireAuth, requireSelf } from "@/middleware/authz.middleware";

const router = Router();
const controller = new SearchController();

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

// Search workouts by date (user-scoped)
router.get(
  "/date/:userId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "Date parameter is required" });
      }
      const response = await controller.searchByDate(
        Number(req.params.userId),
        date
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get exercise details with user statistics (user-scoped)
router.get(
  "/exercise/:userId/:exerciseId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.searchExercise(
        Number(req.params.userId),
        Number(req.params.exerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Search exercises by query (global catalog)
router.get("/exercises", requireAuth, async (req, res) => {
  try {
    const { query, limit, offset } = req.query;
    if (!query || typeof query !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "Query parameter is required" });
    }
    const response = await controller.searchExercises(
      query,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Enhanced search exercises with filtering (user-scoped)
router.get(
  "/exercises/filtered/:userId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const {
        query,
        muscleGroups,
        equipment,
        difficulty,
        excludeId,
        userEquipmentOnly,
        limit,
      } = req.query;

      const response = await controller.searchExercisesWithFilters(
        Number(req.params.userId),
        query as string,
        muscleGroups as string,
        equipment as string,
        difficulty as string,
        excludeId ? Number(excludeId) : undefined,
        userEquipmentOnly === "true",
        limit ? Number(limit) : undefined
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get available filter options (global)
router.get("/filters", requireAuth, async (req, res) => {
  try {
    const response = await controller.getFilterOptions();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as searchRouter };
