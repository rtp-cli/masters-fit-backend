import { Router } from "express";
import { PromptsController } from "@/controllers";
import { ZodError } from "zod";
import {
  requireAuth,
  requireSelf,
  requireBodySelf,
} from "@/middleware/authz.middleware";

const router = Router();
const controller = new PromptsController();

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

// Get all prompts for a user (user-scoped)
router.get("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const prompts = await controller.getUserPrompts(userId);
    res.json(prompts);
  } catch (error) {
    handleError(error, res);
  }
});

// Create a new prompt (any userId in the body must be the caller)
router.post(
  "/",
  requireAuth,
  requireBodySelf("userId", { required: false }),
  async (req, res) => {
    try {
      const prompt = req.body;
      const newPrompt = await controller.createPrompt(prompt);
      res.json(newPrompt);
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as promptsRouter };
