import { Router } from "express";
import { SearchController } from "@/controllers/search.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new SearchController();

// Search workouts by date
router.get("/date/:userId", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== "string") {
      return res.status(400).json({
        success: false,
        error: "Date parameter is required",
      });
    }

    const response = await controller.searchByDate(
      Number(req.params.userId),
      date
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Get exercise details with user statistics
router.get("/exercise/:userId/:exerciseId", async (req, res) => {
  try {
    const response = await controller.searchExercise(
      Number(req.params.userId),
      Number(req.params.exerciseId)
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Search exercises by query
router.get("/exercises", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "Query parameter is required",
      });
    }

    const response = await controller.searchExercises(query);
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Enhanced search exercises with filtering
router.get("/exercises/filtered/:userId", async (req, res) => {
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Get available filter options
router.get("/filters", async (req, res) => {
  try {
    const response = await controller.getFilterOptions();
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

export { router as searchRouter };
