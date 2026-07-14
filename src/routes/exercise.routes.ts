import { Router } from "express";
import { ExerciseController } from "@/controllers/exercise.controller";
import { ZodError } from "zod";
import { requireAuth, requireAdmin } from "@/middleware/authz.middleware";

const router = Router();
const controller = new ExerciseController();

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

// The exercises table is a single GLOBAL catalog (no per-user ownership).
// Reads require auth; mutations are admin-only (previously unauthenticated —
// any anonymous caller could edit/delete the shared library for all users).

// Get all exercises
router.get("/", requireAuth, async (req, res) => {
  try {
    const response = await controller.getExercises();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get exercise by ID
router.get("/:exerciseId", requireAuth, async (req, res) => {
  try {
    const response = await controller.getExercise(
      Number(req.params.exerciseId)
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create new exercise (admin)
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await controller.createExercise(req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update exercise (admin)
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await controller.updateExercise(
      Number(req.params.id),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Delete exercise (admin)
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await controller.deleteExercise(Number(req.params.id));
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update exercise link (admin)
router.put("/:id/link", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await controller.updateExerciseLink(
      Number(req.params.id),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as exerciseRouter };
