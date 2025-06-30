import { LogsController } from "@/controllers/logs.controller";
import { logsService } from "@/services";
import { Router } from "express";
import { ZodError } from "zod";

const router = Router();
const controller = new LogsController();

// Create exercise log
router.post("/exercise", async (req, res) => {
  try {
    const exerciseLog = await logsService.createExerciseLog(req.body);
    res.status(201).json(exerciseLog);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
});

// Get exercise logs for a plan day
router.get("/exercise/:planDayId", async (req, res) => {
  try {
    const response = await controller.getExerciseLogsForPlanDay(
      Number(req.params.planDayId)
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
});

// Create workout log
router.post("/workout", async (req, res) => {
  try {
    const response = await controller.createWorkoutLog(req.body);
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
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

// Mark workout as complete
router.post("/workout/:workoutId/complete", async (req, res) => {
  try {
    const response = await controller.markWorkoutComplete(
      Number(req.params.workoutId),
      req.body
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
});

export { router as logsRouter };
