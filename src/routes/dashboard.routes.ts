import { Router } from "express";
import { DashboardController } from "@/controllers/dashboard.controller";
import { ZodError } from "zod";
import { requireAuth, requireSelf } from "@/middleware/authz.middleware";

const router = Router();
const controller = new DashboardController();

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

// Get comprehensive dashboard metrics
router.get(
  "/:userId/metrics",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get weekly summary
router.get(
  "/:userId/weekly-summary",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.getWeeklySummary(
        Number(req.params.userId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get workout consistency
router.get(
  "/:userId/workout-consistency",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get weight metrics
router.get(
  "/:userId/weight-metrics",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get weight accuracy
router.get(
  "/:userId/weight-accuracy",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get goal progress
router.get(
  "/:userId/goal-progress",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get total volume metrics
router.get(
  "/:userId/total-volume",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get workout type metrics
router.get(
  "/:userId/workout-type-metrics",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get weight progression metrics
router.get(
  "/:userId/weight-progression",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get raw weight accuracy data by date (for frontend filtering)
router.get(
  "/:userId/weight-accuracy-by-date",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

// Get raw workout type data by date (for frontend filtering)
router.get(
  "/:userId/workout-type-by-date",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
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
      handleError(error, res);
    }
  }
);

export default router;
