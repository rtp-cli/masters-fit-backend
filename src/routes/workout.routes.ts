import { Router } from "express";
import { WorkoutController } from "@/controllers/workout.controller";
import { workoutService } from "@/services/workout.service";
import { ZodError } from "zod";
import {
  subscriptionGuard,
  subscriptionGuardWithOnboarding,
} from "@/middleware/subscription.middleware";
import {
  requireAuth,
  requireSelf,
  requireOwnership,
} from "@/middleware/authz.middleware";

const router = Router();
const controller = new WorkoutController();

// Helper function for consistent error handling.
// NOTE: authn/authz responses are now produced by the authz middleware
// (requireAuth/requireSelf/requireOwnership) before the handler runs; this
// only maps controller/business errors.
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

// Get all workouts for a user
router.get("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const response = await controller.getUserWorkouts(
      Number(req.params.userId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create new workout
router.post("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const response = await controller.createWorkout(
      Number(req.params.userId),
      req.body
    );
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update workout
router.put(
  "/:id",
  requireAuth,
  requireOwnership("workout", "id"),
  async (req, res) => {
    try {
      const response = await controller.updateWorkout(
        Number(req.params.id),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Create plan day
router.post(
  "/:workoutId/days",
  requireAuth,
  requireOwnership("workout", "workoutId"),
  async (req, res) => {
    try {
      const response = await controller.createPlanDay(
        Number(req.params.workoutId),
        req.body
      );
      res.status(201).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Create plan day exercise
router.post(
  "/days/:planDayId/exercises",
  requireAuth,
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.createPlanDayExercise(
        Number(req.params.planDayId),
        req.body
      );
      res.status(201).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Update plan day exercise
router.put(
  "/exercises/:id",
  requireAuth,
  requireOwnership("planDayExercise", "id"),
  async (req, res) => {
    try {
      const response = await controller.updatePlanDayExercise(
        Number(req.params.id),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Delete plan day exercise
router.delete(
  "/exercises/:id",
  requireAuth,
  requireOwnership("planDayExercise", "id"),
  async (req, res) => {
    try {
      const response = await controller.deletePlanDayExercise(
        Number(req.params.id)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Replace plan day exercise with a new exercise
router.put(
  "/exercise/:id/replace",
  requireAuth,
  requireOwnership("planDayExercise", "id"),
  async (req, res) => {
    try {
      const response = await controller.replaceExercise(
        Number(req.params.id),
        req.body,
        req
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Generate workout plan asynchronously
router.post(
  "/:userId/generate-async",
  requireAuth,
  requireSelf("userId"),
  subscriptionGuardWithOnboarding(),
  async (req, res) => {
    try {
      const response = await controller.generateWorkoutPlanAsync(
        Number(req.params.userId),
        req.body
      );
      res.status(202).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Regenerate workout plan asynchronously
router.post(
  "/:userId/regenerate-async",
  requireAuth,
  requireSelf("userId"),
  subscriptionGuard("regeneration", "weekly"),
  async (req, res) => {
    try {
      const response = await controller.regenerateWorkoutPlanAsync(
        Number(req.params.userId),
        req.body
      );
      res.status(202).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Regenerate daily workout asynchronously
router.post(
  "/:userId/days/:planDayId/regenerate-async",
  requireAuth,
  requireSelf("userId"),
  requireOwnership("planDay", "planDayId"),
  subscriptionGuard("regeneration", "daily"),
  async (req, res) => {
    try {
      const response = await controller.regenerateDailyWorkoutAsync(
        Number(req.params.userId),
        Number(req.params.planDayId),
        req.body
      );
      res.status(202).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Fetch active workout
router.get(
  "/:userId/active-workout",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const timezone = req.query.timezone as string | undefined;
      const workout = await workoutService.fetchActiveWorkout(
        Number(req.params.userId),
        timezone
      );
      if (!workout) {
        res.status(200).json({ success: true, workout: null });
        return;
      }
      res.status(200).json({ success: true, workout });
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get workout history
router.get(
  "/:userId/history",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.getWorkoutHistory(
        Number(req.params.userId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get previous workouts from past month
router.get(
  "/:userId/previous-workouts",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.getPreviousWorkouts(
        Number(req.params.userId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Repeat previous week workout
router.post(
  "/:userId/repeat-week/:originalWorkoutId",
  requireAuth,
  requireSelf("userId"),
  requireOwnership("workout", "originalWorkoutId"),
  async (req, res) => {
    try {
      const response = await controller.repeatPreviousWeekWorkout(
        Number(req.params.userId),
        Number(req.params.originalWorkoutId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get past completed days
router.get(
  "/:userId/past-completed-days",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.getPastCompletedDays(
        Number(req.params.userId)
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Repeat a past day's workout
router.post(
  "/:userId/repeat-day/:planDayId",
  requireAuth,
  requireSelf("userId"),
  requireOwnership("planDay", "planDayId"),
  async (req, res) => {
    try {
      const response = await controller.repeatPastDay(
        Number(req.params.userId),
        Number(req.params.planDayId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Generate rest day workout
router.post(
  "/:userId/rest-day-workout",
  requireAuth,
  requireSelf("userId"),
  subscriptionGuard("generation"),
  async (req, res) => {
    try {
      const response = await controller.generateRestDayWorkoutAsync(
        Number(req.params.userId),
        req.body
      );
      res.status(202).json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Register push notification token
router.post(
  "/:userId/register-push-token",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.registerPushToken(
        Number(req.params.userId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get job status
router.get(
  "/jobs/:jobId/status",
  requireAuth,
  requireOwnership("job", "jobId"),
  async (req, res) => {
    try {
      const response = await controller.getJobStatus(Number(req.params.jobId));
      res.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: "Invalid request data" });
      } else if (error instanceof Error) {
        res.status(404).json({ success: false, error: "Job not found" });
      } else {
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    }
  }
);

export { router as workoutRouter };
