import { LogsController } from "@/controllers/logs.controller";
import { logsService } from "@/services";
import { Router } from "express";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new LogsController();

// Helper function for consistent error handling
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

// Create exercise log
router.post("/exercise", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const exerciseLog = await logsService.createExerciseLog(req.body);
    res.status(201).json(exerciseLog);
  } catch (error) {
    handleError(error, res);
  }
});

// Get exercise logs for a plan day
router.get("/exercise/:planDayId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getExerciseLogsForPlanDay(
      Number(req.params.planDayId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create workout log
router.post("/workout", async (req, res) => {
  try {
    const response = await controller.createWorkoutLog(req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get or create workout log
router.get("/workout/:workoutId", async (req, res) => {
  try {
    const response = await controller.getOrCreateWorkoutLog(
      Number(req.params.workoutId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get existing workout log (without creating)
router.get("/workout/:workoutId/existing", async (req, res) => {
  try {
    const response = await controller.getExistingWorkoutLog(
      Number(req.params.workoutId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update workout log
router.put("/workout/:workoutId", async (req, res) => {
  try {
    const response = await controller.updateWorkoutLog(
      Number(req.params.workoutId),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get all workout logs for a workout
router.get("/workout/:workoutId/all", async (req, res) => {
  try {
    const response = await controller.getWorkoutLogsForWorkout(
      Number(req.params.workoutId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get completed exercises for a workout
router.get("/workout/:workoutId/completed", async (req, res) => {
  try {
    const response = await controller.getCompletedExercisesForWorkout(
      Number(req.params.workoutId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Add completed exercise to workout
router.post(
  "/workout/:workoutId/exercise/:planDayExerciseId",
  async (req, res) => {
    try {
      const response = await controller.addCompletedExercise(
        Number(req.params.workoutId),
        Number(req.params.planDayExerciseId)
      );
      res.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: "Invalid request data" });
      } else if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
      }
    }
  }
);

// Skip exercise
router.post(
  "/workout/:workoutId/exercise/:planDayExerciseId/skip",
  async (req, res) => {
    try {
      const response = await controller.skipExercise(
        Number(req.params.workoutId),
        Number(req.params.planDayExerciseId)
      );
      res.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: "Invalid request data" });
      } else if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
      }
    }
  }
);

// Skip workout block
router.post(
  "/workout/:workoutId/block/:workoutBlockId/skip",
  async (req, res) => {
    try {
      const response = await controller.skipBlock(
        Number(req.params.workoutId),
        Number(req.params.workoutBlockId)
      );
      res.json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ success: false, error: "Invalid request data" });
      } else if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
      }
    }
  }
);

// Mark workout as complete
router.post("/workout/:workoutId/complete", async (req, res) => {
  try {
    const response = await controller.markWorkoutComplete(
      Number(req.params.workoutId),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Plan day completion
router.post("/workout/day/:planDayId/complete", async (req, res) => {
  try {
    const response = await controller.markWorkoutDayComplete(
      Number(req.params.planDayId),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Plan day log routes
router.get("/plan-day/plan-day/:planDayId", async (req, res) => {
  try {
    const response = await controller.getPlanDayLogsForPlanDay(
      Number(req.params.planDayId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.get("/plan-day/plan-day/:planDayId/latest", async (req, res) => {
  try {
    const response = await controller.getLatestPlanDayLogForPlanDay(
      Number(req.params.planDayId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as logsRouter };
