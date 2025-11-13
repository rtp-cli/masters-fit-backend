import { Router } from "express";
import { WorkoutController } from "@/controllers/workout.controller";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new WorkoutController();

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

// Get all workouts for a user
router.get("/:userId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getUserWorkouts(
      Number(req.params.userId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create new workout
router.post("/:userId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
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
router.put("/:id", async (req, res) => {
  try {
    const response = await controller.updateWorkout(
      Number(req.params.id),
      req.body
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

// Create plan day
router.post("/:workoutId/days", async (req, res) => {
  try {
    const response = await controller.createPlanDay(
      Number(req.params.workoutId),
      req.body
    );
    res.status(201).json(response);
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

// Create plan day exercise
router.post("/days/:planDayId/exercises", async (req, res) => {
  try {
    const response = await controller.createPlanDayExercise(
      Number(req.params.planDayId),
      req.body
    );
    res.status(201).json(response);
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

// Update plan day exercise
router.put("/exercises/:id", async (req, res) => {
  try {
    const response = await controller.updatePlanDayExercise(
      Number(req.params.id),
      req.body
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

// Replace plan day exercise with a new exercise
router.put("/exercise/:id/replace", async (req, res) => {
  try {
    const response = await controller.replaceExercise(
      Number(req.params.id),
      req.body
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


router.post("/:userId/generate", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.generateWorkoutPlan(
      Number(req.params.userId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Generate workout plan asynchronously
router.post("/:userId/generate-async", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.generateWorkoutPlanAsync(
      Number(req.params.userId),
      req.body
    );
    res.status(202).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/:userId/regenerate", async (req, res) => {
  try {
    const response = await controller.regenerateWorkoutPlan(
      Number(req.params.userId),
      req.body
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

// Regenerate workout plan asynchronously
router.post("/:userId/regenerate-async", async (req, res) => {
  try {
    const response = await controller.regenerateWorkoutPlanAsync(
      Number(req.params.userId),
      req.body
    );
    res.status(202).json(response);
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

// Regenerate daily workout
router.post("/:userId/days/:planDayId/regenerate", async (req, res) => {
  try {
    const response = await controller.regenerateDailyWorkout(
      Number(req.params.userId),
      Number(req.params.planDayId),
      req.body
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

// Regenerate daily workout asynchronously
router.post("/:userId/days/:planDayId/regenerate-async", async (req, res) => {
  try {
    const response = await controller.regenerateDailyWorkoutAsync(
      Number(req.params.userId),
      Number(req.params.planDayId),
      req.body
    );
    res.status(202).json(response);
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

// Fetch active workout
router.get("/:userId/active-workout", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.fetchActiveWorkout(
      Number(req.params.userId)
    );
    // Always return 200 - having no active workout is a valid state
    res.status(200).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get workout history
router.get("/:userId/history", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getWorkoutHistory(
      Number(req.params.userId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get previous workouts from past month
router.get("/:userId/previous-workouts", async (req, res) => {
  try {
    const response = await controller.getPreviousWorkouts(
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

// Repeat previous week workout
router.post("/:userId/repeat-week/:originalWorkoutId", async (req, res) => {
  try {
    const response = await controller.repeatPreviousWeekWorkout(
      Number(req.params.userId),
      Number(req.params.originalWorkoutId),
      req.body
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

// Generate rest day workout
router.post("/:userId/rest-day-workout", async (req, res) => {
  try {
    const response = await controller.generateRestDayWorkoutAsync(
      Number(req.params.userId),
      req.body
    );
    res.status(202).json(response);
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

// Register push notification token
router.post("/:userId/register-push-token", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.registerPushToken(
      Number(req.params.userId),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get job status
router.get("/jobs/:jobId/status", async (req, res) => {
  try {
    const response = await controller.getJobStatus(
      Number(req.params.jobId)
    );
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
});

export { router as workoutRouter };
