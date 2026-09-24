import { Router } from "express";
import { ExerciseController } from "@/controllers/exercise.controller";
import { ZodError } from "zod";
import { requireAuth, requireAdmin } from "@/middleware/authz.middleware";
import { exerciseService } from "@/services/exercise.service";

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

// The exercises table is the GLOBAL catalog plus users' own exercises
// (owner_user_id set). Reads require auth; catalog mutations are admin-only
// (previously unauthenticated — any anonymous caller could edit/delete the
// shared library for all users). A user may create only their own.

// Get all exercises
router.get("/", requireAuth, async (req, res) => {
  try {
    const response = await controller.getExercises();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create one of the caller's own exercises. Registered before "/:exerciseId"
// routes for readability; POST never collides with them anyway.
router.post("/custom", requireAuth, async (req, res) => {
  try {
    const response = await controller.createCustomExercise(req.body, req);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Get exercise by ID (another user's own exercise reads as not found)
router.get("/:exerciseId", requireAuth, async (req, res) => {
  try {
    const exerciseId = Number(req.params.exerciseId);
    if (!(await exerciseService.isUsableBy(exerciseId, (req as any).userId))) {
      return res.status(404).json({ success: false, error: "Exercise not found" });
    }
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
