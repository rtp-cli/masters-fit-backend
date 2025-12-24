import { Router } from "express";
import { SubscriptionController } from "@/controllers/subscription.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new SubscriptionController();

// Helper function for consistent error handling
const handleError = (error: unknown, res: any) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Get subscription plans (public endpoint - no auth required)
router.get("/plans", async (req, res) => {
  try {
    const response = await controller.getSubscriptionPlans();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// RevenueCat webhook endpoint (no auth required - uses signature verification)
router.post("/webhooks/revenuecat", async (req, res) => {
  try {
    const response = await controller.handleRevenueCatWebhook(req, req.body);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as subscriptionRouter };
