import { LogsController } from "@/controllers/logs.controller";
import { logsService } from "@/services";
import { Router } from "express";
import { ZodError } from "zod";
import {
  requireAuth,
  requireOwnership,
  requireOwnershipFromBody,
  requireOwnershipBatchFromBody,
} from "@/middleware/authz.middleware";

const router = Router();
const controller = new LogsController();

// Helper function for consistent error handling (business/controller errors;
// authn/authz responses are produced by the authz middleware before the handler).
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

// Create exercise logs (batch) — ownership of every referenced plan-day-exercise
router.post(
  "/exercise/batch",
  requireAuth,
  requireOwnershipBatchFromBody("planDayExercise", "logs", "planDayExerciseId"),
  async (req, res) => {
    try {
      const result = await controller.createExerciseLogsBatch(req.body);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Create exercise log
router.post(
  "/exercise",
  requireAuth,
  requireOwnershipFromBody("planDayExercise", "planDayExerciseId"),
  async (req, res) => {
    try {
      const exerciseLog = await logsService.createExerciseLog(req.body);
      res.status(201).json(exerciseLog);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get exercise logs for a plan day
router.get(
  "/exercise/:planDayId",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.getExerciseLogsForPlanDay(
        Number(req.params.planDayId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Create workout log
router.post(
  "/workout",
  requireAuth,
  requireOwnershipFromBody("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.createWorkoutLog(req.body);
      res.status(201).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get or create workout log
router.get(
  "/workout/:workoutId",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.getOrCreateWorkoutLog(
        Number(req.params.workoutId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get existing workout log (without creating)
router.get(
  "/workout/:workoutId/existing",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.getExistingWorkoutLog(
        Number(req.params.workoutId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Update workout log
router.put(
  "/workout/:workoutId",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.updateWorkoutLog(
        Number(req.params.workoutId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get all workout logs for a workout
router.get(
  "/workout/:workoutId/all",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.getWorkoutLogsForWorkout(
        Number(req.params.workoutId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get completed exercises for a workout
router.get(
  "/workout/:workoutId/completed",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.getCompletedExercisesForWorkout(
        Number(req.params.workoutId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Add completed exercise to workout
router.post(
  "/workout/:workoutId/exercise/:planDayExerciseId",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.addCompletedExercise(
        Number(req.params.workoutId),
        Number(req.params.planDayExerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Add completed exercises (batch) to workout
router.post(
  "/workout/:workoutId/exercises/complete",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.addCompletedExercises(
        Number(req.params.workoutId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Skip exercise
router.post(
  "/workout/:workoutId/exercise/:planDayExerciseId/skip",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.skipExercise(
        Number(req.params.workoutId),
        Number(req.params.planDayExerciseId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Skip workout block
router.post(
  "/workout/:workoutId/block/:workoutBlockId/skip",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.skipBlock(
        Number(req.params.workoutId),
        Number(req.params.workoutBlockId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Mark workout as complete
router.post(
  "/workout/:workoutId/complete",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.markWorkoutComplete(
        Number(req.params.workoutId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Plan day completion
router.post(
  "/workout/day/:planDayId/complete",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.markWorkoutDayComplete(
        Number(req.params.planDayId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Reopen a completed plan day (for resume)
router.post(
  "/workout/day/:planDayId/reopen",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const planDayId = Number(req.params.planDayId);
      await logsService.reopenPlanDay(planDayId);
      res.json({ success: true });
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Plan day log routes
router.get(
  "/plan-day/plan-day/:planDayId",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.getPlanDayLogsForPlanDay(
        Number(req.params.planDayId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

router.get(
  "/plan-day/plan-day/:planDayId/latest",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.getLatestPlanDayLogForPlanDay(
        Number(req.params.planDayId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as logsRouter };
