import { Router } from "express";
import { DashboardController } from "@/controllers/dashboard.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new DashboardController();

// Get comprehensive dashboard metrics
router.get("/:userId/metrics", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getDashboardMetrics(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get weekly summary
router.get("/:userId/weekly-summary", async (req, res) => {
  try {
    const response = await controller.getWeeklySummary(
      Number(req.params.userId)
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

// Get workout consistency
router.get("/:userId/workout-consistency", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWorkoutConsistency(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get weight metrics
router.get("/:userId/weight-metrics", async (req, res) => {
  try {
    const { startDate, endDate, groupBy, timeRange } = req.query;
    const response = await controller.getWeightMetrics(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      groupBy as "exercise" | "day" | "muscle_group",
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get weight accuracy
router.get("/:userId/weight-accuracy", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWeightAccuracy(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get goal progress
router.get("/:userId/goal-progress", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getGoalProgress(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get total volume metrics
router.get("/:userId/total-volume", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getTotalVolumeMetrics(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get workout type metrics
router.get("/:userId/workout-type-metrics", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWorkoutTypeMetrics(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get weight progression metrics
router.get("/:userId/weight-progression", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWeightProgressionMetrics(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get raw weight accuracy data by date (for frontend filtering)
router.get("/:userId/weight-accuracy-by-date", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWeightAccuracyByDate(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

// Get raw workout type data by date (for frontend filtering)
router.get("/:userId/workout-type-by-date", async (req, res) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    const response = await controller.getWorkoutTypeByDate(
      Number(req.params.userId),
      startDate as string,
      endDate as string,
      timeRange as "1w" | "1m" | "3m" | "6m" | "1y"
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

export default router;
