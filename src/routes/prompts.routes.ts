import { Router } from "express";
import { PromptsController } from "@/controllers";
import { ZodError } from "zod";

const router = Router();
const controller = new PromptsController();

// Get all prompts for a user
router.get("/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const prompts = await controller.getUserPrompts(userId);
    res.json(prompts);
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

// Create a new prompt
router.post("/", async (req, res) => {
  try {
    const prompt = req.body;
    const newPrompt = await controller.createPrompt(prompt);
    res.json(newPrompt);
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

export { router as promptsRouter };
