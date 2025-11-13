import { Router } from "express";
import { PromptsController } from "@/controllers";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new PromptsController();

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

// Get all prompts for a user
router.get("/:userId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const userId = Number(req.params.userId);
    const prompts = await controller.getUserPrompts(userId);
    res.json(prompts);
  } catch (error) {
    handleError(error, res);
  }
});

// Create a new prompt
router.post("/", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const prompt = req.body;
    const newPrompt = await controller.createPrompt(prompt);
    res.json(newPrompt);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as promptsRouter };
