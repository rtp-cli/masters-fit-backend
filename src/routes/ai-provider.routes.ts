import { Router } from "express";
import { AIProviderController } from "@/controllers/ai-provider.controller";
import { requireAuth, requireSelf } from "@/middleware/authz.middleware";

const router = Router();
const controller = new AIProviderController();

const handleError = (error: unknown, res: any) => {
  if (error instanceof Error && error.message === "Invalid or expired token") {
    res.status(401).json({ success: false, error: error.message });
  } else if (error instanceof Error && error.message === "Unauthorized") {
    res.status(401).json({ success: false, error: "Unauthorized" });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Get available providers and their models (shared list; auth required)
router.get("/available", requireAuth, async (req, res) => {
  try {
    const result = await controller.getAvailableProviders();
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

// Update user's AI provider preference (user-scoped)
router.put(
  "/user/:userId/provider",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const result = await controller.updateUserProvider(
        parseInt(req.params.userId),
        req.body
      );
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Get user's current AI provider (user-scoped)
router.get(
  "/user/:userId/provider",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const result = await controller.getUserProvider(
        parseInt(req.params.userId)
      );
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as aiProviderRouter };
