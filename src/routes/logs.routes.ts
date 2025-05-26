import { LogsController } from "@/controllers/logs.controller";
import { Router } from "express";
import { ZodError } from "zod";

const router = Router();
const controller = new LogsController();

// Create exercise log
router.post("/", async (req, res) => {
  try {
    const response = await controller.createExerciseLog(req.body);
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
});

// Get exercise logs for a plan day
router.get("/:planDayId", async (req, res) => {
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

export { router as logsRouter };
