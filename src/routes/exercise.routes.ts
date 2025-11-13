import { Router } from "express";
import { ExerciseController } from "@/controllers/exercise.controller";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new ExerciseController();

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

// Get all exercises
router.get("/", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getExercises();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get exercise by ID
router.get("/:exerciseId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getExercise(
      Number(req.params.exerciseId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create new exercise
router.post("/", async (req, res) => {
  try {
    const response = await controller.createExercise(req.body);
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

// Update exercise
router.put("/:id", async (req, res) => {
  try {
    const response = await controller.updateExercise(
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

// Delete exercise
router.delete("/:id", async (req, res) => {
  try {
    const response = await controller.deleteExercise(Number(req.params.id));
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

// Update exercise link
router.put("/:id/link", async (req, res) => {
  try {
    const response = await controller.updateExerciseLink(
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

export { router as exerciseRouter };
