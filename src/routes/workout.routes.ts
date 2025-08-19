import { Router } from "express";
import { WorkoutController } from "@/controllers/workout.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new WorkoutController();

// Get all workouts for a user
router.get("/:userId", async (req, res) => {
  try {
    const response = await controller.getUserWorkouts(
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

// Create new workout
router.post("/:userId", async (req, res) => {
  try {
    const response = await controller.createWorkout(
      Number(req.params.userId),
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

router.post("/:userId/generate", async (req, res) => {
  try {
    const response = await controller.generateWorkoutPlan(
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

// Regenerate daily workout
router.post("/:userId/days/:planDayId/regenerate", async (req, res) => {
  console.log(`[ROUTE] Daily regeneration called: userId=${req.params.userId}, planDayId=${req.params.planDayId}`, req.body);
  try {
    const response = await controller.regenerateDailyWorkout(
      Number(req.params.userId),
      Number(req.params.planDayId),
      req.body
    );
    console.log(`[ROUTE] Daily regeneration success:`, response);
    res.json(response);
  } catch (error) {
    console.log(`[ROUTE] Daily regeneration error:`, error);
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
    const response = await controller.fetchActiveWorkout(
      Number(req.params.userId)
    );
    // Always return 200 - having no active workout is a valid state
    res.status(200).json(response);
  } catch (error) {
    // Only return error status for actual errors, not "no workout" states
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      // Log the actual error for debugging
      console.error("Error in active-workout route:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Get workout history
router.get("/:userId/history", async (req, res) => {
  try {
    const response = await controller.getWorkoutHistory(
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

export { router as workoutRouter };
