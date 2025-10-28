import { Router } from "express";
import { AIProviderController } from "@/controllers/ai-provider.controller";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new AIProviderController();

// Get available providers and their models
router.get("/available", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const result = await controller.getAvailableProviders();
    res.json(result);
  } catch (error) {
    console.error("Error getting available providers:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update user's AI provider preference
router.put("/user/:userId/provider", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const result = await controller.updateUserProvider(
      parseInt(req.params.userId),
      req.body
    );
    res.json(result);
  } catch (error) {
    console.error("Error updating user provider:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get user's current AI provider
router.get("/user/:userId/provider", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const result = await controller.getUserProvider(
      parseInt(req.params.userId)
    );
    res.json(result);
  } catch (error) {
    console.error("Error getting user provider:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


export { router as aiProviderRouter };