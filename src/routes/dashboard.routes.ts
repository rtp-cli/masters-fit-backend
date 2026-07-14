import { Router } from "express";
import { DashboardController } from "@/controllers/dashboard.controller";
import { ZodError } from "zod";
import {
  requireAuth,
  requireSelf,
  requireCapability,
} from "@/middleware/authz.middleware";
import { accessService } from "@/services/access.service";
import { Capability } from "@/constants/access-policy";

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

// Advanced ("progress") sections of the composite /metrics response. These are
// MastersFit+ only (decision D4); stripped to null for users without
// VIEW_PROGRESS_ANALYTICS. Basic engagement (weeklySummary, workoutConsistency,
// dailyWorkoutProgress) stays free.
const ADVANCED_METRIC_KEYS = [
  "weightMetrics",
  "weightAccuracy",
  "goalProgress",
  "totalVolumeMetrics",
  "workoutTypeMetrics",
];
function stripAdvancedMetrics(response: any): void {
  const data = response?.data;
  if (!data) return;
  for (const key of ADVANCED_METRIC_KEYS) {
    if (key in data) data[key] = null;
  }
}

const PROGRESS = Capability.VIEW_PROGRESS_ANALYTICS;

// Comprehensive dashboard metrics — FREE gets basic sections; advanced
// (progress) sections are stripped unless the user has VIEW_PROGRESS_ANALYTICS.
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
      if (!(await accessService.hasCapability(Number(req.params.userId), PROGRESS))) {
        stripAdvancedMetrics(response);
      }
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Weekly summary (streak + weekly completion) — FREE.
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

// Workout consistency (engagement — did you show up) — FREE.
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

// ---- Advanced progress analytics (MastersFit+ only) ------------------------

router.get(
  "/:userId/weight-metrics",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/weight-accuracy",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/goal-progress",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/total-volume",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/workout-type-metrics",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/weight-progression",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/weight-accuracy-by-date",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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

router.get(
  "/:userId/workout-type-by-date",
  requireAuth,
  requireSelf("userId"),
  requireCapability(PROGRESS),
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
